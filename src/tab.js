// 타브 데이터에 대한 순수 함수 모음. DOM/오디오/저장소를 건드리지 않아 테스트하기 쉽다.
import { STRINGS, SLOTS, PER_LINE, MAX_FRET, METERS, DEFAULT_METER } from './constants.js';

/** 셀 문자열 '12h' → {num:'12', mod:'h'} */
export function parse(v) {
  const m = /^(\d{0,2})(.*)$/.exec(v || '');
  return { num: m[1], mod: m[2] };
}

/** 곡(또는 {meter})의 한 마디 칸 수 */
export function slotsOf(song) { return (METERS[song && song.meter] || METERS[DEFAULT_METER]).slots; }
/** 한 박의 칸 수 */
export function beatOf(song) { return (METERS[song && song.meter] || METERS[DEFAULT_METER]).beat; }

export function emptyMeasure(slots) {
  slots = slots || SLOTS;
  const m = [];
  for (let s = 0; s < STRINGS; s++) {
    const r = [];
    for (let i = 0; i < slots; i++) r.push('');
    m.push(r);
  }
  return m;
}

/** 마디 칸 수를 바꾼다(잘라내거나 빈 칸으로 채움). 새 배열을 돌려준다. */
export function resizeMeasures(ms, slots) {
  return ms.map((m) => m.map((r) => {
    const n = r.slice(0, slots);
    while (n.length < slots) n.push('');
    return n;
  }));
}

export function cloneMeasure(m) { return m.map((r) => r.slice()); }
export function cloneMeasures(ms) { return ms.map(cloneMeasure); }

/** 모양이 맞는 마디 배열인지. slots를 주면 칸 수까지 검사하고, 안 주면 모든 행의 길이가 같기만 하면 된다. */
export function validMeasures(ms, slots) {
  if (!Array.isArray(ms) || !ms.length) return false;
  const n = slots || (ms[0] && ms[0][0] && ms[0][0].length);
  if (!n) return false;
  return ms.every((m) =>
    Array.isArray(m) && m.length === STRINGS && m.every((r) =>
      Array.isArray(r) && r.length === n && r.every((v) => typeof v === 'string')));
}

/** 마디 수가 PER_LINE의 배수가 되도록 빈 마디를 덧붙인다(제자리 변경). */
export function padMeasures(ms, slots) {
  slots = slots || (ms[0] ? ms[0][0].length : SLOTS);
  while (ms.length % PER_LINE) ms.push(emptyMeasure(slots));
  return ms;
}

export function hasContent(ms) {
  return ms.some((m) => m.some((r) => r.some((v) => v)));
}

/** 마디 m의 메모만 {i: text} 꼴로 */
export function measureMarks(marks, m) {
  const o = {};
  Object.keys(marks).forEach((k) => {
    const p = k.split(':');
    if (+p[0] === m) o[p[1]] = marks[k];
  });
  return o;
}

/**
 * 마디 삽입/삭제에 맞춰 메모 키를 민다. 새 객체를 돌려준다.
 * delta>0: fromM 이상인 마디의 메모를 delta만큼 뒤로.
 * delta<0: fromM부터 |delta|개 마디의 메모는 버리고 그 뒤는 delta만큼 앞으로.
 */
export function shiftMarks(marks, fromM, delta) {
  const n = {};
  Object.keys(marks).forEach((k) => {
    const p = k.split(':');
    const m = +p[0];
    if (m < fromM) { n[k] = marks[k]; return; }
    if (delta < 0 && m < fromM - delta) return;
    n[(m + delta) + ':' + p[1]] = marks[k];
  });
  return n;
}

/**
 * 숫자 입력 규칙. 현재 셀 값이 '1'/'2'이고 두 자리 대기 중이면 합친다(≤24).
 * @returns {{value:string, num:string, pending:boolean}} pending: 다음 숫자를 더 기다릴지
 */
export function nextDigit(cur, d, pending) {
  const p = parse(cur);
  let num;
  if (pending && p.num.length === 1 && (p.num === '1' || p.num === '2')) {
    const cand = p.num + d;
    if (+cand <= MAX_FRET) num = cand;
  }
  if (num === undefined) num = d;
  const pend = num.length === 1 && (num === '1' || num === '2');
  return { value: num + p.mod, num, pending: pend };
}

/**
 * 기법 입력 규칙.
 *  - x: 현재 셀을 'x'로.
 *  - 현재 셀에 숫자가 있으면 거기에 붙인다.
 *  - 현재 셀이 비어 있고 이전 셀에 숫자가 있으면 이전 셀에 붙인다(자동 이동 뒤 h를 누르는 흐름).
 *  - 그 외엔 현재 셀에 기법만 단독 저장.
 * @returns {{target:'cur'|'prev', value:string, advance:boolean}}
 */
export function applyMod(cur, prev, ch) {
  const p = parse(cur);
  if (ch === 'x') return { target: 'cur', value: 'x', advance: true };
  if (p.num) return { target: 'cur', value: p.num + ch, advance: true };
  if (!cur && prev != null) {
    const pp = parse(prev);
    if (pp.num) return { target: 'prev', value: pp.num + ch, advance: false };
  }
  return { target: 'cur', value: ch, advance: false };
}

/** 전역 칸 번호 ↔ {m,i} (slots = 한 마디 칸 수) */
export function posToG(p, slots) { return p.m * (slots || SLOTS) + p.i; }
export function gToPos(g, s, slots) { slots = slots || SLOTS; return { m: Math.floor(g / slots), s, i: g % slots }; }
export function prevPos(p, slots) {
  const g = posToG(p, slots) - 1;
  if (g < 0) return null;
  return gToPos(g, p.s, slots);
}

/** 같은 줄에서 다음 음(최대 32칸 앞)을 찾는다. 슬라이드 목표 계산용. 끊기('.')를 만나면 없음. */
export function nextNoteOnString(measures, m, s, i, slots) {
  slots = slots || (measures[0] ? measures[0][0].length : SLOTS);
  const total = measures.length * slots;
  const g = m * slots + i;
  for (let d = 1; d <= 32 && g + d < total; d++) {
    const gg = g + d;
    const v = measures[Math.floor(gg / slots)][s][gg % slots];
    if (v) {
      const p = parse(v);
      if (p.num) return { fret: +p.num, dist: d };
      return null;
    }
  }
  return null;
}
