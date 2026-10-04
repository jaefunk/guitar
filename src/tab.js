// 타브 데이터에 대한 순수 함수 모음. DOM/오디오/저장소를 건드리지 않아 테스트하기 쉽다.
import { STRINGS, SLOTS, PER_LINE, MAX_FRET } from './constants.js';

/** 셀 문자열 '12h' → {num:'12', mod:'h'} */
export function parse(v) {
  const m = /^(\d{0,2})(.*)$/.exec(v || '');
  return { num: m[1], mod: m[2] };
}

export function emptyMeasure() {
  const m = [];
  for (let s = 0; s < STRINGS; s++) {
    const r = [];
    for (let i = 0; i < SLOTS; i++) r.push('');
    m.push(r);
  }
  return m;
}

export function cloneMeasure(m) { return m.map((r) => r.slice()); }
export function cloneMeasures(ms) { return ms.map(cloneMeasure); }

export function validMeasures(ms) {
  return Array.isArray(ms) && ms.length > 0 && ms.every((m) =>
    Array.isArray(m) && m.length === STRINGS && m.every((r) =>
      Array.isArray(r) && r.length === SLOTS && r.every((v) => typeof v === 'string')));
}

/** 마디 수가 PER_LINE의 배수가 되도록 빈 마디를 덧붙인다(제자리 변경). */
export function padMeasures(ms) {
  while (ms.length % PER_LINE) ms.push(emptyMeasure());
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

/** 전역 칸 번호 ↔ {m,i} */
export function posToG(p) { return p.m * SLOTS + p.i; }
export function gToPos(g, s) { return { m: Math.floor(g / SLOTS), s, i: g % SLOTS }; }
export function prevPos(p) {
  const g = posToG(p) - 1;
  if (g < 0) return null;
  return gToPos(g, p.s);
}

/** 같은 줄에서 다음 음(최대 32칸 앞)을 찾는다. 슬라이드 목표 계산용. */
export function nextNoteOnString(measures, m, s, i) {
  const total = measures.length * SLOTS;
  const g = m * SLOTS + i;
  for (let d = 1; d <= 32 && g + d < total; d++) {
    const gg = g + d;
    const v = measures[Math.floor(gg / SLOTS)][s][gg % SLOTS];
    if (v) {
      const p = parse(v);
      if (p.num) return { fret: +p.num, dist: d };
      return null;
    }
  }
  return null;
}
