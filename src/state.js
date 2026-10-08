// 상태와 저장/복원.
//
// 구조를 비유하면 "책장(library)"에 "책(song)"이 여러 권 꽂혀 있고, 그중 한 권을
// 책상(state) 위에 펼쳐 둔 모양이다. 편집 코드는 전부 책상 위의 state만 만지고,
// save()가 책상 위 내용을 책장에 꽂힌 그 책에 다시 써 넣는다. 곡을 바꾸면
// 책상 위의 책만 갈아 끼운다.
import {
  KEY, LEGACY_KEYS, TUNINGS, INSTR, ZOOMS, THEMES, LOOPS, DEFAULT_MEASURES
} from './constants.js';
import { emptyMeasure, validMeasures, padMeasures, cloneMeasures } from './tab.js';
import { isLosslessV3GridMusicXml, musicXmlToV3Song, v3SongToMusicXml } from './v3-musicxml.js';
import { parseMusicXml, serializeMusicXml } from './musicxml.js';

export const KEY_V4 = 'gtab-editor-v4';

export const SONG_FIELDS = ['title', 'tuning', 'bpm', 'measures', 'marks'];
export const SETTING_FIELDS = [
  'zoom', 'theme', 'autoAdv', 'metro', 'loop', 'padMode', 'fretShift', 'haptic',
  'collapsed', 'seen', 'instr', 'volume', 'reverb', 'countIn', 'preview', 'viewMode'
];

export function defaultSettings() {
  return {
    zoom: 'm', theme: 'system', autoAdv: true, metro: false, loop: 'none', padMode: 'keys',
    fretShift: 0, haptic: true, collapsed: false, seen: false, instr: 'acoustic',
    volume: 0.8, reverb: 0.25, countIn: false, preview: true, viewMode: 'grid'
  };
}

export function newId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultSong(now) {
  const ms = [];
  for (let k = 0; k < DEFAULT_MEASURES; k++) ms.push(emptyMeasure());
  const t = now || Date.now();
  return { id: newId(), title: '', tuning: 'standard', bpm: 90, measures: ms, marks: {}, createdAt: t, updatedAt: t };
}

function attachLegacyProjection(song, legacy) {
  const projection = {
    tuning: legacy.tuning,
    bpm: legacy.bpm,
    measures: legacy.measures,
    marks: legacy.marks
  };
  Object.defineProperty(song, '_legacy', { value: projection, writable: true, configurable: true });
  if (song.editorMode === 'musicxml-readonly') {
    Object.defineProperty(song, '_readonlySnapshot', {
      value: {
        title: song.title,
        tuning: legacy.tuning,
        bpm: legacy.bpm,
        measures: cloneMeasures(legacy.measures),
        marks: { ...legacy.marks },
        updatedAt: song.updatedAt
      },
      writable: true,
      configurable: true
    });
  }
  for (const field of ['tuning', 'bpm', 'measures', 'marks']) {
    Object.defineProperty(song, field, {
      configurable: true,
      get() { return this._legacy[field]; },
      set(value) { this._legacy[field] = value; }
    });
  }
  return song;
}

function v4SongFromLegacy(legacySong, now) {
  const legacy = sanitizeSong(legacySong, now);
  const song = {
    id: legacy.id,
    title: legacy.title,
    musicxml: v3SongToMusicXml(legacy),
    selectedPartId: 'P1',
    editorMode: 'grid-v3',
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt
  };
  return attachLegacyProjection(song, legacy);
}

function defaultV4Song(now) {
  return v4SongFromLegacy(defaultSong(now), now);
}

function refreshSongMusicXml(song) {
  const generatedXml = v3SongToMusicXml({
    id: song.id,
    title: song.title,
    tuning: song.tuning,
    bpm: song.bpm,
    measures: song.measures,
    marks: song.marks,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt
  });
  try {
    const currentDoc = parseMusicXml(song.musicxml);
    const generatedDoc = parseMusicXml(generatedXml);
    const selectedPart = [...currentDoc.documentElement.children]
      .find((element) => element.localName === 'part' && element.getAttribute('id') === song.selectedPartId);
    const generatedPart = [...generatedDoc.documentElement.children]
      .find((element) => element.localName === 'part' && element.getAttribute('id') === 'P1');
    if (!selectedPart || !generatedPart) throw new Error('Selected MusicXML part is missing');
    selectedPart.replaceChildren(...[...generatedPart.children].map((element) => currentDoc.importNode(element, true)));
    setDocumentTitle(currentDoc, song.title);
    song.musicxml = serializeMusicXml(currentDoc);
  } catch (error) {
    song.musicxml = generatedXml;
    song.selectedPartId = 'P1';
  }
}

function setDocumentTitle(doc, title) {
  const root = doc.documentElement;
  let work = [...root.children].find((element) => element.localName === 'work');
  if (!work) {
    work = doc.createElementNS(root.namespaceURI, 'work');
    root.insertBefore(work, root.firstElementChild);
  }
  let workTitle = [...work.children].find((element) => element.localName === 'work-title');
  if (!workTitle) {
    workTitle = doc.createElementNS(root.namespaceURI, 'work-title');
    work.appendChild(workTitle);
  }
  workTitle.textContent = title;
}

function musicXmlWithTitle(xml, title) {
  const doc = parseMusicXml(xml);
  setDocumentTitle(doc, title);
  return serializeMusicXml(doc);
}

/** 책상 위 상태: 현재 곡의 필드 + 설정이 평평하게 합쳐져 있다. 편집 코드는 이것만 본다. */
export const state = Object.assign({}, defaultSettings(), {
  title: '', tuning: 'standard', bpm: 90, measures: [], marks: {}, readOnly: false
});

/** 편집 세션 상태(저장 안 함) */
export const ed = { sel: null, pending: false, undoStack: [], clip: null };

/** 책장: 저장되는 전체 문서 */
export const library = { songs: {}, order: [], currentId: null };

/* ---------- 검증 ---------- */
export function sanitizeSong(d, now) {
  const s = defaultSong(now);
  if (!d || typeof d !== 'object') return s;
  if (typeof d.id === 'string' && d.id) s.id = d.id;
  if (typeof d.title === 'string') s.title = d.title;
  if (TUNINGS[d.tuning]) s.tuning = d.tuning;
  if (typeof d.bpm === 'number' && d.bpm >= 40 && d.bpm <= 240) s.bpm = d.bpm;
  if (validMeasures(d.measures)) s.measures = padMeasures(cloneMeasures(d.measures));
  if (d.marks && typeof d.marks === 'object') {
    Object.keys(d.marks).forEach((k) => {
      if (/^\d+:\d+$/.test(k) && typeof d.marks[k] === 'string' && d.marks[k]) s.marks[k] = d.marks[k];
    });
  }
  if (typeof d.createdAt === 'number') s.createdAt = d.createdAt;
  if (typeof d.updatedAt === 'number') s.updatedAt = d.updatedAt;
  return s;
}

export function sanitizeSettings(d) {
  const s = defaultSettings();
  if (!d || typeof d !== 'object') return s;
  if (ZOOMS.indexOf(d.zoom) >= 0) s.zoom = d.zoom;
  if (THEMES.indexOf(d.theme) >= 0) s.theme = d.theme;
  ['autoAdv', 'metro', 'haptic', 'collapsed', 'seen', 'countIn', 'preview'].forEach((k) => {
    if (typeof d[k] === 'boolean') s[k] = d[k];
  });
  if (LOOPS.indexOf(d.loop) >= 0) s.loop = d.loop;
  if (d.padMode === 'fret' || d.padMode === 'keys') s.padMode = d.padMode;
  if (d.fretShift === 12) s.fretShift = 12;
  if (d.instr && INSTR[d.instr]) s.instr = d.instr;
  if (typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1) s.volume = d.volume;
  if (typeof d.reverb === 'number' && d.reverb >= 0 && d.reverb <= 1) s.reverb = d.reverb;
  if (d.viewMode === 'score' || d.viewMode === 'grid') s.viewMode = d.viewMode;
  return s;
}

/** v1/v2(곡 하나가 통째로 한 객체) → v3 문서. 기존 데이터가 첫 곡이 된다. */
export function migrateLegacy(d, now) {
  const song = sanitizeSong(d, now);
  return { v: 3, songs: { [song.id]: song }, order: [song.id], currentId: song.id, settings: sanitizeSettings(d) };
}

/** v3 문서 검증. 곡이 하나도 없으면 빈 곡을 하나 만든다. */
export function sanitizeDoc(d, now) {
  const doc = { v: 3, songs: {}, order: [], currentId: null, settings: sanitizeSettings(d && d.settings) };
  if (d && d.songs && typeof d.songs === 'object') {
    const ids = Array.isArray(d.order) ? d.order.filter((id) => typeof id === 'string' && d.songs[id]) : [];
    Object.keys(d.songs).forEach((id) => { if (ids.indexOf(id) < 0) ids.push(id); });
    ids.forEach((id) => {
      const s = sanitizeSong(Object.assign({}, d.songs[id], { id }), now);
      doc.songs[id] = s;
      doc.order.push(id);
    });
  }
  if (!doc.order.length) {
    const s = defaultSong(now);
    doc.songs[s.id] = s;
    doc.order.push(s.id);
  }
  doc.currentId = (d && typeof d.currentId === 'string' && doc.songs[d.currentId]) ? d.currentId : doc.order[0];
  return doc;
}

function sanitizeV4Song(value, id, now) {
  if (!value || typeof value !== 'object' || typeof value.musicxml !== 'string') return null;
  const selectedPartId = typeof value.selectedPartId === 'string' && value.selectedPartId ? value.selectedPartId : 'P1';
  let projection;
  try {
    projection = musicXmlToV3Song(value.musicxml, selectedPartId);
  } catch (error) {
    return null;
  }
  const timestamp = now ?? Date.now();
  const editorMode = value.editorMode === 'grid-v3'
    ? 'grid-v3'
    : value.editorMode === 'musicxml-readonly'
      ? 'musicxml-readonly'
      : isLosslessV3GridMusicXml(value.musicxml, selectedPartId)
        ? 'grid-v3'
        : 'musicxml-readonly';
  const song = {
    id,
    title: projection.title || (typeof value.title === 'string' ? value.title : ''),
    musicxml: value.musicxml,
    selectedPartId,
    editorMode,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : timestamp,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : timestamp
  };
  projection.title = song.title;
  return attachLegacyProjection(song, sanitizeSong({ ...projection, id, createdAt: song.createdAt, updatedAt: song.updatedAt }, now));
}

export function sanitizeV4Doc(value, now, ensureSong = true) {
  const doc = { v: 4, songs: {}, order: [], currentId: null, settings: sanitizeSettings(value?.settings) };
  if (value?.songs && typeof value.songs === 'object') {
    const orderedIds = Array.isArray(value.order)
      ? value.order.filter((id) => typeof id === 'string' && value.songs[id])
      : [];
    Object.keys(value.songs).forEach((id) => { if (!orderedIds.includes(id)) orderedIds.push(id); });
    for (const id of orderedIds) {
      const song = sanitizeV4Song(value.songs[id], id, now);
      if (!song) continue;
      doc.songs[id] = song;
      doc.order.push(id);
    }
  }
  if (ensureSong && !doc.order.length) {
    const song = defaultV4Song(now);
    doc.songs[song.id] = song;
    doc.order.push(song.id);
  }
  doc.currentId = typeof value?.currentId === 'string' && doc.songs[value.currentId]
    ? value.currentId
    : doc.order[0];
  return doc;
}

export function migrateV3Doc(value, now) {
  const source = sanitizeDoc(value, now);
  const songs = {};
  for (const id of source.order) songs[id] = v4SongFromLegacy(source.songs[id], now);
  return {
    v: 4,
    songs,
    order: source.order.slice(),
    currentId: source.currentId,
    settings: source.settings
  };
}

/** 저장소에서 읽어 문서를 만든다(순수: storage를 주입). */
export function readDoc(storage, now) {
  let rawV4 = null;
  try {
    rawV4 = storage.getItem(KEY_V4);
  } catch (e) { /* 저장소 접근 불가 */ }
  if (rawV4) {
    try {
      const value = JSON.parse(rawV4);
      if (value && value.v === 4 && typeof value === 'object') {
        const v4 = sanitizeV4Doc(value, now, false);
        if (v4.order.length) return v4;
      }
    } catch (e) { /* 손상된 v4는 보존된 v3/legacy에서 복구 */ }
  }

  let raw = null;
  let singleSongLegacy = false;
  try {
    raw = storage.getItem(KEY);
    if (!raw) {
      for (let i = 0; i < LEGACY_KEYS.length && !raw; i++) raw = storage.getItem(LEGACY_KEYS[i]);
      singleSongLegacy = !!raw;
    }
  } catch (e) { /* 저장소 접근 불가 */ }
  if (raw) {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === 'object') {
        const v3 = singleSongLegacy ? migrateLegacy(value, now) : sanitizeDoc(value, now);
        return migrateV3Doc(v3, now);
      }
    } catch (e) { /* 깨진 JSON은 새로 시작 */ }
  }
  return sanitizeV4Doc(null, now);
}

/* ---------- 책장 ↔ 책상 ---------- */
function applyDoc(doc) {
  library.songs = doc.songs;
  library.order = doc.order;
  library.currentId = doc.currentId;
  Object.assign(state, doc.settings);
  activate(doc.currentId);
}

/** 곡 id를 책상 위로 올린다(저장/렌더는 호출자 몫). */
export function activate(id) {
  const song = library.songs[id];
  library.currentId = id;
  SONG_FIELDS.forEach((k) => { state[k] = song[k]; });
  state.readOnly = song.editorMode !== 'grid-v3';
  padMeasures(state.measures);
  ed.undoStack = [];
  ed.pending = false;
  ed.sel = { m: 0, s: 0, i: 0 };
}

export function currentSong() { return library.songs[library.currentId]; }

export function canEditCurrentSong() {
  return currentSong()?.editorMode === 'grid-v3';
}

let dirty = false;
/** measures/marks를 제자리에서 바꾼 뒤 호출하면 다음 save 때 updatedAt이 갱신된다. */
export function touch() { dirty = true; }

/** 책상 위 내용을 현재 곡 객체에 반영한다. */
export function flush() {
  const song = currentSong();
  if (!song) return;
  const changedFields = SONG_FIELDS.filter((field) => song[field] !== state[field]);
  const changed = dirty || changedFields.length > 0;
  if (changed && !canEditCurrentSong()) {
    const restored = song._readonlySnapshot;
    song.title = restored.title;
    song._legacy = {
      tuning: restored.tuning,
      bpm: restored.bpm,
      measures: cloneMeasures(restored.measures),
      marks: { ...restored.marks }
    };
    song.updatedAt = restored.updatedAt;
    SONG_FIELDS.forEach((field) => { state[field] = song[field]; });
    state.readOnly = true;
    dirty = false;
    return;
  }
  changedFields.forEach((field) => { song[field] = state[field]; });
  if (changed) {
    refreshSongMusicXml(song);
    song.updatedAt = Date.now();
  }
  dirty = false;
}

export function toDoc() {
  const settings = {};
  SETTING_FIELDS.forEach((k) => { settings[k] = state[k]; });
  const songs = {};
  library.order.forEach((id) => {
    const song = library.songs[id];
    songs[id] = {
      id: song.id,
      title: song.title,
      musicxml: song.musicxml,
      selectedPartId: song.selectedPartId,
      editorMode: song.editorMode,
      createdAt: song.createdAt,
      updatedAt: song.updatedAt
    };
  });
  return { v: 4, songs, order: library.order.slice(), currentId: library.currentId, settings };
}

let storage = null;
/** 테스트용: localStorage 대신 쓸 저장소(getItem/setItem) 주입 */
export function useStorage(s) { storage = s; }
function getStorage() {
  if (storage) return storage;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  return storage;
}

export function load() {
  const st = getStorage();
  applyDoc(readDoc(st || { getItem() { return null; } }));
  if (st) {
    try { st.setItem(KEY_V4, JSON.stringify(toDoc())); } catch (e) { /* 용량 초과 등 */ }
  }
}

/** 변경이 있을 때마다 호출. 비싸지 않다(JSON 직렬화 한 번). */
export function save() {
  flush();
  const st = getStorage();
  if (!st) return;
  try { st.setItem(KEY_V4, JSON.stringify(toDoc())); } catch (e) { /* 용량 초과 등 */ }
}

/* ---------- 곡 관리(데이터만; UI 갱신은 songs.js) ---------- */
export function listSongs() {
  return library.order.map((id) => library.songs[id]);
}

export function createSong(title) {
  flush();
  const s = defaultV4Song();
  if (title) s.title = title;
  if (title) {
    refreshSongMusicXml(s);
  }
  library.songs[s.id] = s;
  library.order.push(s.id);
  activate(s.id);
  save();
  return s;
}

export function switchSong(id) {
  if (!library.songs[id] || id === library.currentId) return false;
  flush();
  activate(id);
  save();
  return true;
}

export function renameSong(id, title) {
  const s = library.songs[id];
  if (!s || s.editorMode !== 'grid-v3') return false;
  s.title = title;
  if (id === library.currentId) state.title = title;
  s.updatedAt = Date.now();
  s.musicxml = musicXmlWithTitle(s.musicxml, title);
  save();
  return true;
}

/** 전문 악보 편집 결과를 v3 격자 투영과 분리해 현재 v4 곡에 저장한다. */
export function persistCurrentScoreMusicXml(xml) {
  const song = currentSong();
  if (!song) throw new Error('현재 곡이 없습니다');
  const doc = parseMusicXml(xml);
  const selectedPart = [...doc.documentElement.children]
    .find((node) => node.localName === 'part' && node.getAttribute('id') === song.selectedPartId);
  if (!selectedPart) throw new Error(`Selected MusicXML part is missing: ${song.selectedPartId}`);
  song.musicxml = serializeMusicXml(doc);
  song.updatedAt = Date.now();
  const st = getStorage();
  if (st) {
    try { st.setItem(KEY_V4, JSON.stringify(toDoc())); } catch (error) { /* 저장 실패 시 메모리 편집은 유지 */ }
  }
  return song.musicxml;
}

export function duplicateSong(id) {
  const src = library.songs[id];
  if (!src) return null;
  flush();
  const timestamp = Date.now();
  const copyLegacy = sanitizeSong({
    title: (src.title || '제목 없음') + ' 사본',
    tuning: src.tuning,
    bpm: src.bpm,
    measures: cloneMeasures(src.measures),
    marks: { ...src.marks },
    createdAt: timestamp,
    updatedAt: timestamp
  }, timestamp);
  const copy = attachLegacyProjection({
    id: copyLegacy.id,
    title: copyLegacy.title,
    musicxml: musicXmlWithTitle(src.musicxml, copyLegacy.title),
    selectedPartId: src.selectedPartId,
    editorMode: src.editorMode,
    createdAt: timestamp,
    updatedAt: timestamp
  }, copyLegacy);
  library.songs[copy.id] = copy;
  library.order.splice(library.order.indexOf(id) + 1, 0, copy.id);
  save();
  return copy;
}

/** 삭제 후 현재 곡이 바뀌었으면 true. 마지막 곡을 지우면 빈 곡을 새로 만든다. */
export function deleteSong(id) {
  if (!library.songs[id]) return false;
  const idx = library.order.indexOf(id);
  const wasCurrent = id === library.currentId;
  delete library.songs[id];
  library.order.splice(idx, 1);
  if (!library.order.length) {
    const s = defaultV4Song();
    library.songs[s.id] = s;
    library.order.push(s.id);
  }
  if (wasCurrent) activate(library.order[Math.min(idx, library.order.length - 1)]);
  save();
  return wasCurrent;
}

export function songLabel(s) { return s.title || '제목 없음'; }
