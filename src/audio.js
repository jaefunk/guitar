// 소리 엔진: 확장 Karplus-Strong을 오프라인 합성해 AudioBuffer로 캐시하고, 악기별 체인으로 내보낸다.
import { STRINGS, SLOTS, PER_LINE, TUNINGS, INSTR } from './constants.js';
import { state, ed } from './state.js';
import { parse, nextNoteOnString } from './tab.js';
import { $, toast } from './ui.js';
import { dom, updateInfo } from './render.js';

const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
let actx = null, master = null, comp = null, revBus = null;
const chains = {};
const bufCache = {};
let active = [], playTimer = null, hlTimers = [], playPos = 0, nextTime = 0, loopA = 0, loopB = 0, loopOn = false;
let previewVoices = [];

/** 재생 상태(다른 모듈이 읽기만 함) */
export const pb = { playing: false, lastHL: null };

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
export function synthSamples(freq, I, soft, muted, sr) {
  const len = muted ? 0.25 : I.len, N = Math.floor(sr * len);
  const out = new Float32Array(N);
  const S = muted ? 0.5 : I.S, g = muted ? 0.55 : I.g;
  const P = sr / freq - S; let Pi = Math.floor(P), frac = P - Pi;
  if (Pi < 2) { Pi = 2; frac = 0; }
  const L = Pi + 3, ring = new Float32Array(L);
  const exLen = Pi + 1, ex = new Float32Array(exLen);
  let lp = 0; const coef = Math.min(1, I.bright * (soft ? 0.55 : 1) * (muted ? 0.5 : 1));
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
function synth(freq, I, soft, muted) {
  const data = synthSamples(freq, I, soft, muted, actx.sampleRate);
  const buf = actx.createBuffer(1, data.length, actx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}
function noteBuffer(midi, soft, muted) {
  const I = INSTR[state.instr] || INSTR.acoustic;
  const key = state.instr + (muted ? 'x' : (soft ? 's' : 'n')) + midi;
  if (!bufCache[key]) bufCache[key] = synth(440 * Math.pow(2, (midi - 69) / 12), I, soft, muted);
  return bufCache[key];
}
function playNote(midi, t, o) {
  const muted = !!o.muted, src = actx.createBufferSource();
  src.buffer = noteBuffer(midi, !!o.soft, muted);
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
function slotDur() { return 60 / state.bpm / 4; }
function click(t, accent) {
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(accent ? 2300 : 1700, t); o.frequency.exponentialRampToValueAtTime(accent ? 1500 : 1100, t + 0.03);
  const g = actx.createGain(); g.gain.setValueAtTime(accent ? 0.55 : 0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.08);
}
function scheduleSlot(pos, t) {
  const m = Math.floor(pos / SLOTS), i = pos % SLOTS, meas = state.measures[m];
  if (!meas) return;
  const midis = TUNINGS[state.tuning].midi, dur = slotDur(), notes = [];
  if (state.metro && i % 4 === 0) click(t, i === 0);
  for (let s = STRINGS - 1; s >= 0; s--) {
    const v = meas[s][i]; if (!v) continue;
    const p = parse(v); if (!p.num && p.mod !== 'x') continue;
    notes.push({ s, p });
  }
  const spread = notes.length >= 3 ? 0.009 : 0.004;
  notes.forEach((nt, idx) => {
    const s = nt.s, p = nt.p, ts = t + idx * spread;
    stopVoice(active[s], ts); active[s] = null;
    const muted = (p.mod === 'x'), midi = midis[s] + (p.num ? +p.num : 0), soft = (p.mod === 'h' || p.mod === 'p');
    const o = { muted, soft, vel: muted ? 0.5 : (soft ? 0.5 : 0.72), mod: p.mod };
    if ((p.mod === '/' || p.mod === '\\') && p.num) {
      const nx = nextNoteOnString(state.measures, m, s, i);
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
  const m = Math.floor(pos / SLOTS), i = pos % SLOTS;
  if (!dom.cells[m]) return;
  pb.lastHL = pos;
  for (let s = 0; s < STRINGS; s++) dom.cells[m][s][i].classList.add('play');
  if (i === 0) updateInfo();
  if (i % 4 === 0) { const top = dom.cells[m][0][i]; if (top.scrollIntoView) top.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}
function clearHL() {
  if (pb.lastHL === null) return;
  const m = Math.floor(pb.lastHL / SLOTS), i = pb.lastHL % SLOTS;
  if (dom.cells[m]) for (let s = 0; s < STRINGS; s++) dom.cells[m][s][i].classList.remove('play');
  pb.lastHL = null;
}
export function applyLoopMarks() {
  dom.rulers.forEach((r) => { if (r) r.classList.remove('loop'); });
  if (!pb.playing || !loopOn) return;
  for (let m = Math.floor(loopA / SLOTS); m < Math.ceil(loopB / SLOTS); m++) if (dom.rulers[m]) dom.rulers[m].classList.add('loop');
}
export function startPlay(fromPos) {
  if (!ensureAudio()) { toast('이 브라우저는 소리 재생을 지원하지 않아요'); return; }
  stopPlay();
  const sel = ed.sel, total = state.measures.length * SLOTS;
  loopOn = state.loop !== 'none';
  if (state.loop === 'measure' && sel) { loopA = sel.m * SLOTS; loopB = loopA + SLOTS; }
  else if (state.loop === 'line' && sel) { const L = Math.floor(sel.m / PER_LINE); loopA = L * PER_LINE * SLOTS; loopB = Math.min(total, loopA + PER_LINE * SLOTS); }
  else { loopA = 0; loopB = total; }
  playPos = (fromPos !== undefined) ? fromPos : (loopOn ? loopA : (sel ? sel.m * SLOTS : 0));
  if (playPos < loopA || playPos >= loopB) playPos = loopA;
  pb.playing = true;
  $('playBtn').textContent = '■'; $('playBtn').setAttribute('aria-label', '정지');
  applyLoopMarks();
  const t0 = actx.currentTime + 0.1;
  if (state.countIn) {
    const beat = slotDur() * 4;
    for (let k = 0; k < 4; k++) {
      click(t0 + k * beat, k === 0);
      hlTimers.push(setTimeout(() => { $('selInfo').textContent = '카운트 ' + (4 - k); $('selInfo').classList.add('pend'); }, Math.max(0, (t0 + k * beat - actx.currentTime) * 1000)));
    }
    nextTime = t0 + 4 * beat;
  } else nextTime = t0;
  tick();
}
function tick() {
  const dur = slotDur();
  while (nextTime < actx.currentTime + 0.25) {
    scheduleSlot(playPos, nextTime); scheduleHL(playPos, nextTime);
    nextTime += dur; playPos++;
    if (playPos >= loopB) {
      if (loopOn) playPos = loopA;
      else {
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
  active = []; pb.playing = false; clearHL(); applyLoopMarks();
  $('playBtn').textContent = '▶'; $('playBtn').setAttribute('aria-label', '재생');
  updateInfo();
}
export function togglePlay() { if (pb.playing) stopPlay(); else startPlay(); }
export function setVolume(v) { state.volume = v; if (master) master.gain.setTargetAtTime(v, actx.currentTime, 0.02); }
export function setReverb(v) { state.reverb = v; if (revBus) revBus.gain.setTargetAtTime(v * 0.7, actx.currentTime, 0.02); }
