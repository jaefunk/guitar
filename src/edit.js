// 편집 동작. 모든 변경은 pushUndo() → state 변경 → save() 순서.
import { STRINGS, PER_LINE, DEFAULT_MEASURES, METERS } from './constants.js';
import { state, ed, save, touch } from './state.js';
import {
  parse, nextDigit, applyMod, prevPos, emptyMeasure, hasContent,
  shiftMarks, padMeasures, slotsOf, beatOf, resizeMeasures,
  sliceRange, pasteRange, transposeMeasures, shiftCells, togglePm, allPm, shiftRep, cleanRep
} from './tab.js';
import { paintCell, paintMark, setSel, setPending, cellAt, render, applyRange } from './render.js';
import { $, toast, ask } from './ui.js';
import { preview } from './audio.js';
import { updateFretboard } from './fretboard.js';

function snapshot() { return JSON.stringify({ measures: state.measures, marks: state.marks, pm: state.pm, rep: state.rep }); }
export function pushUndo() {
  ed.undoStack.push(snapshot());
  if (ed.undoStack.length > 120) ed.undoStack.shift();
  touch();
}
export function getVal(p) { return state.measures[p.m][p.s][p.i]; }
export function setVal(p, v) {
  if (getVal(p) === v) return;
  pushUndo();
  state.measures[p.m][p.s][p.i] = v;
  paintCell(cellAt(p), v);
  save();
  updateFretboard();
}
/** 현재 곡 기준 빈 마디 */
export function blank() { return emptyMeasure(slotsOf(state)); }
export function move(di, ds) {
  const sel = ed.sel;
  if (!sel) return;
  const SLOTS = slotsOf(state);
  const total = state.measures.length * SLOTS;
  let g = sel.m * SLOTS + sel.i + di;
  g = Math.max(0, Math.min(total - 1, g));
  const s = Math.max(0, Math.min(STRINGS - 1, sel.s + ds));
  setSel({ m: Math.floor(g / SLOTS), s, i: g % SLOTS }, true);
}
export function needSel() {
  if (!ed.sel) { toast('먼저 악보의 칸을 탭하세요'); return false; }
  return true;
}
export function buzz() {
  if (state.haptic && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* 무시 */ } }
}

export function inputDigit(d) {
  if (!needSel()) return;
  const sel = ed.sel;
  const r = nextDigit(getVal(sel), d, ed.pending);
  setVal(sel, r.value);
  preview([{ s: sel.s, fret: +r.num }]);
  if (state.autoAdv && !r.pending) move(1, 0); else setPending(r.pending);
}
export function inputMod(ch) {
  if (!needSel()) return;
  const sel = ed.sel;
  const pv = prevPos(sel, slotsOf(state));
  const r = applyMod(getVal(sel), pv ? getVal(pv) : null, ch);
  if (r.target === 'prev') { setVal(pv, r.value); return; }
  setVal(sel, r.value);
  setPending(false);
  if (r.advance && state.autoAdv) move(1, 0);
}
export function del(forward) {
  if (!needSel()) return;
  if (getVal(ed.sel)) { setVal(ed.sel, ''); setPending(false); return; }
  if (!forward) {
    const pv = prevPos(ed.sel, slotsOf(state));
    if (pv) { setSel(pv, true); setVal(ed.sel, ''); }
  }
}
/** 선택한 칸의 6줄을 모두 비운다(프렛보드의 "이 칸 전체 지움"). */
export function clearColumn() {
  if (!needSel()) return;
  const sel = ed.sel;
  let any = false;
  for (let s = 0; s < STRINGS; s++) if (getVal({ m: sel.m, s, i: sel.i })) any = true;
  if (!any) { toast('이미 비어 있어요'); return; }
  pushUndo();
  for (let s2 = 0; s2 < STRINGS; s2++) {
    state.measures[sel.m][s2][sel.i] = '';
    paintCell(cellAt({ m: sel.m, s: s2, i: sel.i }), '');
  }
  save(); updateFretboard();
}
export function doUndo() {
  if (!ed.undoStack.length) { toast('되돌릴 작업이 없어요'); return; }
  const d = JSON.parse(ed.undoStack.pop());
  state.measures = d.measures; state.marks = d.marks || {}; state.pm = d.pm || {}; state.rep = d.rep || {};
  touch(); save(); render(); toast('되돌림');
}

export function addLine() {
  pushUndo();
  for (let k = 0; k < PER_LINE; k++) state.measures.push(blank());
  save(); render();
  toast('마디 ' + (state.measures.length - 3) + '~' + state.measures.length + ' 추가됨');
}
export function delLine() {
  if (state.measures.length <= PER_LINE) { toast('마지막 한 줄은 남겨 둡니다'); return; }
  const last = state.measures.slice(-PER_LINE);
  const from = state.measures.length - PER_LINE;
  const go = hasContent(last)
    ? ask({ title: '마지막 줄 삭제', msg: '마지막 줄에 입력된 음이 있어요. 삭제할까요?', ok: '삭제' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok) return;
    pushUndo();
    state.measures.splice(-PER_LINE, PER_LINE);
    state.marks = shiftMarks(state.marks, from, -PER_LINE); state.pm = shiftMarks(state.pm, from, -PER_LINE); state.rep = shiftRep(state.rep, from, -PER_LINE);
    if (ed.sel && ed.sel.m >= state.measures.length) ed.sel = null;
    save(); render(); toast('마지막 줄 삭제됨');
  });
}
export function insertMeasure(after) {
  if (!needSel()) return;
  const at = ed.sel.m + (after ? 1 : 0);
  pushUndo();
  state.measures.splice(at, 0, blank());
  state.marks = shiftMarks(state.marks, at, 1); state.pm = shiftMarks(state.pm, at, 1); state.rep = shiftRep(state.rep, at, 1);
  padMeasures(state.measures, slotsOf(state));
  ed.sel = { m: at, s: ed.sel.s, i: 0 };
  save(); render(); toast('마디 ' + (at + 1) + '에 빈 마디 삽입');
}
export function deleteMeasure() {
  if (!needSel()) return;
  const m = ed.sel.m;
  const go = hasContent([state.measures[m]])
    ? ask({ title: '마디 삭제', msg: '마디 ' + (m + 1) + '을 삭제하고 뒤 마디를 당길까요?', ok: '삭제' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok) return;
    pushUndo();
    state.measures.splice(m, 1);
    state.marks = shiftMarks(state.marks, m, -1); state.pm = shiftMarks(state.pm, m, -1); state.rep = shiftRep(state.rep, m, -1);
    if (!state.measures.length) state.measures.push(blank());
    padMeasures(state.measures, slotsOf(state));
    if (ed.sel.m >= state.measures.length) ed.sel.m = state.measures.length - 1;
    save(); render(); toast('마디 ' + (m + 1) + ' 삭제됨');
  });
}
/** 범위가 있으면 범위를, 없으면 선택 마디 하나를 복사 */
export function copyMeasure() {
  const r = rangeOrSel();
  if (!r) return;
  ed.clip = sliceRange(state, r.from, r.to);
  toast(r.from === r.to ? '마디 ' + (r.from + 1) + ' 복사됨' : '마디 ' + (r.from + 1) + '~' + (r.to + 1) + ' 복사됨');
}
export function pasteMeasure() {
  if (!needSel()) return;
  if (!ed.clip) { toast('복사한 마디가 없어요'); return; }
  const m = ed.sel.m, n = ed.clip.measures.length;
  pushUndo();
  pasteRange(state, ed.clip, m);
  save(); render(); toast(n === 1 ? '마디 ' + (m + 1) + '에 붙여넣음' : '마디 ' + (m + 1) + '~' + (m + n) + '에 붙여넣음');
}
export function clearMeasure() {
  if (!needSel()) return;
  if (!hasContent([state.measures[ed.sel.m]])) { toast('이미 비어 있는 마디예요'); return; }
  pushUndo();
  state.measures[ed.sel.m] = blank();
  save(); render(); toast('마디 ' + (ed.sel.m + 1) + ' 비움');
}
export function clearAll() {
  const go = hasContent(state.measures)
    ? ask({ title: '전체 지우기', msg: '이 곡의 모든 음과 메모를 지우고 2줄(8마디)로 되돌릴까요?', ok: '지우기' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok) return;
    pushUndo();
    state.measures = [];
    for (let k = 0; k < DEFAULT_MEASURES; k++) state.measures.push(blank());
    state.marks = {}; state.pm = {}; state.rep = {}; ed.range = null;
    ed.sel = { m: 0, s: 0, i: 0 };
    save(); render(); $('settingsModal').hidden = true; toast('전체 지움');
  });
}
export function editMark(m, i) {
  const k = m + ':' + i;
  ask({
    title: '메모 (마디 ' + (m + 1) + ', ' + (Math.floor(i / beatOf(state)) + 1) + '박)',
    msg: '코드 이름, 가사, 구간 이름 등', input: true, value: state.marks[k] || '', placeholder: '예: Am, Chorus', ok: '저장'
  }).then((v) => {
    if (v === null) return;
    v = v.trim();
    if ((state.marks[k] || '') === v) return;
    pushUndo();
    if (v) state.marks[k] = v; else delete state.marks[k];
    paintMark(m, i); save();
  });
}
export function insertChord(name, fing) {
  if (!needSel()) return;
  const sel = ed.sel;
  pushUndo();
  for (let s = 0; s < STRINGS; s++) {
    const ch = fing[STRINGS - 1 - s];
    state.measures[sel.m][s][sel.i] = (ch === 'x') ? '' : ch;
    paintCell(cellAt({ m: sel.m, s, i: sel.i }), state.measures[sel.m][s][sel.i]);
  }
  state.marks[sel.m + ':' + sel.i] = name; paintMark(sel.m, sel.i);
  save(); updateFretboard();
  $('chordModal').hidden = true;
  toast(name + ' 넣음');
  const pv = [];
  for (let s3 = 0; s3 < STRINGS; s3++) {
    const q = parse(state.measures[sel.m][s3][sel.i]);
    if (q.num) pv.push({ s: s3, fret: +q.num });
  }
  preview(pv);
  if (state.autoAdv) move(beatOf(state), 0);
}

/** 박자표 변경: 마디 칸 수를 맞춰 자르거나 채운다. 잘려 나가는 음이 있으면 묻는다. */
export function setMeter(meter) {
  if (!METERS[meter] || meter === state.meter) return Promise.resolve(false);
  const slots = METERS[meter].slots, cur = slotsOf(state);
  const lost = slots < cur && state.measures.some((m) => m.some((r) => r.slice(slots).some((v) => v)));
  const go = lost
    ? ask({ title: '박자표 바꾸기', msg: meter + '로 바꾸면 마디가 짧아져 뒤쪽 칸의 음이 지워져요. 바꿀까요?', ok: '바꾸기' })
    : Promise.resolve(true);
  return go.then((ok) => {
    if (!ok) return false;
    pushUndo();
    state.measures = resizeMeasures(state.measures, slots);
    // 잘린 칸의 메모와 팜뮤트도 버린다
    Object.keys(state.marks).forEach((k) => { if (+k.split(':')[1] >= slots) delete state.marks[k]; });
    Object.keys(state.pm).forEach((k) => { if (+k.split(':')[1] >= slots) delete state.pm[k]; });
    state.meter = meter;
    if (ed.sel && ed.sel.i >= slots) ed.sel.i = slots - 1;
    save(); render(); toast('박자표 ' + meter);
    return true;
  });
}

/* ---------- 마디 범위(다중 선택) ---------- */
function rangeOrSel() {
  if (ed.range) return ed.range;
  if (!needSel()) return null;
  return { from: ed.sel.m, to: ed.sel.m };
}
/** 범위 시작 또는 확장. 범위가 없으면 m 하나짜리 범위를 만든다. */
export function setRange(m) {
  if (!ed.range) ed.range = { from: m, to: m };
  else if (m < ed.range.from) ed.range.from = m;
  else ed.range.to = m;
  applyRange();
}
export function clearRange() { if (!ed.range) return; ed.range = null; applyRange(); }
export function rangeLabel() {
  const r = ed.range; if (!r) return '';
  return r.from === r.to ? '마디 ' + (r.from + 1) : '마디 ' + (r.from + 1) + '~' + (r.to + 1) + ' (' + (r.to - r.from + 1) + '마디)';
}
export function deleteRange() {
  const r = ed.range; if (!r) return;
  const n = r.to - r.from + 1;
  const go = hasContent(state.measures.slice(r.from, r.to + 1))
    ? ask({ title: '마디 삭제', msg: rangeLabel() + '을(를) 삭제하고 뒤 마디를 당길까요?', ok: '삭제' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok) return;
    pushUndo();
    state.measures.splice(r.from, n);
    state.marks = shiftMarks(state.marks, r.from, -n); state.pm = shiftMarks(state.pm, r.from, -n); state.rep = shiftRep(state.rep, r.from, -n);
    if (!state.measures.length) state.measures.push(blank());
    padMeasures(state.measures, slotsOf(state));
    ed.range = null;
    if (ed.sel) ed.sel.m = Math.min(r.from, state.measures.length - 1);
    save(); render(); toast(n + '마디 삭제됨');
  });
}
export function transposeRange() {
  const r = rangeOrSel(); if (!r) return;
  ask({ title: '조옮김', msg: (rangeLabel() || ('마디 ' + (r.from + 1))) + '의 모든 프렛에 더할 수 (예: 2, -3, 12)', input: true, value: '', placeholder: '반음 수', ok: '적용' })
    .then((v) => {
      if (v === null) return;
      const n = Math.round(+v);
      if (!n) { toast('0이 아닌 정수를 넣으세요'); return; }
      const part = transposeMeasures(state.measures.slice(r.from, r.to + 1), n);
      if (!part) { toast('0 미만이나 24 초과 프렛이 생겨서 바꾸지 않았어요'); return; }
      pushUndo();
      part.forEach((m, k) => { state.measures[r.from + k] = m; });
      save(); render(); toast((n > 0 ? '+' : '') + n + ' 프렛 조옮김');
    });
}
export function shiftRange(dir) {
  const r = rangeOrSel(); if (!r) return;
  const res = shiftCells(state, r.from, r.to, dir);
  pushUndo();
  state.measures = res.measures; state.marks = res.marks; state.pm = res.pm;
  save(); render(); toast(dir > 0 ? '한 칸 오른쪽으로 밀었어요' : '한 칸 왼쪽으로 밀었어요');
}
export function togglePmRange() {
  const r = rangeOrSel(); if (!r) return;
  const slots = slotsOf(state), on = !allPm(state.pm, r.from, r.to, slots);
  pushUndo();
  state.pm = togglePm(state.pm, r.from, r.to, slots);
  save(); render(); toast(on ? '팜뮤트 켬 (P.M.)' : '팜뮤트 끔');
}

/* ---------- 반복 기호 ---------- */
function repOf(m) { return state.rep[m] || {}; }
/** 반복 시작/끝/괄호를 바꾼다. patch 예: {s:1} {s:0} {e:3} {e:0} {v:2} {v:0} */
export function setRep(m, patch) {
  pushUndo();
  const r = Object.assign({}, repOf(m));
  Object.keys(patch).forEach((k) => { if (patch[k]) r[k] = patch[k]; else delete r[k]; });
  state.rep = Object.assign({}, state.rep, { [m]: r });
  cleanRep(state.rep);
  save(); render();
}
export function repeatMenuItems(m) {
  const r = repOf(m);
  return [
    { k: '𝄆', label: r.s ? '반복 시작 표시 지우기' : '반복 시작 표시 (||:)', desc: '여기서부터 되돌아와요', action: () => { setRep(m, { s: r.s ? 0 : 1 }); toast(r.s ? '반복 시작 지움' : '마디 ' + (m + 1) + '에 반복 시작'); } },
    { k: '𝄇', label: r.e ? '반복 끝 지우기 (×' + r.e + ')' : '반복 끝 표시 (:||, 2번)', desc: '시작 표시가 없으면 곡 처음으로 돌아가요', action: () => { setRep(m, { e: r.e ? 0 : 2 }); toast(r.e ? '반복 끝 지움' : '마디 ' + (m + 1) + '에 반복 끝'); } },
    { k: '×n', label: '반복 횟수 바꾸기', desc: '반복 끝이 있는 마디에서', disabled: !r.e, action: () => {
      ask({ title: '반복 횟수', msg: '이 구간을 몇 번 연주할까요? (2~99)', input: true, value: String(r.e || 2), ok: '적용' }).then((v) => {
        if (v === null) return;
        const n = Math.round(+v);
        if (!(n >= 2 && n <= 99)) { toast('2~99 사이 숫자를 넣으세요'); return; }
        setRep(m, { e: n }); toast('×' + n);
      });
    } },
    { k: r.v ? r.v + '.' : '1.', label: r.v ? '괄호 지우기 (' + r.v + '번)' : '1번 괄호 (첫 번째 연주 때만)', action: () => { setRep(m, { v: r.v ? 0 : 1 }); } },
    { k: '2.', label: '2번 괄호 (두 번째 연주 때만)', disabled: r.v === 2, action: () => { setRep(m, { v: 2 }); } },
    { k: '3.', label: '3번 괄호', disabled: r.v === 3, action: () => { setRep(m, { v: 3 }); } }
  ];
}
