// 진입점: 이벤트 바인딩과 초기화.
import { TUNINGS, CHORDS, MODS, INSTR, METERS } from './constants.js';
import {
  state, ed, load, save, canEditCurrentSong, currentSong, importMusicXmlSong, persistCurrentScoreMusicXml, toDoc, importBackup
} from './state.js';
import { $, MODALS, openMenu, toast, closeDlg, closeModals, anyModalOpen, dlgOkValue, dlgCancelValue, updatePadH, applyTheme, applyZoom, downloadBlob, safeName } from './ui.js';
import { render, setSel } from './render.js';
import {
  inputDigit, inputMod, del, move, doUndo, doRedo, addLine, delLine, insertMeasure, deleteMeasure,
  copyMeasure, pasteMeasure, clearMeasure, clearAll, editMark, insertChord, clearColumn, needSel, buzz, setMeter, pushUndo,
  setRange, setRangeCell, extendRange, clearRange, deleteRange, transposeRange, shiftRange, togglePmRange, repeatMenuItems, setMark
} from './edit.js';
import { buildFretboard, fretTap, setPadMode, setCollapsed } from './fretboard.js';
import { pb, startPlay, startScorePlay, stopPlay, setVolume, setReverb, decodeSample } from './audio.js';
import * as samples from './samples.js';
import { toText, parseText, renderImage } from './io.js';
import { toMidi } from './midi.js';
import { chordDiagramSVG } from './chords.js';
import { bindSongs, refreshSongUI } from './songs.js';
import { padMeasures, slotsOf, beatOf } from './tab.js';
import { applyBpmInput, applyTitleInput, applyTuningInput, syncQuickEditability } from './quick-edit.js';
import { createScoreWorkspaceController, setScoreViewMode } from './score-render.js';
import { createScoreEditorBindings } from './score-ui.js';
import { createMusicXmlDownload, createMusicXmlImportController } from './file-workflow.js';

let scoreController = null;
let scoreEditor = null;
let musicXmlImportController = null;

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
  if (!measure) return;
  measure.setAttribute('tabindex', '-1');
  measure.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  measure.focus({ preventScroll: true });
}

function applyViewMode(mode, persist = true) {
  stopPlay();
  const next = setScoreViewMode(mode, {
    settings: state, song: currentSong(), persist: persist ? save : null, elements: scoreElements()
  });
  document.body.classList.toggle('score-mode', next.mode === 'score');
  if (next.mode === 'score') scoreController?.renderScreen();
}

function startCurrentPlayback(restart = false) {
  if (state.viewMode === 'score') {
    const result = scoreController?.getLastResult() || scoreController?.renderScreen();
    return startScorePlay(result?.index, {
      selectedEventId: scoreController?.getSelectedEventId(), canvas: $('scoreCanvas')
    });
  }
  return startPlay(restart ? 0 : undefined);
}

function toggleCurrentPlayback() {
  if (pb.playing) stopPlay();
  else startCurrentPlayback(false);
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
  const r = parseText($('importText').value);
  if (!r) { toast('형식을 읽지 못했어요. 이 에디터의 텍스트만 지원해요'); return; }
  pushUndo();
  state.measures = r.measures; state.marks = r.marks; state.pm = r.pm || {}; state.rep = r.rep || {}; state.meter = r.meter;
  if (r.bpm && r.bpm >= 40 && r.bpm <= 240) { state.bpm = r.bpm; $('bpm').value = r.bpm; }
  if (r.title && !state.title) { state.title = r.title; $('title').value = r.title; }
  $('meter').value = state.meter;
  padMeasures(state.measures, slotsOf(state));
  ed.sel = { m: 0, s: 0, i: 0 };
  save(); render(); $('importModal').hidden = true;
  toast(r.measures.length + '마디 불러옴');
}
let lastCanvas = null;
function openImage() {
  let cv;
  try { cv = renderImage(state); } catch (e) { toast('이미지를 만들지 못했어요'); return; }
  const out = $('imgOut'); out.innerHTML = '';
  const img = document.createElement('img'); img.alt = '타브 악보 이미지';
  try { img.src = cv.toDataURL('image/png'); } catch (e) { toast('이미지를 만들지 못했어요'); return; }
  lastCanvas = cv;
  out.appendChild(img); $('imgModal').hidden = false;
}
function downloadImage() {
  if (!lastCanvas) return;
  const name = safeName(state.title, 'tab') + '.png';
  if (lastCanvas.toBlob) lastCanvas.toBlob((b) => { if (b) { downloadBlob(name, b); toast('PNG 저장'); } else toast('이미지를 만들지 못했어요'); }, 'image/png');
}
function downloadMidi() {
  let bytes;
  try { bytes = toMidi(state, { instr: state.instr }); } catch (e) { toast('MIDI를 만들지 못했어요'); return; }
  downloadBlob(safeName(state.title, 'tab') + '.mid', new Blob([bytes], { type: 'audio/midi' }));
  toast('MIDI ' + bytes.noteCount + '음 저장');
}
function downloadBackup() {
  const doc = toDoc();
  downloadBlob('guitar-tab-backup-' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(doc)], { type: 'application/json' }));
  toast(doc.order.length + '곡 백업 저장');
}
function restoreBackup(file) {
  if (!file) return;
  file.text().then((txt) => {
    let value;
    try { value = JSON.parse(txt); } catch (e) { toast('백업 파일을 읽지 못했어요'); return; }
    const n = importBackup(value);
    if (!n) { toast('백업에서 읽을 곡이 없어요'); return; }
    refreshSongUI();
    toast(n + '곡을 목록에 추가했어요');
  }, () => { toast('백업 파일을 읽지 못했어요'); });
}
function downloadText() {
  downloadBlob(safeName(state.title, 'tab') + '.txt', new Blob([toText(state)], { type: 'text/plain;charset=utf-8' }));
  toast('텍스트 저장');
}

/** 시작 시 샘플 디코드: AudioContext가 없으면 OfflineAudioContext로 디코드한다(제스처 불필요) */
function decodeSampleSilently(data) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return Promise.reject(new Error('no audio'));
  const oc = new OAC(1, 1, 44100);
  return new Promise((res, rej) => { oc.decodeAudioData(data, res, rej); });
}

function downloadMusicXml(format) {
  const song = currentSong();
  if (!song?.musicxml) { toast('내보낼 MusicXML 악보가 없습니다'); return; }
  try {
    createMusicXmlDownload({ xml: song.musicxml, title: song.title, format });
    toast(format === 'mxl' ? 'MXL 다운로드 시작' : 'MusicXML 다운로드 시작');
  } catch (error) {
    toast(error?.message || 'MusicXML을 내보내지 못했습니다');
  }
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
  // 마디 번호 길게 누르기 → 범위 선택 시작
  let pressT = null, pressed = false;
  const sheetEl = $('sheet');
  sheetEl.addEventListener('pointerdown', (e) => {
    const rm = e.target.closest('.ruler .measure'), cell = e.target.closest('.cell');
    if (!rm && !cell) return;
    pressed = false;
    pressT = setTimeout(() => {
      pressed = true; buzz();
      if (rm) { setRange(+rm.dataset.m); toast('범위 선택: 다른 마디 번호나 칸을 탭해 넓히세요'); }
      else { if (ed.range) extendRange({ m: +cell.dataset.m, i: +cell.dataset.i }, false); else { setSel({ m: +cell.dataset.m, s: +cell.dataset.s, i: +cell.dataset.i }, false); setRangeCell({ m: +cell.dataset.m, i: +cell.dataset.i }); } toast('칸 범위 선택: 다른 칸을 탭해 넓히세요'); }
    }, 450);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => sheetEl.addEventListener(ev, () => { clearTimeout(pressT); }));
  sheetEl.addEventListener('contextmenu', (e) => { if (e.target.closest('.ruler .measure')) e.preventDefault(); });
  sheetEl.addEventListener('click', (e) => {
    if (pressed) { pressed = false; return; }
    const mk = e.target.closest('.mk');
    if (mk) { const mm = +mk.dataset.m, ii = +mk.dataset.i; setSel({ m: mm, s: ed.sel ? ed.sel.s : 0, i: ii }, false); editMark(mm, ii); return; }
    const rm = e.target.closest('.ruler .measure');
    if (rm) {
      const m = +rm.dataset.m;
      if (e.shiftKey && ed.sel) { if (!ed.range) setRange(ed.sel.m); extendRange({ m, i: 0 }, true, true); return; }
      if (ed.range) { setRange(m); return; }
      setSel({ m, s: ed.sel ? ed.sel.s : 0, i: 0 }, true); if (state.collapsed) setCollapsed(false); return;
    }
    const c = e.target.closest('.cell'); if (!c) return;
    const p = { m: +c.dataset.m, s: +c.dataset.s, i: +c.dataset.i };
    if (e.shiftKey && ed.sel) { extendRange({ m: p.m, i: p.i }, false, true); return; }
    if (ed.range) { extendRange({ m: p.m, i: p.i }, false); setSel(p, false); return; }
    setSel(p, false);
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
    else if (b.dataset.move) {
      if (!ed.sel) { setSel({ m: 0, s: 0, i: 0 }, true); return; }
      const mv = b.dataset.move.split(',');
      const di = +mv[0];
      // ±4는 "한 박"을 뜻한다(박자표에 따라 칸 수가 다름)
      move(Math.abs(di) === 4 ? Math.sign(di) * beatOf(state) : di, +mv[1]);
    }
    else if (b.classList.contains('fb-cell')) { buzz(); fretTap(+b.dataset.s, +b.dataset.f); }
  });
  $('playBtn').addEventListener('click', toggleCurrentPlayback);
  $('restartBtn').addEventListener('click', () => { startCurrentPlayback(true); });
  $('bpm').addEventListener('change', function () {
    applyBpmInput(this);
    if (pb.playing) startCurrentPlayback();
  });
  const syncMetro = () => { $('metroBtn').classList.toggle('on', state.metro); $('metroBtn').setAttribute('aria-pressed', String(state.metro)); };
  $('metroBtn').addEventListener('click', () => {
    state.metro = !state.metro; save(); syncMetro();
    if (pb.playing) startCurrentPlayback();
    toast(state.metro ? '메트로놈 켬' : '메트로놈 끔');
  });
  $('loop').addEventListener('change', function () { state.loop = this.value; save(); if (pb.playing) startCurrentPlayback(); });
  // 속도 트레이너
  const syncTrainer = () => {
    const t = state.trainer;
    $('trainerBtn').classList.toggle('on', t.on); $('trainerBtn').setAttribute('aria-pressed', String(t.on));
    $('trOn').checked = t.on; $('trStart').value = t.start; $('trStep').value = t.step; $('trMax').value = t.max;
  };
  $('trainerBtn').addEventListener('click', () => { syncTrainer(); $('trainerModal').hidden = false; });
  $('closeTrainer').addEventListener('click', () => { $('trainerModal').hidden = true; });
  $('trOn').addEventListener('change', function () { state.trainer.on = this.checked; save(); syncTrainer(); toast(this.checked ? '속도 트레이너 켬' : '속도 트레이너 끔'); });
  const clampNum = (el, lo, hi, def) => { const v = Math.round(+el.value); const c = isNaN(v) ? def : Math.max(lo, Math.min(hi, v)); el.value = c; return c; };
  $('trStart').addEventListener('change', function () { state.trainer.start = clampNum(this, 40, 240, 60); if (state.trainer.max < state.trainer.start) { state.trainer.max = state.trainer.start; } save(); syncTrainer(); });
  $('trStep').addEventListener('change', function () { state.trainer.step = clampNum(this, 1, 60, 5); save(); });
  $('trMax').addEventListener('change', function () { state.trainer.max = clampNum(this, 40, 240, 120); if (state.trainer.max < state.trainer.start) { state.trainer.start = state.trainer.max; } save(); syncTrainer(); });
  syncTrainer();
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
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && k.toLowerCase() === 'c') { e.preventDefault(); copyMeasure(); return; }
    if (mod && k.toLowerCase() === 'v') { e.preventDefault(); pasteMeasure(); return; }
    if (mod || e.altKey) return;
    if (k === ' ') { e.preventDefault(); toggleCurrentPlayback(); return; }
    if (k === 'Escape') { if (ed.range) clearRange(); else setSel(null, false); return; }
    if (!ed.sel) { if (k.indexOf('Arrow') === 0) { e.preventDefault(); setSel({ m: 0, s: 0, i: 0 }, true); } return; }
    const sel = ed.sel;
    if (/^[0-9]$/.test(k)) { e.preventDefault(); inputDigit(k); }
    else if (MODS.indexOf(k.toLowerCase()) >= 0) { e.preventDefault(); inputMod(k.toLowerCase()); }
    else if (k === 'Backspace') { e.preventDefault(); del(false); }
    else if (k === 'Delete') { e.preventDefault(); del(true); }
    else if (k === 'Enter') { e.preventDefault(); editMark(sel.m, sel.i); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(e.shiftKey ? -beatOf(state) : -1, 0); }
    else if (k === 'ArrowRight') { e.preventDefault(); move(e.shiftKey ? beatOf(state) : 1, 0); }
    else if (k === 'Tab') { e.preventDefault(); move(e.shiftKey ? -beatOf(state) : beatOf(state), 0); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(0, -1); }
    else if (k === 'ArrowDown') { e.preventDefault(); move(0, 1); }
    else if (k === 'Home') { e.preventDefault(); move(-sel.i, 0); }
    else if (k === 'End') { e.preventDefault(); move(slotsOf(state) - 1 - sel.i, 0); }
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
      { k: '♯', label: '조옮김', desc: '모든 프렛에 ±n', action: transposeRange, disabled: !has },
      { k: 'PM', label: '팜뮤트 켜기/끄기', desc: '이 마디 전체', action: togglePmRange, disabled: !has },
      { k: '▭', label: '여러 마디 선택', desc: '마디 번호를 길게 눌러도 돼요', action: () => { setRange(ed.sel.m); }, disabled: !has },
      { k: '𝄇', label: '반복 기호…', desc: '||:  :||  1·2번 괄호', action: () => { openMenu('마디 ' + (ed.sel.m + 1) + ' 반복 기호', repeatMenuItems(ed.sel.m)); }, disabled: !has },
      { k: '×', label: '마디 삭제', desc: '뒤 마디를 당겨요', action: deleteMeasure, danger: true, disabled: !has },
      { k: '×', label: '마지막 줄 삭제', desc: '4마디를 지워요', action: delLine, danger: true }
    ]);
  });
  $('rangeBar').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'copy') copyMeasure();
    else if (act === 'paste') pasteMeasure();
    else if (act === 'delete') deleteRange();
    else if (act === 'transpose') transposeRange();
    else if (act === 'left') shiftRange(-1);
    else if (act === 'right') shiftRange(1);
    else if (act === 'pm') togglePmRange();
    else if (act === 'play') { if (pb.playing) stopPlay(); else if (state.viewMode !== 'score') startPlay(undefined, { range: true }); }
    else if (act === 'close') clearRange();
  });
  $('exportMenu').addEventListener('click', () => {
    openMenu('내보내기', [
      { key: 'musicxml-import', k: 'XML', label: 'MusicXML 불러오기', desc: '.musicxml, .xml, .mxl', action: () => { musicXmlImportController.open($('exportMenu')); } },
      { key: 'musicxml-export', k: 'XML', label: 'MusicXML 내보내기', desc: '전체 파트를 보존한 .musicxml', action: () => downloadMusicXml('xml') },
      { key: 'mxl-export', k: 'MXL', label: '압축 MusicXML 내보내기', desc: '전체 파트를 보존한 .mxl', action: () => downloadMusicXml('mxl') },
      { key: 'text-export', k: 'T', label: '텍스트 타브', desc: '복사해서 어디든 붙여 넣기', action: openExport },
      { key: 'image-export', k: '▣', label: '이미지로 저장', desc: 'PNG 미리보기와 다운로드', action: openImage },
      { key: 'midi-export', k: '♪', label: 'MIDI 파일 (.mid)', desc: '빠른 격자 기준. 반복 기호를 펼쳐요', action: downloadMidi },
      { key: 'text-file-export', k: '↧', label: '텍스트 파일 (.txt)', desc: '텍스트 타브를 파일로 저장', action: downloadText },
      { key: 'text-import', k: '↓', label: '텍스트 불러오기', desc: '내보낸 텍스트로 복원', action: () => { $('importText').value = ''; $('importModal').hidden = false; setTimeout(() => { $('importText').focus(); }, 40); } },
      { key: 'backup-export', k: '⇩', label: '백업 파일 (.json)', desc: '곡 전체를 파일 하나로', action: downloadBackup },
      { key: 'backup-import', k: '⇧', label: '백업 불러오기 (.json)', desc: '파일의 곡들을 목록에 추가', action: () => { $('backupFile').value = ''; $('backupFile').click(); } }
    ]);
  });
  $('settingsBtn').addEventListener('click', () => { $('settingsModal').hidden = false; });
  $('closeSettings').addEventListener('click', () => { $('settingsModal').hidden = true; });
  $('undo').addEventListener('click', doUndo);
  $('redo').addEventListener('click', doRedo);
  $('landscapeFit').addEventListener('change', function () { state.landscapeFit = this.checked; save(); applyZoom(); });
  $('clearAll').addEventListener('click', clearAll);
  $('chordBtn').addEventListener('click', () => { if (!needSel()) return; $('chordModal').hidden = false; });
  $('markBtn').addEventListener('click', () => { if (!needSel()) return; editMark(ed.sel.m, ed.sel.i); });
  $('chordHint').addEventListener('click', function () { if (!ed.sel) return; setMark(ed.sel.m, ed.sel.i, this.dataset.name); toast(this.dataset.name + ' 메모로 넣음'); });
  $('helpBtn').addEventListener('click', () => { $('helpModal').hidden = false; });
  $('closeModal').addEventListener('click', () => { $('modal').hidden = true; });
  $('closeImport').addEventListener('click', () => { $('importModal').hidden = true; });
  $('doImport').addEventListener('click', doImport);
  $('closeImg').addEventListener('click', () => { $('imgModal').hidden = true; });
  $('dlImg').addEventListener('click', downloadImage);
  $('backupFile').addEventListener('change', function () { restoreBackup(this.files && this.files[0]); });
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
  $('meter').addEventListener('change', function () { const sel = this; setMeter(sel.value).then((ok) => { if (!ok) sel.value = state.meter; }); });
  const syncAuto = () => { $('autoAdv').checked = state.autoAdv; $('autoAdv2').checked = state.autoAdv; };
  $('autoAdv').addEventListener('change', function () { state.autoAdv = this.checked; save(); syncAuto(); });
  $('autoAdv2').addEventListener('change', function () { state.autoAdv = this.checked; save(); syncAuto(); });
  $('haptic').addEventListener('change', function () { state.haptic = this.checked; save(); });
  $('instr').addEventListener('change', function () {
    state.instr = this.value; save();
    if (state.instr === 'sample') toast(samples.loadedCount() ? '샘플 악기 (' + samples.loadedCount() + '줄)' : '샘플이 없어요. 설정 → 샘플 악기에서 올리세요');
    else toast(INSTR[state.instr].name);
  });
  // 샘플 악기 설정
  const renderSampleRows = () => {
    const box = $('sampleRows'); box.innerHTML = '';
    const names = TUNINGS[state.tuning].names;
    for (let si = 0; si < 6; si++) {
      const row = document.createElement('div'); row.className = 'srow-s'; row.dataset.s = si;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = names[si];
      const st = document.createElement('span'); st.className = 'st' + (samples.slots[si] ? ' on' : '');
      st.textContent = samples.slots[si] ? samples.slots[si].name + ' · ' + samples.slots[si].buffer.duration.toFixed(1) + '초' : '없음';
      const lab = document.createElement('label'); lab.className = 'btn'; lab.textContent = '올리기';
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.dataset.s = si; inp.setAttribute('aria-label', names[si] + '줄 샘플 파일');
      lab.appendChild(inp);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn danger'; del.textContent = '지움'; del.dataset.del = si; del.hidden = !samples.slots[si];
      row.appendChild(n); row.appendChild(st); row.appendChild(lab); row.appendChild(del);
      box.appendChild(row);
    }
    const o = $('instr').querySelector('option[value="sample"]');
    if (o) o.textContent = '샘플 (내 소리' + (samples.loadedCount() ? ' ' + samples.loadedCount() + '줄' : '') + ')';
  };
  $('sampleRows').addEventListener('change', (e) => {
    const inp = e.target; if (inp.type !== 'file' || !inp.files || !inp.files[0]) return;
    const si = +inp.dataset.s, midi = TUNINGS[state.tuning].midi[si];
    samples.putSample(si, inp.files[0], midi, decodeSample).then(() => { renderSampleRows(); toast(TUNINGS[state.tuning].names[si] + '줄 샘플 저장'); }, () => { toast('오디오 파일을 읽지 못했어요'); });
  });
  $('sampleRows').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-del]'); if (!b) return;
    samples.removeSample(+b.dataset.del).then(renderSampleRows);
  });
  $('clearSamples').addEventListener('click', () => { samples.clearSamples().then(() => { renderSampleRows(); toast('샘플 모두 지움'); }); });
  $('settingsBtn').addEventListener('click', renderSampleRows);
  samples.loadAll(decodeSampleSilently).then(renderSampleRows);
  $('volume').addEventListener('input', function () { setVolume(this.value / 100); save(); });
  $('reverb').addEventListener('input', function () { setReverb(this.value / 100); save(); });
  $('countIn').addEventListener('change', function () { state.countIn = this.checked; save(); });
  $('drums').addEventListener('change', function () { state.drums = this.value; save(); });
  $('swing').addEventListener('input', function () { state.swing = this.value / 100; save(); });
  $('preview').addEventListener('change', function () { state.preview = this.checked; save(); });
  window.addEventListener('resize', () => {
    updatePadH();
    applyZoom();
    if (state.viewMode === 'score') scoreController?.scheduleScreenRender();
  });
  window.addEventListener('gtab:songchange', () => {
    applyViewMode(state.viewMode, false);
  });
  if (window.ResizeObserver) new ResizeObserver(updatePadH).observe($('pad'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && pb.playing) stopPlay(); });
  bindSongs();
  return { syncAuto, syncMetro };
}

/* ---------- 시작 ---------- */
function boot() {
  load();
  musicXmlImportController = createMusicXmlImportController({
    input: $('musicXmlFile'),
    dialog: $('musicXmlImportModal'),
    partsHost: $('musicXmlPartChoices'),
    status: $('musicXmlImportStatus'),
    confirm: $('confirmMusicXmlImport'),
    cancel: $('cancelMusicXmlImport'),
    commit: importMusicXmlSong,
    onImported: (song) => {
      refreshSongUI();
      applyViewMode('score');
      toast(`${song.title || '악보'} 불러옴`);
    },
    onError: (error) => { toast(error?.message || 'MusicXML을 불러오지 못했습니다'); }
  });
  scoreEditor = createScoreEditorBindings({
    inspector: $('scoreInspector'),
    getSong: currentSong,
    persistMusicXml: (xml) => {
      const persisted = persistCurrentScoreMusicXml(xml);
      syncQuickEditability();
      return persisted;
    },
    rerender: (measureIndices, selectedEventId, selectedNoteIndex) => {
      scoreController?.renderMeasures(measureIndices, selectedEventId, selectedNoteIndex);
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
  const mt = $('meter');
  Object.keys(METERS).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = k; mt.appendChild(o); });
  const g = $('chordGrid');
  CHORDS.forEach((ch) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chord'; b.dataset.name = ch[0]; b.dataset.fing = ch[1];
    b.title = ch[0] + ' (' + ch[1] + ')';
    const n = document.createElement('b'); n.textContent = ch[0];
    const d = document.createElement('span'); d.className = 'diagram'; d.innerHTML = chordDiagramSVG(ch[1]);
    b.appendChild(n); b.appendChild(d); g.appendChild(b);
  });
  const s = $('instr');
  Object.keys(INSTR).forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = INSTR[k].name; s.appendChild(o); });
  const so = document.createElement('option'); so.value = 'sample'; so.textContent = '샘플 (내 소리)'; s.appendChild(so);
  const { syncAuto, syncMetro } = bind();
  $('title').value = state.title; $('tuning').value = state.tuning; $('meter').value = state.meter; $('zoom').value = state.zoom; $('theme').value = state.theme;
  $('bpm').value = state.bpm; $('loop').value = state.loop; $('haptic').checked = state.haptic; s.value = state.instr;
  $('volume').value = Math.round(state.volume * 100); $('reverb').value = Math.round(state.reverb * 100);
  $('countIn').checked = state.countIn; $('preview').checked = state.preview;
  $('drums').value = state.drums; $('swing').value = Math.round(state.swing * 100); $('landscapeFit').checked = state.landscapeFit;
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

// PWA: 빌드된 앱에서만 서비스 워커 등록(개발 서버에서는 캐시가 방해된다)
if (import.meta.env && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
