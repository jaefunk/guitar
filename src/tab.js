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

/* ---------- 범위 연산 (칸 단위 다중 선택) ----------
   범위는 {from:{m,i}, to:{m,i}}이고, 내부 계산은 전역 칸 번호 gA..gB(포함)로 한다.
   여섯 줄 전체가 한 열(칸)로 움직인다. 마디 경계에 딱 맞는 범위(aligned)는 반복 기호도 함께 다룬다. */

/** 범위 → {gA, gB, n, aligned, fromM, toM} */
export function colRange(range, slots) {
  let gA = range.from.m * slots + range.from.i, gB = range.to.m * slots + range.to.i;
  if (gA > gB) { const t = gA; gA = gB; gB = t; }
  const fromM = Math.floor(gA / slots), toM = Math.floor(gB / slots);
  return { gA, gB, n: gB - gA + 1, aligned: gA % slots === 0 && gB % slots === slots - 1, fromM, toM };
}
/** 마디 범위 → 칸 범위 객체 */
export function measureRange(fromM, toM, slots) {
  return { from: { m: Math.min(fromM, toM), i: 0 }, to: { m: Math.max(fromM, toM), i: slots - 1 } };
}
function keyOf(g, slots) { return Math.floor(g / slots) + ':' + (g % slots); }

/** 범위를 클립보드 꼴로 복사: {cells[6][n], marks{'k'}, pm{'k'}, rep{상대 마디}, n, aligned} */
export function sliceRange(song, range) {
  const slots = slotsOf(song), r = colRange(range, slots);
  const cells = [];
  for (let s = 0; s < STRINGS; s++) {
    const row = [];
    for (let g = r.gA; g <= r.gB; g++) row.push(song.measures[Math.floor(g / slots)][s][g % slots]);
    cells.push(row);
  }
  const pick = (map) => {
    const o = {};
    for (let g = r.gA; g <= r.gB; g++) { const v = (map || {})[keyOf(g, slots)]; if (v) o[g - r.gA] = v; }
    return o;
  };
  const rep = {};
  if (r.aligned) Object.keys(song.rep || {}).forEach((k) => { if (+k >= r.fromM && +k <= r.toM) rep[+k - r.fromM] = JSON.parse(JSON.stringify(song.rep[k])); });
  return { cells, marks: pick(song.marks), pm: pick(song.pm), rep, n: r.n, aligned: r.aligned, slots };
}

/** 클립을 전역 칸 gAt부터 덮어쓴다(제자리). 부족하면 마디를 늘리고 PER_LINE 배수로 채운다. */
export function pasteRange(song, clip, gAt) {
  const slots = slotsOf(song), n = clip.n || (clip.cells && clip.cells[0] ? clip.cells[0].length : 0);
  if (!n) return;
  const need = Math.ceil((gAt + n) / slots);
  while (song.measures.length < need) song.measures.push(emptyMeasure(slots));
  for (let k = 0; k < n; k++) {
    const g = gAt + k, m = Math.floor(g / slots), i = g % slots;
    for (let s = 0; s < STRINGS; s++) song.measures[m][s][i] = clip.cells[s][k] || '';
    const key = m + ':' + i;
    if (clip.marks && clip.marks[k]) song.marks[key] = clip.marks[k]; else delete song.marks[key];
    song.pm = song.pm || {};
    if (clip.pm && clip.pm[k]) song.pm[key] = 1; else delete song.pm[key];
  }
  // 마디 단위로 복사한 클립을 마디 첫 칸에 붙일 때만 반복 기호도 옮긴다
  if (clip.aligned && gAt % slots === 0 && clip.rep) {
    const at = gAt / slots, count = n / slots;
    song.rep = song.rep || {};
    for (let k = 0; k < count; k++) delete song.rep[at + k];
    Object.keys(clip.rep).forEach((k) => { song.rep[at + +k] = JSON.parse(JSON.stringify(clip.rep[k])); });
  }
  padMeasures(song.measures, slots);
}

/** 범위의 음·메모·팜뮤트를 비운다(제자리). 마디 수는 그대로. */
export function clearRange(song, range) {
  const slots = slotsOf(song), r = colRange(range, slots);
  for (let g = r.gA; g <= r.gB; g++) {
    const m = Math.floor(g / slots), i = g % slots, key = m + ':' + i;
    for (let s = 0; s < STRINGS; s++) song.measures[m][s][i] = '';
    delete song.marks[key];
    if (song.pm) delete song.pm[key];
  }
}

/** 조옮김. 모든 프렛에 n을 더한다. 0 미만이나 MAX_FRET 초과가 생기면 null. 기법 글자는 유지. */
export function transposeMeasures(ms, n) {
  const out = cloneMeasures(ms);
  for (let m = 0; m < out.length; m++) {
    for (let s = 0; s < STRINGS; s++) {
      for (let i = 0; i < out[m][s].length; i++) {
        const v = transposeCell(out[m][s][i], n);
        if (v === null) return null;
        out[m][s][i] = v;
      }
    }
  }
  return out;
}
function transposeCell(v, n) {
  const p = parse(v);
  if (!p.num) return v;
  const f = +p.num + n;
  if (f < 0 || f > MAX_FRET) return null;
  return f + p.mod;
}
/** 범위 안의 칸만 조옮김. 새 measures 또는 null. */
export function transposeRange(song, range, n) {
  const slots = slotsOf(song), r = colRange(range, slots), out = cloneMeasures(song.measures);
  for (let g = r.gA; g <= r.gB; g++) {
    const m = Math.floor(g / slots), i = g % slots;
    for (let s = 0; s < STRINGS; s++) {
      const v = transposeCell(out[m][s][i], n);
      if (v === null) return null;
      out[m][s][i] = v;
    }
  }
  return out;
}

/**
 * 범위 안의 모든 칸(음·메모·팜뮤트)을 dir(+1 오른쪽, -1 왼쪽)만큼 민다.
 * 범위 밖으로 밀려난 칸은 버려지고 반대쪽엔 빈 칸이 들어온다. 새 {measures, marks, pm}을 돌려준다.
 */
export function shiftRange(song, range, dir) {
  const slots = slotsOf(song), r = colRange(range, slots), measures = cloneMeasures(song.measures);
  for (let s = 0; s < STRINGS; s++) {
    const flat = [];
    for (let g = r.gA; g <= r.gB; g++) flat.push(song.measures[Math.floor(g / slots)][s][g % slots]);
    const moved = new Array(r.n).fill('');
    for (let k = 0; k < r.n; k++) { const nk = k + dir; if (nk >= 0 && nk < r.n) moved[nk] = flat[k]; }
    for (let k = 0; k < r.n; k++) { const g = r.gA + k; measures[Math.floor(g / slots)][s][g % slots] = moved[k]; }
  }
  const mv = (map) => {
    const o = {};
    Object.keys(map || {}).forEach((key) => {
      const p = key.split(':'), g = +p[0] * slots + +p[1];
      if (g < r.gA || g > r.gB) { o[key] = map[key]; return; }
      const ng = g + dir;
      if (ng < r.gA || ng > r.gB) return;
      o[keyOf(ng, slots)] = map[key];
    });
    return o;
  };
  return { measures, marks: mv(song.marks), pm: mv(song.pm) };
}

/** 범위의 모든 칸이 팜뮤트인가 */
export function allPm(pm, range, slots) {
  const r = colRange(range, slots);
  for (let g = r.gA; g <= r.gB; g++) if (!pm || !pm[keyOf(g, slots)]) return false;
  return true;
}
/** 범위 팜뮤트 토글: 전부 켜져 있으면 끄고, 아니면 전부 켠다. 새 객체. */
export function togglePm(pm, range, slots) {
  const r = colRange(range, slots), o = Object.assign({}, pm || {}), on = !allPm(pm, range, slots);
  for (let g = r.gA; g <= r.gB; g++) { const k = keyOf(g, slots); if (on) o[k] = 1; else delete o[k]; }
  return o;
}

/* ---------- 반복 기호 ---------- */
// song.rep = { [m]: { s: 1, e: times, v: volta } }  s=반복 시작 ||:, e=반복 끝 :|| (횟수), v=괄호 번호(1 또는 [1,2])

/** 괄호 번호 → 배열. 1 → [1], [1,2] → [1,2], 없음 → [] */
export function voltaList(v) {
  if (Array.isArray(v)) return v.filter((n) => Number.isInteger(n) && n >= 1 && n <= 9);
  return Number.isInteger(v) && v >= 1 && v <= 9 ? [v] : [];
}
/** 괄호 표시 글자: '1.' '1,2.' */
export function voltaLabel(v) { const l = voltaList(v); return l.length ? l.join(',') + '.' : ''; }
/** '1,2' 같은 입력 → 정리된 값(한 개면 숫자, 여러 개면 배열, 없으면 0) */
export function parseVolta(text) {
  const nums = String(text || '').split(/[^0-9]+/).map(Number).filter((n) => n >= 1 && n <= 9);
  const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
  return uniq.length === 0 ? 0 : (uniq.length === 1 ? uniq[0] : uniq);
}

/** 마디 번호 키 맵(rep)을 삽입/삭제에 맞춰 민다 */
export function shiftRep(rep, fromM, delta) {
  const n = {};
  Object.keys(rep || {}).forEach((k) => {
    const m = +k;
    if (m < fromM) { n[k] = rep[k]; return; }
    if (delta < 0 && m < fromM - delta) return;
    n[m + delta] = rep[k];
  });
  return n;
}

/** rep 항목이 비었으면 지워서 정리한다(제자리) */
export function cleanRep(rep) {
  Object.keys(rep || {}).forEach((k) => {
    const r = rep[k];
    if (!r || (!r.s && !r.e && !voltaList(r.v).length)) delete rep[k];
  });
  return rep;
}

/**
 * 반복 기호를 펼쳐 실제 연주 순서(마디 번호 배열)를 만든다.
 *  - ||: 가 없으면 곡 처음(또는 직전 반복 끝 다음)으로 돌아간다.
 *  - :|| 의 횟수 e(기본 2)만큼 그 구간을 연주한다.
 *  - 괄호 v가 붙은 마디는 v번째 연주 때만 연주한다.
 */
export function expandRepeats(total, rep) {
  rep = rep || {};
  const seq = [];
  let m = 0, start = 0, pass = 1, guard = 0, done = false; // done: 반복을 다 돌았고 새 구간을 기다리는 중
  while (m < total && guard++ < 10000) {
    const f = rep[m] || {};
    const voltas = voltaList(f.v);
    if (f.s && start !== m) { start = m; pass = 1; done = false; }
    else if (done && !voltas.length) { start = m; pass = 1; done = false; } // 괄호가 아닌 마디에서 새 구간 시작
    if (voltas.length && voltas.indexOf(pass) < 0) {
      if (f.e && Math.max.apply(null, voltas) < pass) done = true; // 지난 번 괄호의 :|| 를 지나쳤다 → 반복 끝
      m++; continue;
    }
    seq.push(m);
    if (f.e) {
      const times = Math.max(2, f.e | 0);
      if (pass < times) { pass++; done = false; m = start; continue; }
      done = true;
    }
    m++;
  }
  return seq;
}
