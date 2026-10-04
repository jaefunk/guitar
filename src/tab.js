// 타브 데이터에 대한 순수 함수 모음. DOM/오디오/저장소를 건드리지 않아 테스트하기 쉽다.
import { STRINGS, SLOTS, PER_LINE, MAX_FRET, METERS, DEFAULT_METER, REST } from './constants.js';

/** 셀 문자열 '12h' → {num:'12', mod:'h'}. 끊기('.')는 {num:'', mod:'.'} */
export function parse(v) {
  const m = /^(\d{0,2})(.*)$/.exec(v || '');
  return { num: m[1], mod: m[2] };
}
/** 끊기(쉼표) 칸인가 */
export function isRest(v) { return v === REST; }

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
 *  - x / .(끊기): 현재 셀을 그 글자 하나로.
 *  - 현재 셀에 숫자가 있으면 거기에 붙인다.
 *  - 현재 셀이 비어 있고 이전 셀에 숫자가 있으면 이전 셀에 붙인다(자동 이동 뒤 h를 누르는 흐름).
 *  - 그 외엔 현재 셀에 기법만 단독 저장.
 * @returns {{target:'cur'|'prev', value:string, advance:boolean}}
 */
export function applyMod(cur, prev, ch) {
  const p = parse(cur);
  if (ch === 'x' || ch === REST) return { target: 'cur', value: ch, advance: true };
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

/* ---------- 마디 범위 연산 (다중 선택) ---------- */

/** 'm:i' 키 맵에서 마디 from..to(포함)에 속한 항목을 상대 마디 번호 'dm:i'로 옮겨 돌려준다 */
export function keysInRange(map, from, to) {
  const o = {};
  Object.keys(map || {}).forEach((k) => {
    const p = k.split(':'), m = +p[0];
    if (m >= from && m <= to) o[(m - from) + ':' + p[1]] = map[k];
  });
  return o;
}

/** 범위를 클립보드 꼴로 복사: {measures, marks, pm} (marks/pm는 상대 키) */
export function sliceRange(song, from, to) {
  return {
    measures: cloneMeasures(song.measures.slice(from, to + 1)),
    marks: keysInRange(song.marks, from, to),
    pm: keysInRange(song.pm, from, to)
  };
}

/** 클립을 at 마디부터 덮어쓴다(제자리). 부족하면 마디를 늘리고 PER_LINE 배수로 채운다. */
export function pasteRange(song, clip, at) {
  const slots = slotsOf(song);
  const src = resizeMeasures(clip.measures, slots);
  while (song.measures.length < at + src.length) song.measures.push(emptyMeasure(slots));
  src.forEach((m, k) => { song.measures[at + k] = cloneMeasure(m); });
  ['marks', 'pm'].forEach((f) => {
    const map = song[f] || {};
    Object.keys(map).forEach((k) => { const m = +k.split(':')[0]; if (m >= at && m < at + src.length) delete map[k]; });
    Object.keys(clip[f] || {}).forEach((k) => {
      const p = k.split(':');
      if (+p[1] < slots) map[(at + +p[0]) + ':' + p[1]] = clip[f][k];
    });
    song[f] = map;
  });
  padMeasures(song.measures, slots);
}

/**
 * 조옮김. 모든 프렛에 n을 더한다. 0 미만이나 MAX_FRET 초과가 생기면 바꾸지 않고 null.
 * 기법 글자는 유지한다.
 */
export function transposeMeasures(ms, n) {
  const out = cloneMeasures(ms);
  for (let m = 0; m < out.length; m++) {
    for (let s = 0; s < STRINGS; s++) {
      for (let i = 0; i < out[m][s].length; i++) {
        const p = parse(out[m][s][i]);
        if (!p.num) continue;
        const f = +p.num + n;
        if (f < 0 || f > MAX_FRET) return null;
        out[m][s][i] = f + p.mod;
      }
    }
  }
  return out;
}

/**
 * 마디 from..to 안의 모든 칸(음·메모·팜뮤트)을 dir(+1 오른쪽, -1 왼쪽)만큼 민다.
 * 범위 밖으로 밀려난 칸은 버려지고 반대쪽엔 빈 칸이 들어온다. 새 {measures, marks, pm}을 돌려준다.
 */
export function shiftCells(song, from, to, dir) {
  const slots = slotsOf(song), count = to - from + 1, total = count * slots;
  const measures = cloneMeasures(song.measures);
  for (let s = 0; s < STRINGS; s++) {
    const flat = [];
    for (let m = from; m <= to; m++) flat.push.apply(flat, song.measures[m][s]);
    const moved = new Array(total).fill('');
    for (let g = 0; g < total; g++) { const ng = g + dir; if (ng >= 0 && ng < total) moved[ng] = flat[g]; }
    for (let m = from; m <= to; m++) measures[m][s] = moved.slice((m - from) * slots, (m - from + 1) * slots);
  }
  const mv = (map) => {
    const o = {};
    Object.keys(map || {}).forEach((k) => {
      const p = k.split(':'), m = +p[0], i = +p[1];
      if (m < from || m > to) { o[k] = map[k]; return; }
      const ng = (m - from) * slots + i + dir;
      if (ng < 0 || ng >= total) return;
      o[(from + Math.floor(ng / slots)) + ':' + (ng % slots)] = map[k];
    });
    return o;
  };
  return { measures, marks: mv(song.marks), pm: mv(song.pm) };
}

/** 범위의 모든 칸이 팜뮤트인가 */
export function allPm(pm, from, to, slots) {
  for (let m = from; m <= to; m++) for (let i = 0; i < slots; i++) if (!pm || !pm[m + ':' + i]) return false;
  return true;
}
/** 범위 팜뮤트 토글: 전부 켜져 있으면 끄고, 아니면 전부 켠다. 새 객체. */
export function togglePm(pm, from, to, slots) {
  const o = Object.assign({}, pm || {}), on = !allPm(pm, from, to, slots);
  for (let m = from; m <= to; m++) for (let i = 0; i < slots; i++) { const k = m + ':' + i; if (on) o[k] = 1; else delete o[k]; }
  return o;
}
