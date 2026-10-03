import { describe, it, expect } from 'vitest';
import { synthSamples } from '../src/audio.js';
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

describe('Karplus-Strong 피치', () => {
  const sr = 44100;
  const midis = [40, 45, 52, 59, 64, 69, 76, 81, 88]; // E2 ~ E6
  Object.keys(INSTR).forEach((k) => {
    it(k + ': 전 음역에서 ±1센트 이내', () => {
      midis.forEach((midi) => {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        const data = synthSamples(f, INSTR[k], false, false, sr);
        expect(data.length).toBe(Math.floor(sr * INSTR[k].len));
        const got = measureFreq(data, sr, f);
        const tol = midi >= 88 ? 2.5 : 1;
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
    expect(data[0]).toBe(0);
    expect(data[data.length - 1]).toBe(0);
  });
});
