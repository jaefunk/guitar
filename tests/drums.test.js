import { describe, it, expect } from 'vitest';
import { drumHits, swingDelay } from '../src/audio.js';

describe('드럼 패턴', () => {
  it('끔이면 아무것도 없다', () => { expect(drumHits('off', 0, 4, 16)).toEqual([]); expect(drumHits(null, 0, 4, 16)).toEqual([]); });
  it('rock 4/4: 킥 1·3박, 스네어 2·4박, 하이햇 8분', () => {
    const kicks = [], snares = [], hats = [];
    for (let i = 0; i < 16; i++) { const h = drumHits('rock', i, 4, 16); if (h.indexOf('kick') >= 0) kicks.push(i); if (h.indexOf('snare') >= 0) snares.push(i); if (h.some((x) => x.indexOf('hat') === 0)) hats.push(i); }
    expect(kicks).toEqual([0, 8]); expect(snares).toEqual([4, 12]);
    expect(hats).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(drumHits('rock', 0, 4, 16)).toContain('hat!');
  });
  it('pop은 3박 뒷박에 킥이 하나 더', () => {
    expect(drumHits('pop', 10, 4, 16)).toContain('kick');
    expect(drumHits('rock', 10, 4, 16)).not.toContain('kick');
  });
  it('ballad는 하프타임: 킥 1박, 스네어 3박', () => {
    const kicks = [], snares = [];
    for (let i = 0; i < 16; i++) { const h = drumHits('ballad', i, 4, 16); if (h.indexOf('kick') >= 0) kicks.push(i); if (h.indexOf('snare') >= 0) snares.push(i); }
    expect(kicks).toEqual([0]); expect(snares).toEqual([8]);
  });
  it('3/4와 6/8에서도 박 수에 맞춘다', () => {
    const s34 = []; for (let i = 0; i < 12; i++) if (drumHits('rock', i, 4, 12).indexOf('snare') >= 0) s34.push(i);
    expect(s34).toEqual([4]);
    const k68 = []; for (let i = 0; i < 12; i++) if (drumHits('rock', i, 6, 12).indexOf('kick') >= 0) k68.push(i);
    expect(k68).toEqual([0]);
    expect(drumHits('rock', 6, 6, 12)).toContain('snare');
  });
});

describe('스윙', () => {
  it('홀수 칸만 늦춘다', () => {
    expect(swingDelay(0, 0.5, 0.1)).toBe(0);
    expect(swingDelay(1, 0.5, 0.1)).toBeCloseTo(0.05);
    expect(swingDelay(3, 0, 0.1)).toBe(0);
  });
});
