import { describe, it, expect } from 'vitest';
import { parse, nextDigit, applyMod, shiftMarks, padMeasures, emptyMeasure, nextNoteOnString, prevPos, hasContent } from '../src/tab.js';
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
  it('x는 단독으로 현재 칸에', () => {
    expect(applyMod('7', '5', 'x')).toEqual({ target: 'cur', value: 'x', advance: true });
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
    expect(prevPos({ m: 0, s: 2, i: 0 })).toBeNull();
  });
  it('nextNoteOnString은 같은 줄 다음 음을 찾는다', () => {
    const ms = [emptyMeasure(), emptyMeasure()];
    ms[0][3][2] = '5/';
    ms[1][3][1] = '7';
    expect(nextNoteOnString(ms, 0, 3, 2)).toEqual({ fret: 7, dist: SLOTS - 1 });
    ms[0][3][5] = 'x';
    expect(nextNoteOnString(ms, 0, 3, 2)).toBeNull();
    expect(hasContent(ms)).toBe(true);
  });
});
