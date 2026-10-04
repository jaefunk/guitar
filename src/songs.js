// 곡 목록 시트(새 곡 / 열기 / 이름 바꾸기 / 복제 / 삭제).
import { state, ed, library, listSongs, createSong, switchSong, renameSong, duplicateSong, deleteSong, songLabel } from './state.js';
import { $, openMenu, ask, toast } from './ui.js';
import { render, setSel } from './render.js';
import { stopPlay } from './audio.js';
import { buildFretboard } from './fretboard.js';

/** 곡이 바뀐 뒤 제목·BPM·튜닝 입력창과 악보를 현재 곡에 맞춘다. */
export function refreshSongUI() {
  stopPlay();
  $('title').value = state.title;
  $('bpm').value = state.bpm;
  $('tuning').value = state.tuning;
  $('meter').value = state.meter;
  render();
  setSel(ed.sel, false);
  if (state.padMode === 'fret') buildFretboard();
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
}

export function openSongs() { renderSongList(); $('songsModal').hidden = false; }

function songMenu(id) {
  const s = library.songs[id];
  if (!s) return;
  openMenu(songLabel(s), [
    { k: '→', label: '열기', action: () => { openSong(id); }, disabled: id === library.currentId },
    { k: 'A', label: '이름 바꾸기', action: () => { rename(id); } },
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
    renameSong(id, v.trim());
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
    const id = b.closest('.song').dataset.id;
    if (b.dataset.act === 'open') openSong(id); else songMenu(id);
  });
}
