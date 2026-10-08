import { describe, it, expect } from 'vitest';
import { createScoreClickAdapter, createScoreVoiceAdapter, synthSamples } from '../src/audio.js';
import { INSTR } from '../src/constants.js';

/**
 * 0.05~0.3초 구간 자기상관 + 포물선 보간으로 기본 주파수 측정.
 * (높은 음은 빨리 감쇠해서 늦은 구간은 잡음이 섞인다. 주기가 33샘플인 E6에서는
 *  보간 자체의 정밀도가 1~2센트라 그 음만 느슨한 허용치를 쓴다.)
 */
function measureFreq(data, sr, expected) {
  const a = Math.floor(sr * 0.05), b = Math.floor(sr * 0.3);
  const lag0 = sr / expected;
  const lo = Math.floor(lag0 * 0.97), hi = Math.ceil(lag0 * 1.03);
  let best = lo, bestV = -Infinity;
  const r = {};
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let n = a; n < b; n++) s += data[n] * data[n + lag];
    r[lag] = s;
    if (lag >= lo && lag <= hi && s > bestV) { bestV = s; best = lag; }
  }
  const y0 = r[best - 1], y1 = r[best], y2 = r[best + 1];
  const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2));
  return sr / (best + d);
}
const cents = (f, ref) => 1200 * Math.log2(f / ref);
/** 여기 노이즈가 무작위라 측정값이 조금씩 흔들린다 → 3번 합성해 중앙값을 쓴다 */
function medianFreq(f, I, sr) {
  const got = [0, 1, 2].map(() => measureFreq(synthSamples(f, I, false, false, sr), sr, f)).sort((a, b) => a - b);
  return got[1];
}

describe('Karplus-Strong 피치', () => {
  const sr = 44100;
  const midis = [40, 45, 52, 59, 64, 69, 76, 81, 88]; // E2 ~ E6
  Object.keys(INSTR).forEach((k) => {
    it(k + ': 전 음역에서 ±1센트 이내', () => {
      midis.forEach((midi) => {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        expect(synthSamples(f, INSTR[k], false, false, sr).length).toBe(Math.floor(sr * INSTR[k].len));
        const got = medianFreq(f, INSTR[k], sr);
        const tol = midi >= 88 ? 3 : 1;
        expect(Math.abs(cents(got, f)), k + ' midi ' + midi + ' got ' + got.toFixed(3)).toBeLessThan(tol);
      });
    });
  });
  it('뮤트 버퍼는 짧고, 피크가 0.8을 넘지 않는다', () => {
    const data = synthSamples(110, INSTR.acoustic, false, true, sr);
    expect(data.length).toBe(Math.floor(sr * 0.25));
    let peak = 0; for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    expect(peak).toBeLessThanOrEqual(0.8);
    expect(peak).toBeGreaterThan(0.5);
    expect(Math.abs(data[0])).toBe(0);
    expect(Math.abs(data[data.length - 1])).toBe(0);
  });
});

describe('score voice adapter', () => {
  it('maps score plan technique data to the existing synth voice and exposes stop only', () => {
    const calls = [];
    const voice = { id: 'voice' };
    const adapter = createScoreVoiceAdapter({
      play: (midi, at, options) => { calls.push(['play', midi, at, options]); return voice; },
      stop: (handle, at) => { calls.push(['stop', handle, at]); }
    });

    const handle = adapter.schedule({
      midi: 57, velocity: 0.42, muted: false, bendSemitones: 0.5,
      legato: [{ type: 'slide', targetMidi: 60 }], durationSeconds: 1
    }, 12);
    adapter.stop(handle, 12.5);

    expect(handle).toBe(voice);
    expect(calls[0]).toEqual(['play', 57, 12, expect.objectContaining({
      vel: 0.42, bendSemitones: 0.5, slideRatio: Math.pow(2, 3 / 12), slideFrom: 12, slideTo: 13
    })]);
    expect(calls[1]).toEqual(['stop', voice, 12.5]);
    expect(Object.keys(adapter)).toEqual(['schedule', 'stop']);
  });

  it('maps an incoming legato target to a softened attack instead of softening its source', () => {
    const calls = [];
    const adapter = createScoreVoiceAdapter({
      play: (midi, at, options) => { calls.push({ midi, at, options }); return {}; },
      stop: () => {}
    });

    adapter.schedule({
      midi: 60, velocity: 0.72, attack: 'normal', legato: [{ type: 'hammer-on', targetMidi: 62 }],
      durationSeconds: 1
    }, 1);
    adapter.schedule({
      midi: 62, velocity: 0.4, attack: 'legato', legatoFrom: [{ type: 'hammer-on' }],
      durationSeconds: 1
    }, 2);

    expect(calls[0].options).toMatchObject({ soft: false, attack: 'normal', vel: 0.72 });
    expect(calls[1].options).toMatchObject({ soft: true, attack: 'legato', vel: 0.4 });
  });
});

describe('score click adapter', () => {
  it('returns an opaque click handle and stops it without exposing oscillator internals', () => {
    const calls = [];
    const handle = { id: 'click' };
    const adapter = createScoreClickAdapter({
      schedule: (at, accent) => { calls.push(['schedule', at, accent]); return handle; },
      stop: (value, at) => { calls.push(['stop', value, at]); }
    });

    expect(adapter.schedule(4, true)).toBe(handle);
    adapter.stop(handle, 3);
    expect(calls).toEqual([['schedule', 4, true], ['stop', handle, 3]]);
    expect(Object.keys(adapter)).toEqual(['schedule', 'stop']);
  });

  it('ignores stop errors from an already-ended click handle', () => {
    const adapter = createScoreClickAdapter({
      schedule: () => ({}),
      stop: () => { throw new Error('already ended'); }
    });

    expect(() => adapter.stop({}, 5)).not.toThrow();
  });
});
