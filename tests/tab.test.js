import { describe, it, expect } from 'vitest';
import { parse, nextDigit, applyMod, shiftMarks, padMeasures, emptyMeasure, nextNoteOnString, prevPos, hasContent, resizeMeasures, slotsOf, beatOf, validMeasures, sliceRange, pasteRange, transposeMeasures, shiftCells, togglePm, allPm, expandRepeats, shiftRep, cleanRep } from '../src/tab.js';
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

describe('마디 범위 연산', () => {
  function mk() {
    const ms = [];
    for (let k = 0; k < 8; k++) ms.push(emptyMeasure());
    ms[1][0][0] = '5'; ms[1][2][4] = '7h'; ms[2][5][15] = '0'; ms[3][1][0] = 'x';
    return { meter: '4/4', measures: ms, marks: { '1:0': 'A', '2:8': 'B', '5:0': 'C' }, pm: { '1:0': 1, '1:1': 1 } };
  }
  it('sliceRange는 상대 키로 복사한다', () => {
    const c = sliceRange(mk(), 1, 2);
    expect(c.measures.length).toBe(2);
    expect(c.measures[0][0][0]).toBe('5');
    expect(c.marks).toEqual({ '0:0': 'A', '1:8': 'B' });
    expect(c.pm).toEqual({ '0:0': 1, '0:1': 1 });
  });
  it('pasteRange는 덮어쓰고 필요하면 마디를 늘린다', () => {
    const song = mk(), c = sliceRange(song, 1, 2);
    pasteRange(song, c, 7);
    expect(song.measures.length).toBe(12);
    expect(song.measures[7][0][0]).toBe('5');
    expect(song.measures[8][5][15]).toBe('0');
    expect(song.marks['7:0']).toBe('A');
    expect(song.marks['8:8']).toBe('B');
    expect(song.pm['7:1']).toBe(1);
    // 기존 메모는 지워진다
    pasteRange(song, c, 5);
    expect(song.marks['5:0']).toBe('A');
  });
  it('pasteRange는 박자표가 다른 클립을 칸 수에 맞춘다', () => {
    const song = { meter: '3/4', measures: [emptyMeasure(12)], marks: {}, pm: {} };
    const c = sliceRange(mk(), 2, 2); // 16칸, 마지막 칸에 '0'
    pasteRange(song, c, 0);
    expect(song.measures[0][5].length).toBe(12);
    expect(song.measures[0][5][11]).toBe('');
    expect(song.measures.length).toBe(4);
  });
  it('transposeMeasures: 기법 유지, 범위 밖이면 null', () => {
    const ms = mk().measures;
    const up = transposeMeasures(ms, 2);
    expect(up[1][0][0]).toBe('7');
    expect(up[1][2][4]).toBe('9h');
    expect(up[3][1][0]).toBe('x');
    expect(transposeMeasures(ms, -1)).toBeNull();   // 0 → -1
    expect(transposeMeasures(ms, 20)).toBeNull();   // 7 → 27
    expect(transposeMeasures(ms, 12)[1][2][4]).toBe('19h');
    expect(ms[1][0][0]).toBe('5'); // 원본 유지
  });
  it('shiftCells: 범위 안에서 칸을 밀고 메모·팜뮤트도 따라간다', () => {
    const song = mk();
    const r = shiftCells(song, 1, 2, 1);
    expect(r.measures[1][0][1]).toBe('5');
    expect(r.measures[1][0][0]).toBe('');
    expect(r.measures[2][5][15]).toBe('');       // 범위 끝에서 밀려나 사라짐
    expect(r.measures[3][1][0]).toBe('x');       // 범위 밖은 그대로
    expect(r.marks).toEqual({ '1:1': 'A', '2:9': 'B', '5:0': 'C' });
    expect(r.pm).toEqual({ '1:1': 1, '1:2': 1 });
    const l = shiftCells(song, 1, 2, -1);
    expect(l.measures[1][2][3]).toBe('7h');
    expect(l.measures[1][0][0]).toBe('');        // 왼쪽 끝에서 사라짐
    expect(l.measures[2][5][14]).toBe('0');
    expect(l.marks['2:7']).toBe('B');
    expect(l.pm).toEqual({ '1:0': 1 });
  });
  it('togglePm / allPm', () => {
    const pm = togglePm({}, 0, 1, 4);
    expect(Object.keys(pm).length).toBe(8);
    expect(allPm(pm, 0, 1, 4)).toBe(true);
    expect(allPm(pm, 0, 2, 4)).toBe(false);
    const off = togglePm(pm, 0, 0, 4);
    expect(Object.keys(off).length).toBe(4);
    expect(allPm(off, 1, 1, 4)).toBe(true);
    const on = togglePm(off, 0, 1, 4); // 일부만 켜져 있으면 전부 켠다
    expect(Object.keys(on).length).toBe(8);
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
    const c = sliceRange(song, 1, 2);
    expect(c.rep).toEqual({ 0: { s: 1 }, 1: { e: 2 } });
    pasteRange(song, c, 2);
    expect(song.rep).toEqual({ 1: { s: 1 }, 2: { s: 1 }, 3: { e: 2 } });
  });
});
