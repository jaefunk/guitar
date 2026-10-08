// 진입점: 이벤트 바인딩과 초기화.
import { STRINGS, SLOTS, TUNINGS, CHORDS, MODS, INSTR } from './constants.js';
import {
  state, ed, load, save, canEditCurrentSong, currentSong, persistCurrentScoreMusicXml
} from './state.js';
import { $, MODALS, openMenu, toast, closeDlg, closeModals, anyModalOpen, dlgOkValue, dlgCancelValue, updatePadH, applyTheme, applyZoom } from './ui.js';
import { render, setSel } from './render.js';
import {
  inputDigit, inputMod, del, move, doUndo, addLine, delLine, insertMeasure, deleteMeasure,
  copyMeasure, pasteMeasure, clearMeasure, clearAll, editMark, insertChord, clearColumn, needSel, buzz
} from './edit.js';
import { buildFretboard, fretTap, setPadMode, setCollapsed } from './fretboard.js';
import { pb, startPlay, stopPlay, togglePlay, setVolume, setReverb } from './audio.js';
import { toText, parseText, renderImage } from './io.js';
import { bindSongs } from './songs.js';
import { padMeasures } from './tab.js';
import { applyBpmInput, applyTitleInput, applyTuningInput, syncQuickEditability } from './quick-edit.js';
import { createScoreWorkspaceController, setScoreViewMode } from './score-render.js';
import { createScoreEditorBindings } from './score-ui.js';

let scoreController = null;
let scoreEditor = null;

function scoreElements() {
  return {
    gridWorkspace: $('gridWorkspace'), scoreWorkspace: $('scoreWorkspace'), pad: $('pad'),
    modeGrid: $('modeGrid'), modeScore: $('modeScore')
  };
}

function scoreWidth() {
  const available = $('scoreCanvas').clientWidth - 40;
  return available >= 720 ? Math.min(1120, available) : 1120;
}

function renderMeasureNavigation(index) {
  const host = $('measureNav').querySelector('.measure-nav-list');
  host.replaceChildren();
  for (const measure of index.measures) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = measure.number;
    button.dataset.measureNumber = measure.number;
    button.setAttribute('aria-label', `${measure.number}마디로 이동`);
    host.appendChild(button);
  }
}

function scrollToScoreMeasure(number) {
  const measure = [...$('scoreCanvas').querySelectorAll('[data-measure-number]')]
    .find((element) => element.dataset.measureNumber === number);
  measure?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

function applyViewMode(mode, persist = true) {
  const next = setScoreViewMode(mode, {
    settings: state, song: currentSong(), persist: persist ? save : null, elements: scoreElements()
  });
  document.body.classList.toggle('score-mode', next.mode === 'score');
  if (next.mode === 'score') scoreController?.renderScreen();
}

/* ---------- 내보내기/불러오기 글루 ---------- */
function openExport() { $('exportText').value = toText(state); $('modal').hidden = false; }
function copyText() {
  const ta = $('exportText'), txt = ta.value;
  const fallback = () => {
    try {
      ta.focus(); ta.select(); ta.setSelectionRange(0, txt.length);
      const ok = document.execCommand && document.execCommand('copy');
      toast(ok ? '복사됨' : '텍스트를 길게 눌러 복사하세요');
    } catch (e) { toast('텍스트를 길게 눌러 복사하세요'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => { toast('복사됨'); }, fallback);
  else fallback();
}
function doImport() {
  if (!canEditCurrentSong()) { syncQuickEditability(); toast('읽기 전용 MusicXML입니다'); return; }
  const ms = parseText($('importText').value);
  if (!ms) { toast('형식을 읽지 못했어요. 이 에디터의 텍스트만 지원해요'); return; }
  // pushUndo와 같은 순서: 스냅샷 → 변경 → 저장
  ed.undoStack.push(JSON.stringify({ measures: state.measures, marks: state.marks }));
  state.measures = ms; state.marks = {}; padMeasures(state.measures);
  ed.sel = { m: 0, s: 0, i: 0 };
  save(); render(); $('importModal').hidden = true;
  toast(ms.length + '마디 불러옴');
}
function openImage() {
  let cv;
  try { cv = renderImage(state); } catch (e) { toast('이미지를 만들지 못했어요'); return; }
  const out = $('imgOut'); out.innerHTML = '';
  const img = document.createElement('img'); img.alt = '타브 악보 이미지';
  try { img.src = cv.toDataURL('image/png'); } catch (e) { toast('이미지를 만들지 못했어요'); return; }
  out.appendChild(img); $('imgModal').hidden = false;
}

/* ---------- 이벤트 ---------- */
function bind() {
  $('modeGrid').addEventListener('click', () => { applyViewMode('grid'); });
  $('modeScore').addEventListener('click', () => { applyViewMode('score'); });
  $('measureNav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-measure-number]');
    if (!button) return;
    scrollToScoreMeasure(button.dataset.measureNumber);
  });
  $('sheet').addEventListener('click', (e) => {
    const mk = e.target.closest('.mk');
    if (mk) { const mm = +mk.dataset.m, ii = +mk.dataset.i; setSel({ m: mm, s: ed.sel ? ed.sel.s : 0, i: ii }, false); editMark(mm, ii); return; }
    const rm = e.target.closest('.ruler .measure');
    if (rm) { setSel({ m: +rm.dataset.m, s: ed.sel ? ed.sel.s : 0, i: 0 }, true); if (state.collapsed) setCollapsed(false); return; }
    const c = e.target.closest('.cell'); if (!c) return;
    setSel({ m: +c.dataset.m, s: +c.dataset.s, i: +c.dataset.i }, false);
    if (state.collapsed) setCollapsed(false);
  });
  const d = $('digits');
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].forEach((n) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'key'; b.textContent = n; b.dataset.digit = n; d.appendChild(b);
  });
  $('pad').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.digit !== undefined) { buzz(); inputDigit(b.dataset.digit); }
    else if (b.dataset.mod !== undefined) { buzz(); inputMod(b.dataset.mod); }
    else if (b.id === 'del') { buzz(); del(false); }
    else if (b.dataset.move) { if (!ed.sel) { setSel({ m: 0, s: 0, i: 0 }, true); return; } const mv = b.dataset.move.split(','); move(+mv[0], +mv[1]); }
    else if (b.classList.contains('fb-cell')) { buzz(); fretTap(+b.dataset.s, +b.dataset.f); }
  });
  $('playBtn').addEventListener('click', togglePlay);
  $('restartBtn').addEventListener('click', () => { startPlay(0); });
  $('bpm').addEventListener('change', function () {
    applyBpmInput(this);
  });
  const syncMetro = () => { $('metroBtn').classList.toggle('on', state.metro); $('metroBtn').setAttribute('aria-pressed', String(state.metro)); };
  $('metroBtn').addEventListener('click', () => { state.metro = !state.metro; save(); syncMetro(); toast(state.metro ? '메트로놈 켬' : '메트로놈 끔'); });
  $('loop').addEventListener('change', function () { state.loop = this.value; save(); if (pb.playing) startPlay(); });
  $('modeKeys').addEventListener('click', () => { setPadMode('keys'); syncQuickEditability(); });
  $('modeFret').addEventListener('click', () => { setPadMode('fret'); syncQuickEditability(); });
  $('collapseBtn').addEventListener('click', () => { setCollapsed(!state.collapsed); });
  $('fbShift').addEventListener('click', () => {
    state.fretShift = state.fretShift ? 0 : 12; save(); buildFretboard(); syncQuickEditability();
  });
  $('fbClear').addEventListener('click', clearColumn);

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const t = e.target, tag = t && t.tagName;
    if (anyModalOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); closeModals(); }
      else if (e.key === 'Enter' && !$('dlg').hidden && tag !== 'TEXTAREA') { e.preventDefault(); closeDlg(dlgOkValue()); }
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (mod && k.toLowerCase() === 'c') { e.preventDefault(); copyMeasure(); return; }
    if (mod && k.toLowerCase() === 'v') { e.preventDefault(); pasteMeasure(); return; }
    if (mod || e.altKey) return;
    if (k === ' ') { e.preventDefault(); togglePlay(); return; }
    if (k === 'Escape') { setSel(null, false); return; }
    if (!ed.sel) { if (k.indexOf('Arrow') === 0) { e.preventDefault(); setSel({ m: 0, s: 0, i: 0 }, true); } return; }
    const sel = ed.sel;
    if (/^[0-9]$/.test(k)) { e.preventDefault(); inputDigit(k); }
    else if (MODS.indexOf(k.toLowerCase()) >= 0) { e.preventDefault(); inputMod(k.toLowerCase()); }
    else if (k === 'Backspace') { e.preventDefault(); del(false); }
    else if (k === 'Delete') { e.preventDefault(); del(true); }
    else if (k === 'Enter') { e.preventDefault(); editMark(sel.m, sel.i); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(e.shiftKey ? -4 : -1, 0); }
    else if (k === 'ArrowRight') { e.preventDefault(); move(e.shiftKey ? 4 : 1, 0); }
    else if (k === 'Tab') { e.preventDefault(); move(e.shiftKey ? -4 : 4, 0); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(0, -1); }
    else if (k === 'ArrowDown') { e.preventDefault(); move(0, 1); }
    else if (k === 'Home') { e.preventDefault(); move(-sel.i, 0); }
    else if (k === 'End') { e.preventDefault(); move(SLOTS - 1 - sel.i, 0); }
  });

  $('addLine').addEventListener('click', addLine);
  $('measureMenu').addEventListener('click', () => {
    const has = !!ed.sel, mName = ed.sel ? '마디 ' + (ed.sel.m + 1) : '마디';
    openMenu(mName, [
      { k: '+', label: '앞에 빈 마디 삽입', desc: '뒤 마디가 한 칸씩 밀려요', action: () => { insertMeasure(false); }, disabled: !has },
      { k: '+', label: '뒤에 빈 마디 삽입', action: () => { insertMeasure(true); }, disabled: !has },
      { k: '⎘', label: '마디 복사', desc: 'Ctrl+C', action: copyMeasure, disabled: !has },
      { k: '⎗', label: '붙여넣기', desc: ed.clip ? '복사한 마디로 덮어써요' : '복사한 마디가 없어요', action: pasteMeasure, disabled: !has || !ed.clip },
      { k: '○', label: '마디 비우기', desc: '음만 지우고 마디는 남겨요', action: clearMeasure, disabled: !has },
      { k: '×', label: '마디 삭제', desc: '뒤 마디를 당겨요', action: deleteMeasure, danger: true, disabled: !has },
      { k: '×', label: '마지막 줄 삭제', desc: '4마디를 지워요', action: delLine, danger: true }
    ]);
  });
  $('exportMenu').addEventListener('click', () => {
    openMenu('내보내기', [
      { k: 'T', label: '텍스트 타브', desc: '복사해서 어디든 붙여 넣기', action: openExport },
      { k: '▣', label: '이미지로 저장', desc: 'PNG, 길게 눌러 저장', action: openImage },
      { k: '↓', label: '텍스트 불러오기', desc: '내보낸 텍스트로 복원', action: () => { $('importText').value = ''; $('importModal').hidden = false; setTimeout(() => { $('importText').focus(); }, 40); } }
    ]);
  });
  $('settingsBtn').addEventListener('click', () => { $('settingsModal').hidden = false; });
  $('closeSettings').addEventListener('click', () => { $('settingsModal').hidden = true; });
  $('undo').addEventListener('click', doUndo);
  $('clearAll').addEventListener('click', clearAll);
  $('chordBtn').addEventListener('click', () => { if (!needSel()) return; $('chordModal').hidden = false; });
  $('markBtn').addEventListener('click', () => { if (!needSel()) return; editMark(ed.sel.m, ed.sel.i); });
  $('helpBtn').addEventListener('click', () => { $('helpModal').hidden = false; });
  $('closeModal').addEventListener('click', () => { $('modal').hidden = true; });
  $('closeImport').addEventListener('click', () => { $('importModal').hidden = true; });
  $('doImport').addEventListener('click', doImport);
  $('closeImg').addEventListener('click', () => { $('imgModal').hidden = true; });
  $('closeChord').addEventListener('click', () => { $('chordModal').hidden = true; });
  $('closeHelp').addEventListener('click', () => { $('helpModal').hidden = true; });
  const closeCoach = () => { $('coachModal').hidden = true; state.seen = true; save(); };
  $('closeCoach').addEventListener('click', closeCoach);
  $('copyBtn').addEventListener('click', copyText);
  $('dlgOk').addEventListener('click', () => { closeDlg(dlgOkValue()); });
  $('dlgCancel').addEventListener('click', () => { closeDlg(dlgCancelValue()); });
  MODALS.forEach((id) => {
    $(id).addEventListener('click', function (e) {
      if (e.target !== this) return;
      if (id === 'dlg') closeDlg(dlgCancelValue());
      else if (id === 'coachModal') closeCoach();
      else this.hidden = true;
    });
  });
  $('chordGrid').addEventListener('click', (e) => { const b = e.target.closest('.chord'); if (!b) return; buzz(); insertChord(b.dataset.name, b.dataset.fing); });
  $('title').addEventListener('input', function () { applyTitleInput(this); });
  $('zoom').addEventListener('change', function () { state.zoom = this.value; save(); applyZoom(); });
  $('theme').addEventListener('change', function () { state.theme = this.value; save(); applyTheme(); });
  $('tuning').addEventListener('change', function () {
    if (!applyTuningInput(this)) return;
    render(); if (state.padMode === 'fret') buildFretboard();
  });
  const syncAuto = () => { $('autoAdv').checked = state.autoAdv; $('autoAdv2').checked = state.autoAdv; };
  $('autoAdv').addEventListener('change', function () { state.autoAdv = this.checked; save(); syncAuto(); });
  $('autoAdv2').addEventListener('change', function () { state.autoAdv = this.checked; save(); syncAuto(); });
  $('haptic').addEventListener('change', function () { state.haptic = this.checked; save(); });
  $('instr').addEventListener('change', function () { state.instr = this.value; save(); toast(INSTR[state.instr].name); });
  $('volume').addEventListener('input', function () { setVolume(this.value / 100); save(); });
  $('reverb').addEventListener('input', function () { setReverb(this.value / 100); save(); });
  $('countIn').addEventListener('change', function () { state.countIn = this.checked; save(); });
  $('preview').addEventListener('change', function () { state.preview = this.checked; save(); });
  window.addEventListener('resize', () => {
    updatePadH();
    if (state.zoom === 'fit') applyZoom();
    if (state.viewMode === 'score') scoreController?.scheduleScreenRender();
  });
  window.addEventListener('gtab:songchange', () => {
    if (state.viewMode === 'score') scoreController?.renderScreen();
  });
  if (window.ResizeObserver) new ResizeObserver(updatePadH).observe($('pad'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && pb.playing) stopPlay(); });
  bindSongs();
  return { syncAuto, syncMetro };
}

/* ---------- 시작 ---------- */
function boot() {
  load();
  scoreEditor = createScoreEditorBindings({
    inspector: $('scoreInspector'),
    getSong: currentSong,
    persistMusicXml: persistCurrentScoreMusicXml,
    rerender: (_measureIndices, selectedEventId) => {
      scoreController?.setSelectedEventId(selectedEventId);
      scoreController?.renderScreen(true);
    }
  });
  scoreController = createScoreWorkspaceController({
    canvas: $('scoreCanvas'),
    diagnostics: $('scoreDiagnostics'),
    inspector: $('scoreInspector'),
    getSong: currentSong,
    getScreenWidth: scoreWidth,
    onMeasure: scrollToScoreMeasure,
    renderInspector: (_host, event) => scoreEditor.render(event),
    onRendered: (result) => {
      if (result?.index) renderMeasureNavigation(result.index);
      else $('measureNav').querySelector('.measure-nav-list').replaceChildren();
    }
  });
  const t = $('tuning');
  Object.keys(TUNINGS).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = TUNINGS[k].name; t.appendChild(o); });
  const g = $('chordGrid');
  CHORDS.forEach((ch) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chord'; b.dataset.name = ch[0]; b.dataset.fing = ch[1];
    const n = document.createElement('b'); n.textContent = ch[0];
    const f = document.createElement('small'); f.textContent = ch[1];
    b.appendChild(n); b.appendChild(f); g.appendChild(b);
  });
  const s = $('instr');
  Object.keys(INSTR).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = INSTR[k].name; s.appendChild(o); });
  const { syncAuto, syncMetro } = bind();
  $('title').value = state.title; $('tuning').value = state.tuning; $('zoom').value = state.zoom; $('theme').value = state.theme;
  $('bpm').value = state.bpm; $('loop').value = state.loop; $('haptic').checked = state.haptic; s.value = state.instr;
  $('volume').value = Math.round(state.volume * 100); $('reverb').value = Math.round(state.reverb * 100);
  $('countIn').checked = state.countIn; $('preview').checked = state.preview;
  syncAuto(); syncMetro(); applyTheme(); applyZoom();
  ed.sel = { m: 0, s: 0, i: 0 };
  render();
  applyViewMode(state.viewMode, false);
  setPadMode(state.padMode);
  setCollapsed(state.collapsed);
  syncQuickEditability();
  updatePadH();
  if (!state.seen) $('coachModal').hidden = false;
}

boot();
