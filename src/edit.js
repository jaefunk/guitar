// 편집 동작. 모든 변경은 pushUndo() → state 변경 → save() 순서.
import { STRINGS, PER_LINE, DEFAULT_MEASURES, METERS } from './constants.js';
import { state, ed, save, touch, canEditCurrentSong } from './state.js';
import {
  parse, nextDigit, applyMod, prevPos, emptyMeasure, hasContent,
  shiftMarks, padMeasures, slotsOf, beatOf, resizeMeasures,
  sliceRange, pasteRange, clearRange as clearRangeCells, transposeRange as transposeRangeCells, shiftRange as shiftRangeCells,
  togglePm, allPm, shiftRep, cleanRep, colRange, measureRange, voltaLabel, parseVolta
} from './tab.js';
import { paintCell, paintMark, setSel, setPending, cellAt, render, applyRange } from './render.js';
import { $, toast, ask } from './ui.js';
import { preview } from './audio.js';
import { updateFretboard } from './fretboard.js';

function snapshot() { return JSON.stringify({ measures: state.measures, marks: state.marks, pm: state.pm, rep: state.rep }); }
export function pushUndo() {
  if (!canEditCurrentSong()) return false;
  ed.undoStack.push(snapshot());
  if (ed.undoStack.length > 120) ed.undoStack.shift();
  ed.redoStack = []; // 새 변경이 생기면 다시 실행 기록은 버린다
  touch();
  return true;
}
function restore(json) {
  const d = JSON.parse(json);
  state.measures = d.measures; state.marks = d.marks || {}; state.pm = d.pm || {}; state.rep = d.rep || {};
  touch(); save(); render();
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
  const pv = prevPos(sel, slotsOf(state));
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
    const pv = prevPos(ed.sel, slotsOf(state));
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
  ed.redoStack.push(snapshot());
  restore(ed.undoStack.pop()); toast('되돌림');
}
export function doRedo() {
  if (!canEditCurrentSong()) return;
  if (!ed.redoStack.length) { toast('다시 실행할 작업이 없어요'); return; }
  ed.undoStack.push(snapshot());
  restore(ed.redoStack.pop()); toast('다시 실행');
}

export function addLine() {
  if (!canEditCurrentSong()) return;
  pushUndo();
  for (let k = 0; k < PER_LINE; k++) state.measures.push(blank());
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
    state.marks = shiftMarks(state.marks, from, -PER_LINE); state.pm = shiftMarks(state.pm, from, -PER_LINE); state.rep = shiftRep(state.rep, from, -PER_LINE);
    if (ed.sel && ed.sel.m >= state.measures.length) ed.sel = null;
    save(); render(); toast('마지막 줄 삭제됨');
  });
}
export function insertMeasure(after) {
  if (!canEditCurrentSong()) return;
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
  ed.clip = sliceRange(state, r);
  toast(rangeLabel(r) + ' 복사됨');
}
export function pasteMeasure() {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  if (!ed.clip) { toast('복사한 마디가 없어요'); return; }
  const slots = slotsOf(state);
  // 마디 단위 클립은 선택한 마디의 처음부터, 칸 단위 클립은 선택한 칸부터 붙인다
  const gAt = ed.clip.aligned ? ed.sel.m * slots : ed.sel.m * slots + ed.sel.i;
  pushUndo();
  pasteRange(state, ed.clip, gAt);
  save(); render();
  const m = Math.floor(gAt / slots), mEnd = Math.floor((gAt + ed.clip.n - 1) / slots);
  toast(m === mEnd ? '마디 ' + (m + 1) + '에 붙여넣음' : '마디 ' + (m + 1) + '~' + (mEnd + 1) + '에 붙여넣음');
}
export function clearMeasure() {
  if (!canEditCurrentSong()) return;
  if (!needSel()) return;
  if (!hasContent([state.measures[ed.sel.m]])) { toast('이미 비어 있는 마디예요'); return; }
  pushUndo();
  state.measures[ed.sel.m] = blank();
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
    for (let k = 0; k < DEFAULT_MEASURES; k++) state.measures.push(blank());
    state.marks = {}; state.pm = {}; state.rep = {}; ed.range = null;
    ed.sel = { m: 0, s: 0, i: 0 };
    save(); render(); $('settingsModal').hidden = true; toast('전체 지움');
  });
}
export function editMark(m, i) {
  if (!canEditCurrentSong()) return;
  const k = m + ':' + i;
  ask({
    title: '메모 (마디 ' + (m + 1) + ', ' + (Math.floor(i / beatOf(state)) + 1) + '박)',
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
  if (state.autoAdv) move(beatOf(state), 0);
}

/** 박자표 변경: 마디 칸 수를 맞춰 자르거나 채운다. 잘려 나가는 음이 있으면 묻는다. */
export function setMeter(meter) {
  if (!canEditCurrentSong()) return Promise.resolve(false);
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

/* ---------- 범위(다중 선택): 칸 단위 ---------- */
function rangeOrSel() {
  if (ed.range) return ed.range;
  if (!needSel()) return null;
  return measureRange(ed.sel.m, ed.sel.m, slotsOf(state));
}
/** 마디 m을 범위에 넣는다(없으면 그 마디 전체로 시작, 있으면 그 마디까지 넓힘). */
export function setRange(m) {
  const slots = slotsOf(state);
  if (!ed.range) ed.range = measureRange(m, m, slots);
  else extendRange({ m, i: 0 }, true);
  applyRange();
}
/** 칸 단위 범위 시작: 그 칸의 세로 열 하나 */
export function setRangeCell(p) {
  ed.range = { from: { m: p.m, i: p.i }, to: { m: p.m, i: p.i } };
  applyRange();
}
/**
 * 범위를 칸 p까지 넓힌다. wholeMeasure면 p가 든 마디 전체까지.
 *  - 기본(탭): 범위 밖이면 가까운 쪽 끝을 p까지 늘리고, 범위 안이면 그대로 둔다(폰에서 실수로 줄어들지 않게).
 *  - anchor(Shift+클릭): 시작점은 두고 끝점만 p로 옮긴다(줄어들 수 있음).
 * 범위가 없으면 현재 선택부터 시작한다.
 */
export function extendRange(p, wholeMeasure, anchor) {
  const slots = slotsOf(state);
  if (!ed.range) { if (!ed.sel) return; ed.range = { from: { m: ed.sel.m, i: ed.sel.i }, to: { m: ed.sel.m, i: ed.sel.i } }; }
  const r = colRange(ed.range, slots), g = p.m * slots + p.i;
  const mStart = p.m * slots, mEnd = p.m * slots + slots - 1;
  let gA = r.gA, gB = r.gB;
  if (anchor) {
    const g0 = ed.range.from.m * slots + ed.range.from.i;
    if (g >= g0) { gA = g0; gB = wholeMeasure ? mEnd : g; } else { gA = wholeMeasure ? mStart : g; gB = g0; }
  } else if (g < gA) gA = wholeMeasure ? mStart : g;
  else if (g > gB) gB = wholeMeasure ? mEnd : g;
  else if (wholeMeasure) { gA = Math.min(gA, mStart); gB = Math.max(gB, mEnd); }
  else { applyRange(); return; }
  ed.range = { from: { m: Math.floor(gA / slots), i: gA % slots }, to: { m: Math.floor(gB / slots), i: gB % slots } };
  applyRange();
}
export function clearRange() { if (!ed.range) return; ed.range = null; applyRange(); }
/** 범위 설명. 마디 경계에 맞으면 "마디 2~3 (2마디)", 아니면 "마디 2 3박~마디 3 1박 (12칸)" */
export function rangeLabel(range) {
  const r = range || ed.range; if (!r) return '';
  const slots = slotsOf(state), c = colRange(r, slots), BEAT = beatOf(state);
  if (c.aligned) return c.fromM === c.toM ? '마디 ' + (c.fromM + 1) : '마디 ' + (c.fromM + 1) + '~' + (c.toM + 1) + ' (' + (c.toM - c.fromM + 1) + '마디)';
  const pos = (g) => '마디 ' + (Math.floor(g / slots) + 1) + ' ' + (Math.floor((g % slots) / BEAT) + 1) + '박 ' + ((g % slots) % BEAT + 1) + '번째';
  return (c.n === 1 ? pos(c.gA) : pos(c.gA) + ' ~ ' + pos(c.gB)) + ' (' + c.n + '칸)';
}
/** 범위가 마디 경계에 맞는가(마디 삭제가 가능한 범위) */
export function rangeAligned() { return !!ed.range && colRange(ed.range, slotsOf(state)).aligned; }
/** 범위 삭제: 마디 단위면 마디를 지우고 뒤를 당긴다. 칸 단위면 그 칸들을 비운다. */
export function deleteRange() {
  if (!canEditCurrentSong()) return;
  const r = ed.range; if (!r) return;
  const slots = slotsOf(state), c = colRange(r, slots);
  if (!c.aligned) {
    pushUndo();
    clearRangeCells(state, r);
    save(); render(); toast(rangeLabel(r) + ' 비움');
    return;
  }
  const n = c.toM - c.fromM + 1;
  const go = hasContent(state.measures.slice(c.fromM, c.toM + 1))
    ? ask({ title: '마디 삭제', msg: rangeLabel(r) + '을(를) 삭제하고 뒤 마디를 당길까요?', ok: '삭제' })
    : Promise.resolve(true);
  go.then((ok) => {
    if (!ok || !canEditCurrentSong()) return;
    pushUndo();
    state.measures.splice(c.fromM, n);
    state.marks = shiftMarks(state.marks, c.fromM, -n); state.pm = shiftMarks(state.pm, c.fromM, -n); state.rep = shiftRep(state.rep, c.fromM, -n);
    if (!state.measures.length) state.measures.push(blank());
    padMeasures(state.measures, slots);
    ed.range = null;
    if (ed.sel) ed.sel.m = Math.min(c.fromM, state.measures.length - 1);
    save(); render(); toast(n + '마디 삭제됨');
  });
}
export function transposeRange() {
  if (!canEditCurrentSong()) return;
  const r = rangeOrSel(); if (!r) return;
  ask({ title: '조옮김', msg: rangeLabel(r) + '의 모든 프렛에 더할 수 (예: 2, -3, 12)', input: true, value: '', placeholder: '반음 수', ok: '적용' })
    .then((v) => {
      if (v === null || !canEditCurrentSong()) return;
      const n = Math.round(+v);
      if (!n) { toast('0이 아닌 정수를 넣으세요'); return; }
      const out = transposeRangeCells(state, r, n);
      if (!out) { toast('0 미만이나 24 초과 프렛이 생겨서 바꾸지 않았어요'); return; }
      pushUndo();
      state.measures = out;
      save(); render(); toast((n > 0 ? '+' : '') + n + ' 프렛 조옮김');
    });
}
export function shiftRange(dir) {
  if (!canEditCurrentSong()) return;
  const r = rangeOrSel(); if (!r) return;
  const res = shiftRangeCells(state, r, dir);
  pushUndo();
  state.measures = res.measures; state.marks = res.marks; state.pm = res.pm;
  save(); render(); toast(dir > 0 ? '한 칸 오른쪽으로 밀었어요' : '한 칸 왼쪽으로 밀었어요');
}
export function togglePmRange() {
  if (!canEditCurrentSong()) return;
  const r = rangeOrSel(); if (!r) return;
  const slots = slotsOf(state), on = !allPm(state.pm, r, slots);
  pushUndo();
  state.pm = togglePm(state.pm, r, slots);
  save(); render(); toast(on ? '팜뮤트 켬 (P.M.)' : '팜뮤트 끔');
}

/* ---------- 반복 기호 ---------- */
function repOf(m) { return state.rep[m] || {}; }
/** 반복 시작/끝/괄호를 바꾼다. patch 예: {s:1} {s:0} {e:3} {e:0} {v:2} {v:0} */
export function setRep(m, patch) {
  if (!canEditCurrentSong()) return;
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
    { k: voltaLabel(r.v) || '1.', label: voltaLabel(r.v) ? '괄호 지우기 (' + voltaLabel(r.v) + ')' : '1번 괄호 (첫 번째 연주 때만)', action: () => { setRep(m, { v: voltaLabel(r.v) ? 0 : 1 }); } },
    { k: '2.', label: '2번 괄호 (두 번째 연주 때만)', disabled: voltaLabel(r.v) === '2.', action: () => { setRep(m, { v: 2 }); } },
    { k: '1,2', label: '괄호 번호 직접 넣기', desc: '예: 1,2 (첫째·둘째 연주 때), 3', action: () => {
      ask({ title: '괄호 번호', msg: '이 마디를 몇 번째 연주 때 칠지 쉼표로 적으세요 (1~9)', input: true, value: voltaLabel(r.v).replace(/\.$/, ''), placeholder: '1,2', ok: '적용' }).then((v) => {
        if (v === null) return;
        const parsed = parseVolta(v);
        if (!parsed && v.trim()) { toast('1~9 사이 숫자를 쉼표로 적으세요'); return; }
        setRep(m, { v: parsed });
      });
    } }
  ];
}

/** 메모를 바로 넣는다(코드 인식 칩용) */
export function setMark(m, i, v) {
  if (!canEditCurrentSong()) return;
  const k = m + ':' + i;
  if ((state.marks[k] || '') === v) return;
  pushUndo();
  if (v) state.marks[k] = v; else delete state.marks[k];
  paintMark(m, i); save();
}
