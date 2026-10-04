// 표준 MIDI 파일(포맷 0, PPQ 480) 작성기. 16분음표 = 120틱.
// 줄마다 채널을 따로 써서(0~5) 벤딩·슬라이드의 피치벤드가 서로 섞이지 않게 한다.
import { STRINGS, TUNINGS, METERS, DEFAULT_METER } from './constants.js';
import { parse, slotsOf, expandRepeats } from './tab.js';

export const PPQ = 480;
export const TICKS_PER_SLOT = PPQ / 4;
const PROGRAM = { acoustic: 25, nylon: 24, clean: 27, drive: 29, sample: 25 }; // GM: 25 스틸, 24 나일론, 27 클린, 29 오버드라이브
const BEND_CENTER = 8192, BEND_PER_SEMI = 4096 / 2; // 기본 벤드 범위 ±2반음

function vlq(n) {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
}
function str(s) { return Array.from(new TextEncoder().encode(s)); }
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function u16(n) { return [(n >>> 8) & 255, n & 255]; }
function meta(type, data) { return [0xff, type].concat(vlq(data.length), data); }
function bendBytes(v) { v = Math.max(0, Math.min(16383, Math.round(v))); return [v & 0x7f, (v >> 7) & 0x7f]; }

/**
 * 곡 → MIDI 바이트. opts.instr: 악기 키(프로그램 번호 선택), opts.repeats: 반복 기호 펼치기(기본 true)
 */
export function toMidi(song, opts) {
  opts = opts || {};
  const slots = slotsOf(song), midis = TUNINGS[song.tuning].midi, bpm = song.bpm || 90;
  const meter = METERS[song.meter] ? song.meter : DEFAULT_METER;
  const order = opts.repeats === false ? song.measures.map((_, m) => m) : expandRepeats(song.measures.length, song.rep);
  const total = order.length * slots;
  const cell = (pos, s) => { const m = order[Math.floor(pos / slots)], i = pos % slots; return { v: song.measures[m][s][i], m, i }; };
  const ev = []; // {t, pri, bytes}  pri: 0 note-off/bend-reset, 1 bend, 2 note-on
  const push = (t, pri, bytes) => { ev.push({ t, pri, bytes }); };

  // 헤더 메타
  const [nn, dd] = meter.split('/').map(Number);
  push(0, 0, meta(0x51, [Math.round(60e6 / bpm) >> 16 & 255, Math.round(60e6 / bpm) >> 8 & 255, Math.round(60e6 / bpm) & 255]));
  push(0, 0, meta(0x58, [nn, Math.round(Math.log2(dd)), 24, 8]));
  if (song.title) push(0, 0, meta(0x03, str(song.title)));
  const prog = PROGRAM[opts.instr] !== undefined ? PROGRAM[opts.instr] : 25;
  for (let s = 0; s < STRINGS; s++) { push(0, 0, [0xc0 | s, prog]); push(0, 0, [0xe0 | s].concat(bendBytes(BEND_CENTER))); }

  let noteCount = 0;
  for (let s = 0; s < STRINGS; s++) {
    for (let pos = 0; pos < total; pos++) {
      const { v, m, i } = cell(pos, s);
      if (!v) continue;
      const p = parse(v);
      if (!p.num && p.mod !== 'x') continue; // '.'(끊기)나 단독 기법은 이벤트 없음(끊기는 길이 계산에만 쓰임)
      // 길이: 같은 줄의 다음 칸 값(음, 끊기, 뮤트)까지. 최대 2마디.
      let end = pos + 1;
      while (end < total && end - pos < slots * 2 && !cell(end, s).v) end++;
      const pm = !!(song.pm && song.pm[m + ':' + i]);
      let len = (end - pos) * TICKS_PER_SLOT;
      if (p.mod === 'x') len = Math.min(len, TICKS_PER_SLOT / 2);
      else if (pm) len = Math.min(len, TICKS_PER_SLOT * 2);
      const t0 = pos * TICKS_PER_SLOT, t1 = t0 + len - 1;
      const note = midis[s] + (p.num ? +p.num : 0);
      const vel = p.mod === 'x' ? 45 : (p.mod === 'h' || p.mod === 'p') ? 70 : (pm ? 80 : 96);
      const ch = s;
      push(t0, 2, [0x90 | ch, note, vel]);
      push(t1, 0, [0x80 | ch, note, 0]);
      noteCount++;
      // 피치벤드 표현
      if (p.mod === 'b') {
        const steps = 8, span = Math.min(len - 1, 160);
        for (let k = 1; k <= steps; k++) push(t0 + Math.round(span * k / steps), 1, [0xe0 | ch].concat(bendBytes(BEND_CENTER + BEND_PER_SEMI * k / steps)));
        push(t1, 0, [0xe0 | ch].concat(bendBytes(BEND_CENTER)));
      } else if (p.mod === '~') {
        const cycles = Math.max(1, Math.round(len / PPQ * 5.5 * 0.5)), pts = cycles * 4;
        for (let k = 1; k < pts; k++) push(t0 + Math.round(len * k / pts), 1, [0xe0 | ch].concat(bendBytes(BEND_CENTER + Math.sin(k / 4 * 2 * Math.PI) * BEND_PER_SEMI * 0.25)));
        push(t1, 0, [0xe0 | ch].concat(bendBytes(BEND_CENTER)));
      } else if ((p.mod === '/' || p.mod === '\\') && p.num) {
        const nx = end < total ? parse(cell(end, s).v) : null;
        if (nx && nx.num) {
          const semis = Math.max(-2, Math.min(2, +nx.num - +p.num)), steps = 8;
          const from = Math.min(len - 1, Math.round(TICKS_PER_SLOT * 0.5));
          for (let k = 1; k <= steps; k++) push(t0 + from + Math.round((len - 1 - from) * k / steps), 1, [0xe0 | ch].concat(bendBytes(BEND_CENTER + BEND_PER_SEMI * semis * k / steps)));
          push(t1, 0, [0xe0 | ch].concat(bendBytes(BEND_CENTER)));
        }
      }
    }
  }
  const endT = total * TICKS_PER_SLOT + PPQ;
  push(endT, 3, meta(0x2f, []));

  ev.sort((a, b) => a.t - b.t || a.pri - b.pri);
  let last = 0; const track = [];
  ev.forEach((e) => { track.push.apply(track, vlq(e.t - last)); track.push.apply(track, e.bytes); last = e.t; });
  const bytes = [].concat(str('MThd'), u32(6), u16(0), u16(1), u16(PPQ), str('MTrk'), u32(track.length), track);
  const out = new Uint8Array(bytes);
  out.noteCount = noteCount;
  return out;
}

/** 테스트·검증용 간단 파서: 헤더와 노트온 수, 메타 이벤트를 읽는다 */
export function inspectMidi(bytes) {
  const b = bytes, txt = (a, n) => String.fromCharCode.apply(null, b.slice(a, a + n));
  const r = { tag: txt(0, 4), format: (b[8] << 8) | b[9], ntracks: (b[10] << 8) | b[11], division: (b[12] << 8) | b[13], trackTag: txt(14, 4) };
  r.trackLen = (b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21];
  let i = 22, t = 0, running = null; const notes = [], metas = [], bends = [];
  const end = 22 + r.trackLen;
  while (i < end) {
    let d = 0; while (true) { const c = b[i++]; d = (d << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
    t += d;
    let st = b[i];
    if (st & 0x80) { i++; running = st; } else st = running;
    if (st === 0xff) { const type = b[i++]; let len = 0; while (true) { const c = b[i++]; len = (len << 7) | (c & 0x7f); if (!(c & 0x80)) break; } metas.push({ t, type, data: Array.from(b.slice(i, i + len)) }); i += len; }
    else if ((st & 0xf0) === 0x90) { const n = b[i++], v = b[i++]; if (v > 0) notes.push({ t, ch: st & 15, note: n, vel: v }); else notes.push({ t, ch: st & 15, note: n, off: true }); }
    else if ((st & 0xf0) === 0x80) { const n = b[i++]; i++; notes.push({ t, ch: st & 15, note: n, off: true }); }
    else if ((st & 0xf0) === 0xe0) { const lo = b[i++], hi = b[i++]; bends.push({ t, ch: st & 15, v: (hi << 7) | lo }); }
    else if ((st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0) i += 1;
    else i += 2;
  }
  r.notes = notes; r.metas = metas; r.bends = bends; r.consumed = i;
  return r;
}
