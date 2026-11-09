import { describe, it, expect } from 'vitest';
import { parse, nextDigit, applyMod, shiftMarks, padMeasures, emptyMeasure, nextNoteOnString, prevPos, hasContent, resizeMeasures, slotsOf, beatOf, validMeasures, sliceRange, pasteRange, clearRange, transposeMeasures, transposeRange, shiftRange, togglePm, allPm, colRange, measureRange, expandRepeats, shiftRep, cleanRep, voltaList, voltaLabel, parseVolta } from '../src/tab.js';
import { SLOTS, PER_LINE } from '../src/constants.js';

describe('parse', () => {
  it('숫자와 기법을 나눈다', () => {
    expect(parse('12h')).toEqual({ num: '12', mod: 'h' });
    expect(parse('5')).toEqual({ num: '5', mod: '' });
    expect(parse('x')).toEqual({ num: '', mod: 'x' });
    expect(parse('')).toEqual({ num: '', mod: '' });
    expect(parse(undefined)).toEqual({ num: '', mod: '' });
  });
});

describe('nextDigit (두 자리 입력 규칙)', () => {
  it('1/2를 누르면 두 자리를 기다린다', () => {
    expect(nextDigit('', '1', false)).toEqual({ value: '1', num: '1', pending: true });
    expect(nextDigit('', '2', false)).toEqual({ value: '2', num: '2', pending: true });
    expect(nextDigit('', '3', false)).toEqual({ value: '3', num: '3', pending: false });
  });
  it('대기 중이면 합친다(24 이하)', () => {
    expect(nextDigit('1', '2', true)).toEqual({ value: '12', num: '12', pending: false });
    expect(nextDigit('2', '4', true)).toEqual({ value: '24', num: '24', pending: false });
    expect(nextDigit('2', '5', true)).toEqual({ value: '5', num: '5', pending: false });
  });
  it('대기 중이 아니면 교체한다', () => {
    expect(nextDigit('1', '2', false)).toEqual({ value: '2', num: '2', pending: true });
    expect(nextDigit('12', '3', true)).toEqual({ value: '3', num: '3', pending: false });
  });
  it('기법은 유지한다', () => {
    expect(nextDigit('1h', '2', true)).toEqual({ value: '12h', num: '12', pending: false });
    expect(nextDigit('7b', '5', false)).toEqual({ value: '5b', num: '5', pending: false });
  });
});

describe('applyMod (기법 붙이기 규칙)', () => {
  it('x와 .(끊기)는 단독으로 현재 칸에', () => {
    expect(applyMod('7', '5', 'x')).toEqual({ target: 'cur', value: 'x', advance: true });
    expect(applyMod('', '5', '.')).toEqual({ target: 'cur', value: '.', advance: true });
    expect(parse('.')).toEqual({ num: '', mod: '.' });
  });
  it('현재 칸에 숫자가 있으면 붙인다', () => {
    expect(applyMod('7', '5', 'h')).toEqual({ target: 'cur', value: '7h', advance: true });
    expect(applyMod('7b', '', '~')).toEqual({ target: 'cur', value: '7~', advance: true });
  });
  it('현재 칸이 비어 있으면 이전 음에 붙인다', () => {
    expect(applyMod('', '5', 'h')).toEqual({ target: 'prev', value: '5h', advance: false });
    expect(applyMod('', '12p', '/')).toEqual({ target: 'prev', value: '12/', advance: false });
  });
  it('이전 음도 없으면 단독 저장', () => {
    expect(applyMod('', '', 'h')).toEqual({ target: 'cur', value: 'h', advance: false });
    expect(applyMod('', null, 'h')).toEqual({ target: 'cur', value: 'h', advance: false });
    expect(applyMod('', 'x', 'h')).toEqual({ target: 'cur', value: 'h', advance: false });
  });
});

describe('shiftMarks', () => {
  const marks = { '0:0': 'A', '2:4': 'B', '3:0': 'C', '5:8': 'D' };
  it('삽입: fromM 이상을 뒤로 민다', () => {
    expect(shiftMarks(marks, 2, 1)).toEqual({ '0:0': 'A', '3:4': 'B', '4:0': 'C', '6:8': 'D' });
  });
  it('삭제: fromM 마디 메모는 버리고 뒤를 당긴다', () => {
    expect(shiftMarks(marks, 2, -1)).toEqual({ '0:0': 'A', '2:0': 'C', '4:8': 'D' });
  });
  it('줄 삭제: 4마디를 한 번에', () => {
    expect(shiftMarks(marks, 4, -4)).toEqual({ '0:0': 'A', '2:4': 'B', '3:0': 'C' });
  });
  it('원본을 바꾸지 않는다', () => {
    shiftMarks(marks, 0, 1);
    expect(marks).toEqual({ '0:0': 'A', '2:4': 'B', '3:0': 'C', '5:8': 'D' });
  });
});

describe('padMeasures / 기타', () => {
  it('마디 수를 4의 배수로 채운다', () => {
    const ms = [emptyMeasure()];
    padMeasures(ms);
    expect(ms.length).toBe(PER_LINE);
    padMeasures(ms);
    expect(ms.length).toBe(PER_LINE);
  });
  it('prevPos는 마디 경계를 넘는다', () => {
    expect(prevPos({ m: 1, s: 2, i: 0 })).toEqual({ m: 0, s: 2, i: SLOTS - 1 });
    expect(prevPos({ m: 1, s: 2, i: 0 }, 12)).toEqual({ m: 0, s: 2, i: 11 });
    expect(prevPos({ m: 0, s: 2, i: 0 })).toBeNull();
  });
  it('박자표 헬퍼와 마디 크기 조정', () => {
    expect(slotsOf({ meter: '3/4' })).toBe(12);
    expect(beatOf({ meter: '6/8' })).toBe(6);
    expect(slotsOf({ meter: 'nope' })).toBe(16);
    const ms = [emptyMeasure()];
    ms[0][0][0] = '1'; ms[0][0][15] = '9';
    const small = resizeMeasures(ms, 12);
    expect(small[0][0].length).toBe(12);
    expect(small[0][0][0]).toBe('1');
    const big = resizeMeasures(small, 20);
    expect(big[0][0].length).toBe(20);
    expect(big[0][0][19]).toBe('');
    expect(validMeasures(small)).toBe(true);
    expect(validMeasures(small, 12)).toBe(true);
    expect(validMeasures(small, 16)).toBe(false);
    expect(padMeasures([emptyMeasure(12)]).every((m) => m[0].length === 12)).toBe(true);
  });
  it('nextNoteOnString은 같은 줄 다음 음을 찾는다', () => {
    const ms = [emptyMeasure(), emptyMeasure()];
    ms[0][3][2] = '5/';
    ms[1][3][1] = '7';
    expect(nextNoteOnString(ms, 0, 3, 2)).toEqual({ fret: 7, dist: SLOTS - 1 });
    ms[0][3][5] = 'x';
    expect(nextNoteOnString(ms, 0, 3, 2)).toBeNull();
    ms[0][3][5] = '.';
    expect(nextNoteOnString(ms, 0, 3, 2)).toBeNull();
    expect(hasContent(ms)).toBe(true);
  });
});

describe('범위 연산 (칸 단위)', () => {
  function mk() {
    const ms = [];
    for (let k = 0; k < 8; k++) ms.push(emptyMeasure());
    ms[1][0][0] = '5'; ms[1][2][4] = '7h'; ms[2][5][15] = '0'; ms[3][1][0] = 'x';
    return { meter: '4/4', measures: ms, marks: { '1:0': 'A', '2:8': 'B', '5:0': 'C' }, pm: { '1:0': 1, '1:1': 1 }, rep: { 1: { s: 1 }, 2: { e: 2 } } };
  }
  const R = (fm, fi, tm, ti) => ({ from: { m: fm, i: fi }, to: { m: tm, i: ti } });
  it('colRange: 전역 칸 번호, 정렬 여부, 뒤집힌 범위', () => {
    expect(colRange(R(1, 0, 2, 15), 16)).toEqual({ gA: 16, gB: 47, n: 32, aligned: true, fromM: 1, toM: 2 });
    expect(colRange(R(2, 3, 1, 4), 16)).toMatchObject({ gA: 20, gB: 35, n: 16, aligned: false });
    expect(measureRange(2, 1, 12)).toEqual({ from: { m: 1, i: 0 }, to: { m: 2, i: 11 } });
  });
  it('sliceRange: 마디 단위면 반복 기호까지, 칸 단위면 칸만', () => {
    const c = sliceRange(mk(), measureRange(1, 2, 16));
    expect(c.n).toBe(32); expect(c.aligned).toBe(true);
    expect(c.cells[0][0]).toBe('5'); expect(c.cells[5][31]).toBe('0');
    expect(c.marks).toEqual({ 0: 'A', 24: 'B' });
    expect(c.pm).toEqual({ 0: 1, 1: 1 });
    expect(c.rep).toEqual({ 0: { s: 1 }, 1: { e: 2 } });
    const d = sliceRange(mk(), R(1, 2, 1, 5));
    expect(d.n).toBe(4); expect(d.aligned).toBe(false); expect(d.cells[2][2]).toBe('7h'); expect(d.rep).toEqual({});
  });
  it('pasteRange: 덮어쓰고 필요하면 마디를 늘리며, 마디 첫 칸에 붙일 때만 반복 기호를 옮긴다', () => {
    const song = mk(), c = sliceRange(song, measureRange(1, 2, 16));
    pasteRange(song, c, 7 * 16);
    expect(song.measures.length).toBe(12);
    expect(song.measures[7][0][0]).toBe('5');
    expect(song.measures[8][5][15]).toBe('0');
    expect(song.marks['7:0']).toBe('A'); expect(song.marks['8:8']).toBe('B');
    expect(song.pm['7:1']).toBe(1);
    expect(song.rep[7]).toEqual({ s: 1 }); expect(song.rep[8]).toEqual({ e: 2 });
    // 칸 단위 붙여넣기: 마디 경계를 넘어가며 칸만 덮어쓴다
    const d = sliceRange(song, R(1, 0, 1, 4)); // 5칸: '5' + 7h(칸4)
    pasteRange(song, d, 3 * 16 + 14);
    expect(song.measures[3][0][14]).toBe('5');
    expect(song.measures[4][2][2]).toBe('7h');
    expect(song.marks['3:14']).toBe('A');
    expect(song.rep[3]).toBeUndefined();
  });
  it('clearRange는 칸만 비우고 마디 수는 그대로', () => {
    const song = mk();
    clearRange(song, R(1, 0, 1, 7));
    expect(song.measures.length).toBe(8);
    expect(song.measures[1][0][0]).toBe(''); expect(song.measures[1][2][4]).toBe('');
    expect(song.marks['1:0']).toBeUndefined(); expect(song.pm['1:0']).toBeUndefined();
    expect(song.marks['2:8']).toBe('B');
  });
  it('transposeMeasures/transposeRange: 기법 유지, 범위 밖이면 null', () => {
    const song = mk(), ms = song.measures;
    const up = transposeMeasures(ms, 2);
    expect(up[1][0][0]).toBe('7'); expect(up[1][2][4]).toBe('9h'); expect(up[3][1][0]).toBe('x');
    expect(transposeMeasures(ms, -1)).toBeNull();
    expect(transposeMeasures(ms, 20)).toBeNull();
    const part = transposeRange(song, R(1, 0, 1, 15), 12);
    expect(part[1][2][4]).toBe('19h'); expect(part[2][5][15]).toBe('0');
    expect(transposeRange(song, R(2, 0, 2, 15), -1)).toBeNull();
    expect(ms[1][0][0]).toBe('5');
  });
  it('shiftRange: 범위 안에서 칸을 밀고 메모·팜뮤트도 따라간다', () => {
    const song = mk();
    const r = shiftRange(song, measureRange(1, 2, 16), 1);
    expect(r.measures[1][0][1]).toBe('5'); expect(r.measures[1][0][0]).toBe('');
    expect(r.measures[2][5][15]).toBe('');
    expect(r.measures[3][1][0]).toBe('x');
    expect(r.marks).toEqual({ '1:1': 'A', '2:9': 'B', '5:0': 'C' });
    expect(r.pm).toEqual({ '1:1': 1, '1:2': 1 });
    const l = shiftRange(song, measureRange(1, 2, 16), -1);
    expect(l.measures[1][2][3]).toBe('7h'); expect(l.measures[1][0][0]).toBe('');
    expect(l.measures[2][5][14]).toBe('0'); expect(l.marks['2:7']).toBe('B'); expect(l.pm).toEqual({ '1:0': 1 });
    const part = shiftRange(song, R(1, 3, 1, 4), -1);
    expect(part.measures[1][2][3]).toBe('7h'); expect(part.measures[1][0][0]).toBe('5');
  });
  it('togglePm / allPm', () => {
    const pm = togglePm({}, measureRange(0, 1, 4), 4);
    expect(Object.keys(pm).length).toBe(8);
    expect(allPm(pm, measureRange(0, 1, 4), 4)).toBe(true);
    expect(allPm(pm, measureRange(0, 2, 4), 4)).toBe(false);
    const off = togglePm(pm, measureRange(0, 0, 4), 4);
    expect(Object.keys(off).length).toBe(4);
    const on = togglePm(off, measureRange(0, 1, 4), 4);
    expect(Object.keys(on).length).toBe(8);
    const cols = togglePm({}, R(0, 1, 0, 2), 4);
    expect(cols).toEqual({ '0:1': 1, '0:2': 1 });
  });
});

describe('반복 기호 펼치기', () => {
  it('기호가 없으면 그대로', () => {
    expect(expandRepeats(4, {})).toEqual([0, 1, 2, 3]);
    expect(expandRepeats(4, null)).toEqual([0, 1, 2, 3]);
  });
  it(':|| 만 있으면 곡 처음으로', () => {
    expect(expandRepeats(4, { 1: { e: 2 } })).toEqual([0, 1, 0, 1, 2, 3]);
  });
  it('||: 와 횟수', () => {
    expect(expandRepeats(4, { 1: { s: 1 }, 2: { e: 3 } })).toEqual([0, 1, 2, 1, 2, 1, 2, 3]);
  });
  it('1·2번 괄호', () => {
    expect(expandRepeats(4, { 1: { v: 1, e: 2 }, 2: { v: 2 } })).toEqual([0, 1, 0, 2, 3]);
    expect(expandRepeats(5, { 0: { s: 1 }, 1: { v: 1, e: 2 }, 2: { v: 2 }, 3: { e: 2 } })).toEqual([0, 1, 0, 2, 3, 3, 4]);
  });
  it('세 번 반복과 1·2·3번 괄호', () => {
    expect(expandRepeats(5, { 1: { v: 1, e: 3 }, 2: { v: 2, e: 3 }, 3: { v: 3 } })).toEqual([0, 1, 0, 2, 0, 3, 4]);
  });
  it('연속된 두 반복 구간은 서로 독립', () => {
    expect(expandRepeats(4, { 1: { e: 2 }, 3: { e: 2 } })).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });
  it('shiftRep / cleanRep', () => {
    const rep = { 1: { s: 1 }, 3: { e: 2 }, 5: { v: 1 } };
    expect(shiftRep(rep, 2, 1)).toEqual({ 1: { s: 1 }, 4: { e: 2 }, 6: { v: 1 } });
    expect(shiftRep(rep, 3, -1)).toEqual({ 1: { s: 1 }, 4: { v: 1 } });
    expect(shiftRep(rep, 0, -4)).toEqual({ 1: { v: 1 } });
    expect(cleanRep({ 0: {}, 1: { s: 0 }, 2: { e: 2 } })).toEqual({ 2: { e: 2 } });
  });
  it('sliceRange/pasteRange가 반복 기호를 함께 옮긴다', () => {
    const song = { meter: '4/4', measures: [emptyMeasure(), emptyMeasure(), emptyMeasure(), emptyMeasure()], marks: {}, pm: {}, rep: { 1: { s: 1 }, 2: { e: 2 } } };
    const c = sliceRange(song, measureRange(1, 2, 16));
    expect(c.rep).toEqual({ 0: { s: 1 }, 1: { e: 2 } });
    pasteRange(song, c, 2 * 16);
    expect(song.rep).toEqual({ 1: { s: 1 }, 2: { s: 1 }, 3: { e: 2 } });
  });
  it('복수 괄호: [1,2]번 마디는 1·2번째 연주 때, 3번은 마지막에', () => {
    expect(expandRepeats(4, { 1: { v: [1, 2], e: 3 }, 2: { v: 3 } })).toEqual([0, 1, 0, 1, 0, 2, 3]);
    expect(voltaList([2, 1, 1])).toEqual([2, 1, 1]);
    expect(voltaLabel([1, 2])).toBe('1,2.'); expect(voltaLabel(3)).toBe('3.'); expect(voltaLabel(0)).toBe('');
    expect(parseVolta('1, 2')).toEqual([1, 2]); expect(parseVolta('2')).toBe(2); expect(parseVolta('abc')).toBe(0); expect(parseVolta('2,2,1')).toEqual([1, 2]);
    expect(cleanRep({ 0: { v: [] } })).toEqual({});
  });
});
