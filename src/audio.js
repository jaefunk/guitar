// 소리 엔진: 확장 Karplus-Strong을 오프라인 합성해 AudioBuffer로 캐시하고, 악기별 체인으로 내보낸다.
import { STRINGS, PER_LINE, TUNINGS, INSTR } from './constants.js';
import { state, ed } from './state.js';
import { parse, nextNoteOnString, slotsOf, beatOf, expandRepeats } from './tab.js';
import { $, toast } from './ui.js';
import { dom, updateInfo } from './render.js';

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
let actx = null, master = null, comp = null, revBus = null, drumBus = null, noiseBuf = null;
const chains = {};
const bufCache = {};
let active = [], playTimer = null, hlTimers = [], playPos = 0, nextTime = 0, loopA = 0, loopB = 0, loopOn = false;
// 재생 순서: order[k] = k번째로 연주할 마디 번호(반복 기호를 펼친 결과). SL = 한 마디 칸 수.
let order = [], SL = 16;
let previewVoices = [];

/** 재생 상태(다른 모듈이 읽기만 함). lastHL = {m, i, pos}, bpm = 지금 실제 재생 속도, trainer = 트레이너 동작 중 */
export const pb = { playing: false, lastHL: null, bpm: 90, trainer: false };

export function ensureAudio() {
  if (!AC) return false;
  if (!actx) {
    try { actx = new AC(); } catch (e) { return false; }
    comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = actx.createGain(); master.gain.value = state.volume;
    master.connect(comp); comp.connect(actx.destination);
    revBus = actx.createGain(); revBus.gain.value = state.reverb * 0.7;
    const conv = actx.createConvolver(); conv.buffer = makeIR(1.6);
    revBus.connect(conv); conv.connect(master);
    drumBus = actx.createGain(); drumBus.gain.value = 0.8; drumBus.connect(master);
  }
  if (actx.state === 'suspended') { try { actx.resume(); } catch (e) { /* 무시 */ } }
  return true;
}
function makeIR(sec) {
  const sr = actx.sampleRate, N = Math.floor(sr * sec), b = actx.createBuffer(2, N, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < N; i++) { lp += 0.35 * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.exp(-4 * i / N) * (1 - i / N); }
  }
  return b;
}
function driveCurve(k) {
  const n = 2048, c = new Float32Array(n), t = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = i * 2 / (n - 1) - 1; c[i] = Math.tanh(k * x) / t; }
  return c;
}
function bq(type, f, q, gain) {
  const b = actx.createBiquadFilter(); b.type = type; b.frequency.value = f;
  if (q != null) b.Q.value = q; if (gain != null) b.gain.value = gain;
  return b;
}
function getChain(kind) {
  if (chains[kind]) return chains[kind];
  const input = actx.createGain(), out = actx.createGain();
  let nodes;
  if (kind === 'nylon') { nodes = [bq('peaking', 95, 2.5, 5), bq('peaking', 190, 3, 3), bq('lowpass', 3800, 0.7)]; out.gain.value = 1; }
  else if (kind === 'clean') { nodes = [bq('peaking', 2400, 1.2, 3), bq('lowpass', 6500, 0.8)]; out.gain.value = 0.9; }
  else if (kind === 'drive') {
    const pre = actx.createGain(); pre.gain.value = 3.5;
    const ws = actx.createWaveShaper(); ws.curve = driveCurve(6); ws.oversample = '2x';
    nodes = [bq('highpass', 90, 0.7), pre, ws, bq('lowpass', 4200, 0.9), bq('peaking', 900, 1, 3)]; out.gain.value = 0.3;
  } else { nodes = [bq('peaking', 105, 2.5, 4), bq('peaking', 215, 3, 2.5), bq('highshelf', 5000, null, -3)]; out.gain.value = 0.9; }
  let prev = input; nodes.forEach((n) => { prev.connect(n); prev = n; }); prev.connect(out);
  out.connect(master); out.connect(revBus);
  chains[kind] = { input };
  return chains[kind];
}

/**
 * 분수 지연 + 2탭 손실 필터 + 피킹 위치 콤 필터를 넣은 Karplus-Strong.
 * sampleRate/length를 넘기면 AudioContext 없이도(테스트) Float32Array를 만든다.
 */
export function synthSamples(freq, I, soft, muted, sr, pm) {
  // 팜뮤트: 손바닥으로 줄을 눌러 짧고 둔탁하게. 감쇠를 세게, 밝기를 낮게.
  const len = muted ? 0.25 : (pm ? 0.9 : I.len), N = Math.floor(sr * len);
  const out = new Float32Array(N);
  const S = (muted || pm) ? 0.5 : I.S, g = muted ? 0.55 : (pm ? 0.975 : I.g);
  const P = sr / freq - S; let Pi = Math.floor(P), frac = P - Pi;
  if (Pi < 2) { Pi = 2; frac = 0; }
  const L = Pi + 3, ring = new Float32Array(L);
  const exLen = Pi + 1, ex = new Float32Array(exLen);
  let lp = 0; const coef = Math.min(1, I.bright * (soft ? 0.55 : 1) * (muted ? 0.5 : 1) * (pm ? 0.6 : 1));
  let i, n;
  for (i = 0; i < exLen; i++) { lp += coef * ((Math.random() * 2 - 1) - lp); ex[i] = lp; }
  const pk = Math.max(1, Math.round(P * I.pick));
  for (i = exLen - 1; i >= pk; i--) ex[i] -= ex[i - pk];
  let prev = 0, peak = 0;
  for (n = 0; n < N; n++) {
    const i0 = ((n - Pi) % L + L) % L, i1 = ((n - Pi - 1) % L + L) % L;
    const interp = ring[i0] * (1 - frac) + ring[i1] * frac;
    const loss = (1 - S) * interp + S * prev; prev = interp;
    const y = (n < exLen ? ex[n] : 0) + g * loss;
    ring[n % L] = y; out[n] = y;
    const a = Math.abs(y); if (a > peak) peak = a;
  }
  if (peak > 0) { const k = 0.8 / peak; for (n = 0; n < N; n++) out[n] *= k; }
  const att = Math.floor(sr * 0.001); for (i = 0; i < att; i++) out[i] *= i / att;
  const rel = Math.floor(sr * 0.25); for (i = 0; i < rel; i++) out[N - 1 - i] *= i / rel;
  return out;
}
function synth(freq, I, soft, muted, pm) {
  const data = synthSamples(freq, I, soft, muted, actx.sampleRate, pm);
  const buf = actx.createBuffer(1, data.length, actx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}
function noteBuffer(midi, soft, muted, pm) {
  const I = INSTR[state.instr] || INSTR.acoustic;
  const key = state.instr + (muted ? 'x' : (pm ? 'p' : (soft ? 's' : 'n'))) + midi;
  if (!bufCache[key]) bufCache[key] = synth(440 * Math.pow(2, (midi - 69) / 12), I, soft, muted, pm);
  return bufCache[key];
}
function playNote(midi, t, o) {
  const muted = !!o.muted, src = actx.createBufferSource();
  src.buffer = noteBuffer(midi, !!o.soft, muted, !!o.pm);
  const g = actx.createGain(), vel = (o.vel || 0.7) * (0.94 + Math.random() * 0.12);
  g.gain.setValueAtTime(vel, t); src.connect(g); g.connect(getChain(state.instr).input);
  if (o.mod === 'b') { src.playbackRate.setValueAtTime(1, t); src.playbackRate.linearRampToValueAtTime(Math.pow(2, 1 / 12), t + 0.16); }
  else if (o.mod === '~') {
    const lfo = actx.createOscillator(); lfo.frequency.value = 5.5;
    const lg = actx.createGain(); lg.gain.value = 0.012;
    lfo.connect(lg); lg.connect(src.playbackRate); lfo.start(t); lfo.stop(t + src.buffer.duration);
  } else if (o.slideRatio) { src.playbackRate.setValueAtTime(1, o.slideFrom); src.playbackRate.linearRampToValueAtTime(o.slideRatio, o.slideTo); }
  src.start(t); src.stop(t + src.buffer.duration);
  return { g, src };
}
function stopVoice(v, t) {
  if (!v) return;
  v.g.gain.setTargetAtTime(0, t, 0.012);
  try { v.src.stop(t + 0.15); } catch (e) { /* 이미 멈춤 */ }
}
function slotDur() { return 60 / (pb.playing ? pb.bpm : state.bpm) / 4; }
/** 재생 위치 → {m, i} */
function posToMI(pos) { return { m: order[Math.floor(pos / SL)], i: pos % SL }; }
function click(t, accent) {
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(accent ? 2300 : 1700, t); o.frequency.exponentialRampToValueAtTime(accent ? 1500 : 1100, t + 0.03);
  const g = actx.createGain(); g.gain.setValueAtTime(accent ? 0.55 : 0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.08);
}
/* ---------- 드럼 (노이즈·사인 합성) ---------- */
function noise() {
  if (noiseBuf) return noiseBuf;
  const N = actx.sampleRate; noiseBuf = actx.createBuffer(1, N, actx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function env(g, t, peak, dur) { g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); }
function kick(t) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  env(g, t, 0.9, 0.28); o.connect(g); g.connect(drumBus); o.start(t); o.stop(t + 0.3);
}
function snare(t) {
  const n = actx.createBufferSource(); n.buffer = noise();
  const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
  const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
  const g = actx.createGain(); env(g, t, 0.55, 0.18);
  n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(drumBus); n.start(t); n.stop(t + 0.2);
  const o = actx.createOscillator(), g2 = actx.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(190, t); env(g2, t, 0.4, 0.08);
  o.connect(g2); g2.connect(drumBus); o.start(t); o.stop(t + 0.1);
}
function hat(t, accent) {
  const n = actx.createBufferSource(); n.buffer = noise();
  const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = actx.createGain(); env(g, t, accent ? 0.3 : 0.18, 0.05);
  n.connect(hp); hp.connect(g); g.connect(drumBus); n.start(t); n.stop(t + 0.06);
}
/**
 * 드럼 패턴: 칸 i에서 울릴 악기 목록. BEAT = 한 박의 칸 수, slots = 한 마디 칸 수.
 *  rock: 하이햇 8분, 킥 홀수 박, 스네어 짝수 박
 *  pop: rock + 3박 뒷박에 킥 하나 더
 *  ballad: 하프타임. 하이햇 박마다, 킥 1박, 스네어 3박
 */
export function drumHits(style, i, BEAT, slots) {
  if (!style || style === 'off') return [];
  const beat = Math.floor(i / BEAT), sub = i % BEAT, beats = slots / BEAT, hits = [];
  const half = Math.floor(BEAT / 2);
  if (style === 'ballad') {
    if (sub === 0 || sub === half) hits.push(sub === 0 ? 'hat!' : 'hat');
    if (beat === 0 && sub === 0) hits.push('kick');
    if (beats >= 3 && beat === Math.floor(beats / 2) && sub === 0) hits.push('snare');
    else if (beats < 3 && beat === 1 && sub === 0) hits.push('snare');
    return hits;
  }
  if (i % 2 === 0) hits.push(sub === 0 ? 'hat!' : 'hat');
  if (sub === 0) hits.push(beat % 2 === 0 ? 'kick' : 'snare');
  if (style === 'pop' && beat === 2 && sub === half && BEAT >= 4) hits.push('kick');
  return hits;
}
/** 스윙: 홀수 16분음표를 한 칸 길이의 swing 비율만큼 늦춘다 */
export function swingDelay(i, swing, dur) { return (swing > 0 && i % 2 === 1) ? swing * dur : 0; }
function scheduleDrums(i, t) {
  drumHits(state.drums, i, beatOf(state), SL).forEach((h) => {
    if (h === 'kick') kick(t); else if (h === 'snare') snare(t); else hat(t, h === 'hat!');
  });
}

function scheduleSlot(pos, t) {
  const { m, i } = posToMI(pos), meas = state.measures[m];
  if (!meas) return;
  const midis = TUNINGS[state.tuning].midi, dur = slotDur(), notes = [], BEAT = beatOf(state);
  if (state.metro && i % BEAT === 0) click(t, i === 0);
  scheduleDrums(i, t);
  for (let s = STRINGS - 1; s >= 0; s--) {
    const v = meas[s][i]; if (!v) continue;
    const p = parse(v);
    if (p.mod === '.') { stopVoice(active[s], t); active[s] = null; continue; } // 끊기
    if (!p.num && p.mod !== 'x') continue;
    notes.push({ s, p });
  }
  const spread = notes.length >= 3 ? 0.009 : 0.004, pm = !!(state.pm && state.pm[m + ':' + i]);
  notes.forEach((nt, idx) => {
    const s = nt.s, p = nt.p, ts = t + idx * spread;
    stopVoice(active[s], ts); active[s] = null;
    const muted = (p.mod === 'x'), midi = midis[s] + (p.num ? +p.num : 0), soft = (p.mod === 'h' || p.mod === 'p');
    const o = { muted, soft, pm: pm && !muted, vel: muted ? 0.5 : (soft ? 0.5 : (pm ? 0.62 : 0.72)), mod: p.mod };
    if ((p.mod === '/' || p.mod === '\\') && p.num) {
      const nx = nextNoteOnString(state.measures, m, s, i, SL);
      if (nx) { o.slideRatio = Math.pow(2, (nx.fret - (+p.num)) / 12); o.slideFrom = ts + Math.min(dur * 0.5, 0.08); o.slideTo = t + nx.dist * dur; }
    }
    active[s] = playNote(midi, ts, o);
  });
}
/** 입력 시 미리듣기. notes: [{s, fret}] */
export function preview(notes) {
  if (!state.preview || !notes.length || pb.playing) return;
  if (!ensureAudio()) return;
  const t = actx.currentTime + 0.02, midis = TUNINGS[state.tuning].midi;
  previewVoices.forEach((v) => { stopVoice(v, t); }); previewVoices = [];
  notes.sort((a, b) => b.s - a.s).forEach((nt, idx) => {
    const ts = t + idx * (notes.length >= 3 ? 0.012 : 0.005);
    const v = playNote(midis[nt.s] + nt.fret, ts, { vel: 0.6 });
    v.g.gain.setTargetAtTime(0, ts + 1.1, 0.08);
    try { v.src.stop(ts + 1.6); } catch (e) { /* 무시 */ }
    previewVoices.push(v);
  });
}
function scheduleHL(pos, t) {
  const ms = Math.max(0, (t - actx.currentTime) * 1000);
  hlTimers.push(setTimeout(() => { highlight(pos); }, ms));
  if (hlTimers.length > 240) hlTimers.splice(0, 120);
}
function highlight(pos) {
  clearHL();
  const { m, i } = posToMI(pos);
  if (!dom.cells[m]) return;
  pb.lastHL = { m, i, pos };
  for (let s = 0; s < STRINGS; s++) dom.cells[m][s][i].classList.add('play');
  if (i === 0) updateInfo();
  if (i % beatOf(state) === 0) { const top = dom.cells[m][0][i]; if (top.scrollIntoView) top.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
function clearHL() {
  if (pb.lastHL === null) return;
  const { m, i } = pb.lastHL;
  if (dom.cells[m]) for (let s = 0; s < STRINGS; s++) dom.cells[m][s][i].classList.remove('play');
  pb.lastHL = null;
}
export function applyLoopMarks() {
  dom.rulers.forEach((r) => { if (r) r.classList.remove('loop'); });
  if (!pb.playing || !loopOn) return;
  for (let k = Math.floor(loopA / SL); k < Math.ceil(loopB / SL); k++) { const r = dom.rulers[order[k]]; if (r) r.classList.add('loop'); }
}
/** 반복 기호를 펼친 마디 순서 */
export function playOrder() { return expandRepeats(state.measures.length, state.rep); }
export function startPlay(fromPos) {
  if (!ensureAudio()) { toast('이 브라우저는 소리 재생을 지원하지 않아요'); return; }
  stopPlay();
  const sel = ed.sel, tr = state.trainer || {};
  SL = slotsOf(state);
  // 트레이너가 켜져 있으면 반복이 필요하다. 반복 없음이면 전체 반복으로 돈다.
  pb.trainer = !!tr.on;
  loopOn = state.loop !== 'none' || pb.trainer;
  pb.bpm = pb.trainer ? Math.min(tr.start, tr.max) : state.bpm;
  // 마디/줄 반복은 선택한 범위를 그대로 돌리므로 반복 기호를 펼치지 않는다
  if ((state.loop === 'measure' || state.loop === 'line') && sel) {
    order = playOrder.identity();
    if (state.loop === 'measure') { loopA = sel.m * SL; loopB = loopA + SL; }
    else { const L = Math.floor(sel.m / PER_LINE); loopA = L * PER_LINE * SL; loopB = Math.min(order.length * SL, loopA + PER_LINE * SL); }
  } else {
    order = playOrder();
    loopA = 0; loopB = order.length * SL;
  }
  let startAt;
  if (fromPos !== undefined) startAt = fromPos;
  else if (loopOn) startAt = loopA;
  else if (sel) { const k = order.indexOf(sel.m); startAt = k < 0 ? 0 : k * SL; }
  else startAt = 0;
  playPos = startAt;
  if (playPos < loopA || playPos >= loopB) playPos = loopA;
  pb.playing = true;
  $('playBtn').textContent = '■'; $('playBtn').setAttribute('aria-label', '정지');
  applyLoopMarks();
  if (pb.trainer) toast('트레이너: ' + pb.bpm + ' BPM부터 한 바퀴마다 +' + tr.step + ', 최대 ' + tr.max);
  const t0 = actx.currentTime + 0.1;
  if (state.countIn) {
    const beat = slotDur() * beatOf(state), n = SL / beatOf(state);
    for (let k = 0; k < n; k++) {
      click(t0 + k * beat, k === 0);
      hlTimers.push(setTimeout(() => { $('selInfo').textContent = '카운트 ' + (n - k); $('selInfo').classList.add('pend'); }, Math.max(0, (t0 + k * beat - actx.currentTime) * 1000)));
    }
    nextTime = t0 + n * beat;
  } else nextTime = t0;
  tick();
}
playOrder.identity = function () { const o = []; for (let m = 0; m < state.measures.length; m++) o.push(m); return o; };
function tick() {
  const dur = slotDur();
  while (nextTime < actx.currentTime + 0.25) {
    const sw = swingDelay(playPos % SL, state.swing || 0, dur); // 격자(nextTime)는 그대로 두고 소리만 늦춘다
    scheduleSlot(playPos, nextTime + sw); scheduleHL(playPos, nextTime + sw);
    nextTime += dur; playPos++;
    if (playPos >= loopB) {
      if (loopOn) {
        playPos = loopA;
        if (pb.trainer) {
          const tr = state.trainer, nb = Math.min(tr.max, pb.bpm + tr.step);
          if (nb !== pb.bpm) { pb.bpm = nb; hlTimers.push(setTimeout(updateInfo, Math.max(0, (nextTime - actx.currentTime) * 1000))); }
        }
      } else {
        const endAt = nextTime;
        hlTimers.push(setTimeout(() => { stopPlay(); }, Math.max(0, (endAt - actx.currentTime) * 1000)));
        return;
      }
    }
  }
  playTimer = setTimeout(tick, 70);
}
export function stopPlay() {
  clearTimeout(playTimer); playTimer = null;
  hlTimers.forEach(clearTimeout); hlTimers = [];
  if (actx) { const t = actx.currentTime; active.forEach((a) => { stopVoice(a, t); }); }
  active = []; pb.playing = false; pb.trainer = false; clearHL(); applyLoopMarks();
  $('playBtn').textContent = '▶'; $('playBtn').setAttribute('aria-label', '재생');
  updateInfo();
}
export function togglePlay() { if (pb.playing) stopPlay(); else startPlay(); }
export function setVolume(v) { state.volume = v; if (master) master.gain.setTargetAtTime(v, actx.currentTime, 0.02); }
export function setReverb(v) { state.reverb = v; if (revBus) revBus.gain.setTargetAtTime(v * 0.7, actx.currentTime, 0.02); }
