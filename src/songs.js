// 곡 목록 시트(새 곡 / 열기 / 이름 바꾸기 / 복제 / 삭제).
import { state, ed, library, listSongs, createSong, switchSong, renameSong, duplicateSong, deleteSong, songLabel, importMusicXmlSong, selectBuiltInSong } from './state.js';
import { $, openMenu, ask, toast } from './ui.js';
import { render, setSel } from './render.js';
import { stopPlay } from './audio.js';
import { buildFretboard } from './fretboard.js';
import { syncQuickEditability } from './quick-edit.js';

/** 곡이 바뀐 뒤 제목·BPM·튜닝 입력창과 악보를 현재 곡에 맞춘다. */
export function refreshSongUI() {
  stopPlay();
  $('title').value = state.title;
  $('bpm').value = state.bpm;
  $('tuning').value = state.tuning;
  render();
  setSel(ed.sel, false);
  if (state.padMode === 'fret') buildFretboard();
  syncQuickEditability();
  window.dispatchEvent(new CustomEvent('gtab:songchange'));
}

function fmtDate(t) {
  const d = new Date(t), now = new Date();
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (same) return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  return (d.getMonth() + 1) + '/' + d.getDate();
}

export function renderSongList() {
  const list = $('songList');
  list.innerHTML = '';
  listSongs().forEach((s) => {
    const row = document.createElement('div');
    row.className = 'song' + (s.id === library.currentId ? ' cur' : '');
    row.dataset.id = s.id;
    const main = document.createElement('button');
    main.type = 'button'; main.className = 'song-main'; main.dataset.act = 'open';
    const l = document.createElement('div'); l.className = 'l'; l.textContent = songLabel(s);
    const d = document.createElement('div'); d.className = 'd';
    d.textContent = s.measures.length + '마디 · BPM ' + s.bpm + ' · ' + fmtDate(s.updatedAt) + (s.id === library.currentId ? ' · 열려 있음' : '');
    main.appendChild(l); main.appendChild(d);
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'song-more'; more.dataset.act = 'more'; more.textContent = '⋯';
    more.setAttribute('aria-label', songLabel(s) + ' 메뉴');
    row.appendChild(main); row.appendChild(more);
    list.appendChild(row);
  });
  const builtIn = document.createElement('div');
  builtIn.className = 'song built-in-song';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'song-main';
  open.dataset.act = 'built-in-nell';
  const label = document.createElement('div');
  label.className = 'l';
  label.textContent = '1:03 — Gt.1 전문 TAB 열기';
  const description = document.createElement('div');
  description.className = 'd';
  description.textContent = '처음 추가, 이후 기존 곡 열기 · 77마디 · BPM 84';
  open.append(label, description);
  builtIn.appendChild(open);
  list.appendChild(builtIn);
}

const BUILT_IN_NELL_GT1_ID = 'nell-1-03-gt1';
let builtInNellGt1Promise = null;

/** 사용자가 명시적으로 선택했을 때만 내장 Gt.1 MusicXML을 읽어 추가하거나 기존 곡을 연다. */
export function loadBuiltInNellGt1({
  fetchImpl = fetch,
  importSong = importMusicXmlSong,
  selectExisting = selectBuiltInSong
} = {}) {
  if (builtInNellGt1Promise) return builtInNellGt1Promise;
  const loading = (async () => {
    const existing = selectExisting(BUILT_IN_NELL_GT1_ID);
    if (existing) return existing;
    const response = await fetchImpl(new URL('../songs/nell-1-03-gt1.musicxml', import.meta.url));
    if (!response?.ok) throw new Error('내장 1:03 악보를 읽지 못했습니다');
    const xml = await response.text();
    return importSong({
      xml,
      builtInId: BUILT_IN_NELL_GT1_ID,
      selectedPartId: 'P1',
      title: '1:03',
      editorMode: 'musicxml-score'
    });
  })();
  const shared = loading.finally(() => {
    if (builtInNellGt1Promise === shared) builtInNellGt1Promise = null;
  });
  builtInNellGt1Promise = shared;
  return shared;
}

export async function openBuiltInNellGt1(button, {
  loadScore = loadBuiltInNellGt1,
  refreshUi = refreshSongUI,
  close = () => { $('songsModal').hidden = true; },
  notify = toast
} = {}) {
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    const song = await loadScore();
    refreshUi();
    close();
    notify(`"${songLabel(song)}" 열림`);
    return song;
  } catch (error) {
    notify(error?.message || '내장 악보를 불러오지 못했습니다');
    return null;
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }
}

export function openSongs() { renderSongList(); $('songsModal').hidden = false; }

function songMenu(id) {
  const s = library.songs[id];
  if (!s) return;
  openMenu(songLabel(s), [
    { k: '→', label: '열기', action: () => { openSong(id); }, disabled: id === library.currentId },
    { k: 'A', label: '이름 바꾸기', action: () => { rename(id); }, disabled: s.editorMode !== 'grid-v3' },
    { k: '⎘', label: '복제', desc: '같은 내용으로 새 곡을 만들어요', action: () => { const c = duplicateSong(id); toast('"' + songLabel(c) + '" 만듦'); openSongs(); } },
    { k: '×', label: '삭제', desc: '되돌릴 수 없어요', danger: true, action: () => { remove(id); } }
  ]);
}

function openSong(id) {
  if (switchSong(id)) { refreshSongUI(); toast('"' + songLabel(library.songs[id]) + '" 열림'); }
  $('songsModal').hidden = true;
}
function rename(id) {
  const s = library.songs[id];
  ask({ title: '이름 바꾸기', input: true, value: s.title, placeholder: '곡 제목', ok: '저장' }).then((v) => {
    if (v === null) return;
    if (!renameSong(id, v.trim())) { toast('읽기 전용 MusicXML입니다'); return; }
    if (id === library.currentId) $('title').value = state.title;
    openSongs();
  });
}
function remove(id) {
  const s = library.songs[id];
  ask({ title: '곡 삭제', msg: '"' + songLabel(s) + '"을(를) 삭제할까요? 되돌릴 수 없어요.', ok: '삭제' }).then((ok) => {
    if (!ok) return;
    const changed = deleteSong(id);
    if (changed) refreshSongUI();
    toast('삭제됨');
    openSongs();
  });
}
export function newSong() {
  ask({ title: '새 곡', input: true, value: '', placeholder: '곡 제목 (나중에 바꿀 수 있어요)', ok: '만들기' }).then((v) => {
    if (v === null) return;
    createSong(v.trim());
    refreshSongUI();
    $('songsModal').hidden = true;
    toast('새 곡을 만들었어요');
  });
}

export function bindSongs() {
  $('songsBtn').addEventListener('click', openSongs);
  $('closeSongs').addEventListener('click', () => { $('songsModal').hidden = true; });
  $('newSong').addEventListener('click', newSong);
  $('songList').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'built-in-nell') { openBuiltInNellGt1(b); return; }
    const id = b.closest('.song').dataset.id;
    if (b.dataset.act === 'open') openSong(id); else songMenu(id);
  });
}
