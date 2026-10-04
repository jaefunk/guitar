import { describe, it, expect } from 'vitest';
import { toText, parseText } from '../src/io.js';
import { emptyMeasure } from '../src/tab.js';

function song(o) {
  return Object.assign({ title: '', tuning: 'standard', bpm: 90, measures: [], marks: {} }, o);
}
function withNotes(spec) {
  // spec: [[m,s,i,'v'],...]
  const n = Math.max.apply(null, spec.map((x) => x[0])) + 1;
  const ms = [];
  for (let k = 0; k < Math.ceil(n / 4) * 4; k++) ms.push(emptyMeasure());
  spec.forEach((x) => { ms[x[0]][x[1]][x[2]] = x[3]; });
  return ms;
}

describe('텍스트 타브 왕복', () => {
  it('빈 악보', () => {
    const s = song({ measures: withNotes([[7, 0, 0, '']]) });
    expect(parseText(toText(s))).toEqual(s.measures);
  });
  it('한 자리/두 자리/기법/뮤트 섞인 악보', () => {
    const s = song({
      title: '테스트 곡', bpm: 120,
      measures: withNotes([[0, 0, 0, '0'], [0, 1, 0, '1'], [0, 5, 15, '12h'], [1, 2, 3, 'x'], [1, 3, 4, '7b'], [2, 4, 8, '24'], [3, 0, 12, '5/'], [3, 1, 13, '3\\'], [5, 2, 2, '9~']]),
      marks: { '0:0': 'Am', '1:8': 'Chorus', '5:0': 'G/B' }
    });
    const txt = toText(s);
    expect(txt.split('\n')[0]).toBe('테스트 곡');
    expect(txt).toContain('(BPM 120');
    expect(txt).toContain('Am');
    expect(parseText(txt)).toEqual(s.measures);
  });
  it('기법만 단독인 칸(h)도 살아남는다', () => {
    const s = song({ measures: withNotes([[0, 0, 0, 'h'], [0, 0, 1, '5']]) });
    expect(parseText(toText(s))).toEqual(s.measures);
  });
  it('다른 튜닝(두 글자 줄 이름)', () => {
    const s = song({ tuning: 'half', measures: withNotes([[0, 0, 0, '3'], [2, 5, 7, '10']]) });
    const txt = toText(s);
    expect(txt).toContain('eb|');
    expect(txt).toContain('Eb|');
    expect(parseText(txt)).toEqual(s.measures);
  });
  it('셀 폭은 가장 긴 값(최소 2)에 맞춘다', () => {
    const narrow = toText(song({ measures: withNotes([[0, 0, 0, '5']]) }));
    const wide = toText(song({ measures: withNotes([[0, 0, 0, '12h']]) }));
    const row = (t) => t.split('\n').find((l) => /^e\|/.test(l));
    expect(row(narrow).length).toBe(2 + 4 * (16 * 2 + 1));
    expect(row(wide).length).toBe(2 + 4 * (16 * 3 + 1));
  });
  it('CRLF 줄바꿈도 읽는다', () => {
    const s = song({ measures: withNotes([[1, 1, 1, '2']]) });
    expect(parseText(toText(s).replace(/\n/g, '\r\n'))).toEqual(s.measures);
  });
});

describe('parseText 실패 조건', () => {
  it('타브 줄이 없으면 null', () => {
    expect(parseText('그냥 글자')).toBeNull();
    expect(parseText('')).toBeNull();
  });
  it('마디 길이가 16의 배수가 아니면 null', () => {
    const bad = ['e|---|', 'B|---|', 'G|---|', 'D|---|', 'A|---|', 'E|---|'].join('\n');
    expect(parseText(bad)).toBeNull();
  });
  it('줄마다 마디 길이가 다르면 null', () => {
    const ok = '-'.repeat(32);
    const bad = ['e|' + ok + '|', 'B|' + ok + '|', 'G|' + ok + '|', 'D|' + ok + '|', 'A|' + '-'.repeat(33) + '|', 'E|' + ok + '|'].join('\n');
    expect(parseText(bad)).toBeNull();
  });
  it('6줄 미만 묶음은 무시한다', () => {
    const ok = '-'.repeat(32);
    const five = ['e|' + ok + '|', 'B|' + ok + '|', 'G|' + ok + '|', 'D|' + ok + '|', 'A|' + ok + '|'].join('\n');
    expect(parseText(five)).toBeNull();
  });
});
