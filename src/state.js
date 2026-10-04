// 상태와 저장/복원.
//
// 구조를 비유하면 "책장(library)"에 "책(song)"이 여러 권 꽂혀 있고, 그중 한 권을
// 책상(state) 위에 펼쳐 둔 모양이다. 편집 코드는 전부 책상 위의 state만 만지고,
// save()가 책상 위 내용을 책장에 꽂힌 그 책에 다시 써 넣는다. 곡을 바꾸면
// 책상 위의 책만 갈아 끼운다.
import {
  KEY, LEGACY_KEYS, TUNINGS, INSTR, ZOOMS, THEMES, LOOPS, DEFAULT_MEASURES, METERS, DEFAULT_METER
} from './constants.js';
import { emptyMeasure, validMeasures, padMeasures, cloneMeasures, resizeMeasures, slotsOf } from './tab.js';

export const SONG_FIELDS = ['title', 'tuning', 'bpm', 'meter', 'measures', 'marks', 'pm', 'rep'];
export const SETTING_FIELDS = [
  'zoom', 'theme', 'autoAdv', 'metro', 'loop', 'padMode', 'fretShift', 'haptic',
  'collapsed', 'seen', 'instr', 'volume', 'reverb', 'countIn', 'preview', 'trainer', 'drums', 'swing', 'landscapeFit'
];

export function defaultSettings() {
  return {
    zoom: 'm', theme: 'system', autoAdv: true, metro: false, loop: 'none', padMode: 'keys',
    fretShift: 0, haptic: true, collapsed: false, seen: false, instr: 'acoustic',
    volume: 0.8, reverb: 0.25, countIn: false, preview: true,
    // 속도 트레이너: 반복 한 바퀴마다 step만큼 빨라져 max까지
    trainer: { on: false, start: 60, step: 5, max: 120 },
    landscapeFit: true, // 가로 모드에서 한 줄(4마디)을 화면 폭에 맞춤
    drums: 'off',   // off | rock | pop | ballad
    swing: 0        // 0~0.7: 홀수 16분음표를 한 칸의 이 비율만큼 늦춘다 (0.67 ≈ 셋잇단 스윙)
  };
}

export function newId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function defaultSong(now, meter) {
  meter = METERS[meter] ? meter : DEFAULT_METER;
  const ms = [];
  for (let k = 0; k < DEFAULT_MEASURES; k++) ms.push(emptyMeasure(METERS[meter].slots));
  const t = now || Date.now();
  return { id: newId(), title: '', tuning: 'standard', bpm: 90, meter, measures: ms, marks: {}, pm: {}, rep: {}, createdAt: t, updatedAt: t };
}

/** 책상 위 상태: 현재 곡의 필드 + 설정이 평평하게 합쳐져 있다. 편집 코드는 이것만 본다. */
export const state = Object.assign({}, defaultSettings(), {
  title: '', tuning: 'standard', bpm: 90, meter: DEFAULT_METER, measures: [], marks: {}, pm: {}, rep: {}
});

/** 편집 세션 상태(저장 안 함) */
export const ed = { sel: null, pending: false, undoStack: [], redoStack: [], clip: null, range: null };

/** 책장: 저장되는 전체 문서 */
export const library = { songs: {}, order: [], currentId: null };

/* ---------- 검증 ---------- */
export function sanitizeSong(d, now) {
  const s = defaultSong(now, d && d.meter);
  if (!d || typeof d !== 'object') return s;
  if (typeof d.id === 'string' && d.id) s.id = d.id;
  if (typeof d.title === 'string') s.title = d.title;
  if (TUNINGS[d.tuning]) s.tuning = d.tuning;
  if (typeof d.bpm === 'number' && d.bpm >= 40 && d.bpm <= 240) s.bpm = d.bpm;
  if (validMeasures(d.measures)) {
    const slots = slotsOf(s);
    // 칸 수가 박자표와 어긋나면(손상 등) 박자표에 맞춰 자르거나 채운다
    s.measures = padMeasures(resizeMeasures(d.measures, slots), slots);
  }
  if (d.marks && typeof d.marks === 'object') {
    Object.keys(d.marks).forEach((k) => {
      if (/^\d+:\d+$/.test(k) && typeof d.marks[k] === 'string' && d.marks[k]) s.marks[k] = d.marks[k];
    });
  }
  if (d.pm && typeof d.pm === 'object') {
    Object.keys(d.pm).forEach((k) => { if (/^\d+:\d+$/.test(k) && d.pm[k]) s.pm[k] = 1; });
  }
  if (d.rep && typeof d.rep === 'object') {
    Object.keys(d.rep).forEach((k) => {
      const r = d.rep[k];
      if (!/^\d+$/.test(k) || !r || typeof r !== 'object' || +k >= s.measures.length) return;
      const o = {};
      if (r.s) o.s = 1;
      if (typeof r.e === 'number' && r.e >= 2 && r.e <= 99) o.e = Math.round(r.e);
      if (typeof r.v === 'number' && r.v >= 1 && r.v <= 9) o.v = Math.round(r.v);
      if (o.s || o.e || o.v) s.rep[k] = o;
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
  ['autoAdv', 'metro', 'haptic', 'collapsed', 'seen', 'countIn', 'preview', 'landscapeFit'].forEach((k) => {
    if (typeof d[k] === 'boolean') s[k] = d[k];
  });
  if (LOOPS.indexOf(d.loop) >= 0) s.loop = d.loop;
  if (d.padMode === 'fret' || d.padMode === 'keys') s.padMode = d.padMode;
  if (d.fretShift === 12) s.fretShift = 12;
  if (d.instr && (INSTR[d.instr] || d.instr === 'sample')) s.instr = d.instr;
  if (typeof d.volume === 'number' && d.volume >= 0 && d.volume <= 1) s.volume = d.volume;
  if (typeof d.reverb === 'number' && d.reverb >= 0 && d.reverb <= 1) s.reverb = d.reverb;
  if (['off', 'rock', 'pop', 'ballad'].indexOf(d.drums) >= 0) s.drums = d.drums;
  if (typeof d.swing === 'number' && d.swing >= 0 && d.swing <= 0.7) s.swing = d.swing;
  if (d.trainer && typeof d.trainer === 'object') {
    const t = d.trainer, o = s.trainer;
    if (typeof t.on === 'boolean') o.on = t.on;
    if (typeof t.start === 'number' && t.start >= 40 && t.start <= 240) o.start = Math.round(t.start);
    if (typeof t.step === 'number' && t.step >= 1 && t.step <= 60) o.step = Math.round(t.step);
    if (typeof t.max === 'number' && t.max >= 40 && t.max <= 240) o.max = Math.round(t.max);
  }
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

/** 저장소에서 읽어 문서를 만든다(순수: storage를 주입). */
export function readDoc(storage, now) {
  let raw = null;
  let legacy = false;
  try {
    raw = storage.getItem(KEY);
    if (!raw) {
      for (let i = 0; i < LEGACY_KEYS.length && !raw; i++) raw = storage.getItem(LEGACY_KEYS[i]);
      legacy = !!raw;
    }
  } catch (e) { /* 저장소 접근 불가 */ }
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d && typeof d === 'object') return legacy ? migrateLegacy(d, now) : sanitizeDoc(d, now);
    } catch (e) { /* 깨진 JSON은 새로 시작 */ }
  }
  return sanitizeDoc(null, now);
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
  padMeasures(state.measures, slotsOf(state));
  ed.undoStack = []; ed.redoStack = []; ed.range = null;
  ed.pending = false;
  ed.sel = { m: 0, s: 0, i: 0 };
}

export function currentSong() { return library.songs[library.currentId]; }

let dirty = false;
/** measures/marks를 제자리에서 바꾼 뒤 호출하면 다음 save 때 updatedAt이 갱신된다. */
export function touch() { dirty = true; }

/** 책상 위 내용을 현재 곡 객체에 반영한다. */
export function flush() {
  const song = currentSong();
  if (!song) return;
  let changed = dirty;
  SONG_FIELDS.forEach((k) => { if (song[k] !== state[k]) { song[k] = state[k]; changed = true; } });
  if (changed) song.updatedAt = Date.now();
  dirty = false;
}

export function toDoc() {
  const settings = {};
  SETTING_FIELDS.forEach((k) => { settings[k] = state[k]; });
  return { v: 3, songs: library.songs, order: library.order, currentId: library.currentId, settings };
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
}

/** 변경이 있을 때마다 호출. 비싸지 않다(JSON 직렬화 한 번). */
export function save() {
  flush();
  const st = getStorage();
  if (!st) return;
  try { st.setItem(KEY, JSON.stringify(toDoc())); } catch (e) { /* 용량 초과 등 */ }
}

/* ---------- 곡 관리(데이터만; UI 갱신은 songs.js) ---------- */
export function listSongs() {
  return library.order.map((id) => library.songs[id]);
}

export function createSong(title) {
  flush();
  const s = defaultSong();
  if (title) s.title = title;
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
  if (!s) return;
  s.title = title;
  if (id === library.currentId) state.title = title;
  s.updatedAt = Date.now();
  save();
}

export function duplicateSong(id) {
  const src = library.songs[id];
  if (!src) return null;
  flush();
  const copy = sanitizeSong(Object.assign({}, src, { id: undefined, createdAt: undefined, updatedAt: undefined }));
  copy.title = (src.title || '제목 없음') + ' 사본';
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
    const s = defaultSong();
    library.songs[s.id] = s;
    library.order.push(s.id);
  }
  if (wasCurrent) activate(library.order[Math.min(idx, library.order.length - 1)]);
  save();
  return wasCurrent;
}

export function songLabel(s) { return s.title || '제목 없음'; }
