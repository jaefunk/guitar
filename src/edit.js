// 편집 동작. 모든 변경은 pushUndo() → state 변경 → save() 순서.
import { STRINGS, SLOTS, PER_LINE, DEFAULT_MEASURES } from './constants.js';
import { state, ed, save, touch, canEditCurrentSong } from './state.js';
import {
  parse, nextDigit, applyMod, prevPos, emptyMeasure, cloneMeasure, hasContent,
  measureMarks, shiftMarks, padMeasures
} from './tab.js';
import { paintCell, paintMark, setSel, setPending, cellAt, render } from './render.js';
import { $, toast, ask } from './ui.js';
import { preview } from './audio.js';
import { updateFretboard } from './fretboard.js';

function snapshot() { return JSON.stringify({ measures: state.measures, marks: state.marks }); }
export function pushUndo() {
  if (!canEditCurrentSong()) return false;
  ed.undoStack.push(snapshot());
  if (ed.undoStack.length > 120) ed.undoStack.shift();
  touch();
  return true;
}
export function getVal(p) { return state.measures[p.m][p.s][p.i]; }
export function setVal(p, v) {
  if (!canEditCurrentSong()) return false;
  if (getVal(p) === v) return;
  pushUndo();
  state.measures[p.m][p.s][p.i] = v;
  paintCell(cellAt(p), v);
  save();
  updateFretboard();
  return true;
}
export function move(di, ds) {
  const sel = ed.sel;
  if (!sel) return;
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
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  const sel = ed.sel;
  const r = nextDigit(getVal(sel), d, ed.pending);
  setVal(sel, r.value);
  preview([{ s: sel.s, fret: +r.num }]);
  if (state.autoAdv && !r.pending) move(1, 0); else setPending(r.pending);
}
export function inputMod(ch) {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  const sel = ed.sel;
  const pv = prevPos(sel);
  const r = applyMod(getVal(sel), pv ? getVal(pv) : null, ch);
  if (r.target === 'prev') { setVal(pv, r.value); return; }
  setVal(sel, r.value);
  setPending(false);
  if (r.advance && state.autoAdv) move(1, 0);
}
export function del(forward) {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  if (getVal(ed.sel)) { setVal(ed.sel, ''); setPending(false); return; }
  if (!forward) {
    const pv = prevPos(ed.sel);
    if (pv) { setSel(pv, true); setVal(ed.sel, ''); }
  }
}
/** 선택한 칸의 6줄을 모두 비운다(프렛보드의 "이 칸 전체 지움"). */
export function clearColumn() {
  if (!canEditCurrentSong()) return;
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
  if (!canEditCurrentSong()) return;
  if (!ed.undoStack.length) { toast('되돌릴 작업이 없어요'); return; }
  const d = JSON.parse(ed.undoStack.pop());
  state.measures = d.measures; state.marks = d.marks || {};
  touch(); save(); render(); toast('되돌림');
}

export function addLine() {
  if (!canEditCurrentSong()) return;
  pushUndo();
  for (let k = 0; k < PER_LINE; k++) state.measures.push(emptyMeasure());
  save(); render();
  toast('마디 ' + (state.measures.length - 3) + '~' + state.measures.length + ' 추가됨');
}
export function delLine() {
  if (!canEditCurrentSong()) return;
  if (state.measures.length <= PER_LINE) { toast('마지막 한 줄은 남겨 둡니다'); return; }
  const last = state.measures.slice(-PER_LINE);
  const from = state.measures.length - PER_LINE;
  const go = hasContent(last)
    ? ask({ title: '마지막 줄 삭제', msg: '마지막 줄에 입력된 음이 있어요. 삭제할까요?', ok: '삭제' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok || !canEditCurrentSong()) return;
    pushUndo();
    state.measures.splice(-PER_LINE, PER_LINE);
    state.marks = shiftMarks(state.marks, from, -PER_LINE);
    if (ed.sel && ed.sel.m >= state.measures.length) ed.sel = null;
    save(); render(); toast('마지막 줄 삭제됨');
  });
}
export function insertMeasure(after) {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  const at = ed.sel.m + (after ? 1 : 0);
  pushUndo();
  state.measures.splice(at, 0, emptyMeasure());
  state.marks = shiftMarks(state.marks, at, 1);
  padMeasures(state.measures);
  ed.sel = { m: at, s: ed.sel.s, i: 0 };
  save(); render(); toast('마디 ' + (at + 1) + '에 빈 마디 삽입');
}
export function deleteMeasure() {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  const m = ed.sel.m;
  const go = hasContent([state.measures[m]])
    ? ask({ title: '마디 삭제', msg: '마디 ' + (m + 1) + '을 삭제하고 뒤 마디를 당길까요?', ok: '삭제' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok || !canEditCurrentSong()) return;
    pushUndo();
    state.measures.splice(m, 1);
    state.marks = shiftMarks(state.marks, m, -1);
    if (!state.measures.length) state.measures.push(emptyMeasure());
    padMeasures(state.measures);
    if (ed.sel.m >= state.measures.length) ed.sel.m = state.measures.length - 1;
    save(); render(); toast('마디 ' + (m + 1) + ' 삭제됨');
  });
}
export function copyMeasure() {
  if (!needSel()) return;
  ed.clip = { m: cloneMeasure(state.measures[ed.sel.m]), marks: measureMarks(state.marks, ed.sel.m) };
  toast('마디 ' + (ed.sel.m + 1) + ' 복사됨');
}
export function pasteMeasure() {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  if (!ed.clip) { toast('복사한 마디가 없어요'); return; }
  const m = ed.sel.m;
  pushUndo();
  state.measures[m] = cloneMeasure(ed.clip.m);
  Object.keys(state.marks).forEach((k) => { if (+k.split(':')[0] === m) delete state.marks[k]; });
  Object.keys(ed.clip.marks).forEach((i) => { state.marks[m + ':' + i] = ed.clip.marks[i]; });
  save(); render(); toast('마디 ' + (m + 1) + '에 붙여넣음');
}
export function clearMeasure() {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  if (!hasContent([state.measures[ed.sel.m]])) { toast('이미 비어 있는 마디예요'); return; }
  pushUndo();
  state.measures[ed.sel.m] = emptyMeasure();
  save(); render(); toast('마디 ' + (ed.sel.m + 1) + ' 비움');
}
export function clearAll() {
  if (!canEditCurrentSong()) return;
  const go = hasContent(state.measures)
    ? ask({ title: '전체 지우기', msg: '이 곡의 모든 음과 메모를 지우고 2줄(8마디)로 되돌릴까요?', ok: '지우기' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok || !canEditCurrentSong()) return;
    pushUndo();
    state.measures = [];
    for (let k = 0; k < DEFAULT_MEASURES; k++) state.measures.push(emptyMeasure());
    state.marks = {};
    ed.sel = { m: 0, s: 0, i: 0 };
    save(); render(); $('settingsModal').hidden = true; toast('전체 지움');
  });
}
export function editMark(m, i) {
  if (!canEditCurrentSong()) return;
  const k = m + ':' + i;
  ask({
    title: '메모 (마디 ' + (m + 1) + ', ' + (Math.floor(i / 4) + 1) + '박)',
    msg: '코드 이름, 가사, 구간 이름 등', input: true, value: state.marks[k] || '', placeholder: '예: Am, Chorus', ok: '저장'
  }).then((v) => {
    if (v === null || !canEditCurrentSong()) return;
    v = v.trim();
    if ((state.marks[k] || '') === v) return;
    pushUndo();
    if (v) state.marks[k] = v; else delete state.marks[k];
    paintMark(m, i); save();
  });
}
export function insertChord(name, fing) {
  if (!canEditCurrentSong()) return;
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
  if (state.autoAdv) move(4, 0);
}
