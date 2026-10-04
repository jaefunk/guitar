import { describe, it, expect, beforeEach } from 'vitest';
import {
  readDoc, migrateLegacy, sanitizeDoc, useStorage, load, save, state, ed, library,
  listSongs, createSong, switchSong, renameSong, duplicateSong, deleteSong, currentSong, touch
} from '../src/state.js';
import { emptyMeasure } from '../src/tab.js';
import { KEY } from '../src/constants.js';

function memStorage(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem(k, v) { m[k] = String(v); },
    dump() { return m; }
  };
}
function v2Blob() {
  const ms = [];
  for (let k = 0; k < 8; k++) ms.push(emptyMeasure());
  ms[0][0][0] = '3'; ms[7][5][15] = '12h';
  return {
    title: '옛 곡', tuning: 'dropd', measures: ms, marks: { '0:0': 'G', 'bad': 'x', '1:4': '' },
    zoom: 'l', theme: 'dark', autoAdv: false, bpm: 132, metro: true, loop: 'measure', padMode: 'fret', fretShift: 12,
    haptic: false, collapsed: true, seen: true, instr: 'nylon', volume: 0.5, reverb: 0.1, countIn: true, preview: false
  };
}

describe('마이그레이션 (v2 → v3)', () => {
  it('기존 곡이 첫 곡이 되고 설정이 보존된다', () => {
    const doc = migrateLegacy(v2Blob(), 1000);
    expect(doc.order.length).toBe(1);
    const s = doc.songs[doc.order[0]];
    expect(s.title).toBe('옛 곡');
    expect(s.tuning).toBe('dropd');
    expect(s.bpm).toBe(132);
    expect(s.measures[0][0][0]).toBe('3');
    expect(s.measures[7][5][15]).toBe('12h');
    expect(s.marks).toEqual({ '0:0': 'G' });
    expect(s.createdAt).toBe(1000);
    expect(doc.currentId).toBe(s.id);
    expect(doc.settings).toEqual({
      zoom: 'l', theme: 'dark', autoAdv: false, metro: true, loop: 'measure', padMode: 'fret', fretShift: 12,
      haptic: false, collapsed: true, seen: true, instr: 'nylon', volume: 0.5, reverb: 0.1, countIn: true, preview: false
    });
  });
  it('v3 키가 없으면 v2 키를, 그것도 없으면 v1 키를 읽는다', () => {
    const d2 = readDoc(memStorage({ 'gtab-editor-v2': JSON.stringify(v2Blob()) }), 1);
    expect(d2.songs[d2.order[0]].title).toBe('옛 곡');
    const d1 = readDoc(memStorage({ 'gtab-editor-v1': JSON.stringify(Object.assign(v2Blob(), { title: 'v1' })) }), 1);
    expect(d1.songs[d1.order[0]].title).toBe('v1');
  });
  it('저장소가 비어 있으면 빈 곡 하나로 시작한다', () => {
    const d = readDoc(memStorage(), 1);
    expect(d.order.length).toBe(1);
    const s = d.songs[d.order[0]];
    expect(s.measures.length).toBe(8);
    expect(s.title).toBe('');
    expect(d.settings.zoom).toBe('m');
  });
  it('깨진 JSON이나 이상한 값은 기본값으로', () => {
    expect(readDoc(memStorage({ [KEY]: '{not json' }), 1).order.length).toBe(1);
    const d = sanitizeDoc({ songs: { a: { title: 1, measures: [[1]], bpm: 999, tuning: 'zzz' } }, order: ['a', 'ghost'], currentId: 'nope' }, 5);
    expect(d.order).toEqual(['a']);
    expect(d.currentId).toBe('a');
    expect(d.songs.a.title).toBe('');
    expect(d.songs.a.bpm).toBe(90);
    expect(d.songs.a.tuning).toBe('standard');
    expect(d.songs.a.measures.length).toBe(8);
  });
  it('order에 없는 곡도 목록에 들어간다', () => {
    const d = sanitizeDoc({ songs: { a: {}, b: {} }, order: ['b'] }, 5);
    expect(d.order).toEqual(['b', 'a']);
  });
  it('마디 수가 4의 배수가 아니면 채운다', () => {
    const d = sanitizeDoc({ songs: { a: { measures: [emptyMeasure(), emptyMeasure(), emptyMeasure()] } } }, 5);
    expect(d.songs.a.measures.length).toBe(4);
  });
});

describe('곡 관리', () => {
  let st;
  beforeEach(() => {
    st = memStorage({ 'gtab-editor-v2': JSON.stringify(v2Blob()) });
    useStorage(st);
    load();
  });
  it('load 후 책상(state)에 첫 곡이 올라온다', () => {
    expect(state.title).toBe('옛 곡');
    expect(state.measures[0][0][0]).toBe('3');
    expect(state.zoom).toBe('l');
    expect(ed.sel).toEqual({ m: 0, s: 0, i: 0 });
  });
  it('save는 v3 키에 쓰고, 다시 읽으면 같은 곡이 나온다', () => {
    state.measures[1][1][1] = '7'; touch();
    save();
    const d = JSON.parse(st.dump()[KEY]);
    expect(d.v).toBe(3);
    expect(d.songs[d.currentId].measures[1][1][1]).toBe('7');
    expect(d.settings.zoom).toBe('l');
    // 옛 키는 건드리지 않는다
    expect(st.dump()['gtab-editor-v2']).toBeTruthy();
    load();
    expect(state.measures[1][1][1]).toBe('7');
  });
  it('새 곡을 만들면 현재 곡이 바뀌고 이전 곡은 보존된다', () => {
    const first = currentSong().id;
    state.title = '수정됨';
    const s = createSong('둘째');
    expect(library.currentId).toBe(s.id);
    expect(state.title).toBe('둘째');
    expect(state.measures.length).toBe(8);
    expect(state.measures[0][0][0]).toBe('');
    expect(library.songs[first].title).toBe('수정됨');
    expect(listSongs().map((x) => x.title)).toEqual(['수정됨', '둘째']);
    // 설정은 곡과 무관하게 유지
    expect(state.zoom).toBe('l');
  });
  it('switchSong은 책상 위 내용을 먼저 책장에 넣고 바꾼다', () => {
    const first = currentSong().id;
    const second = createSong('둘째');
    state.measures[0][0][0] = '9'; touch();
    expect(switchSong(first)).toBe(true);
    expect(state.title).toBe('옛 곡');
    expect(library.songs[second.id].measures[0][0][0]).toBe('9');
    expect(switchSong(first)).toBe(false);
    expect(switchSong('nope')).toBe(false);
    expect(ed.undoStack).toEqual([]);
  });
  it('이름 바꾸기 / 복제', () => {
    const first = currentSong().id;
    renameSong(first, '새 이름');
    expect(state.title).toBe('새 이름');
    const copy = duplicateSong(first);
    expect(copy.title).toBe('새 이름 사본');
    expect(copy.measures).toEqual(state.measures);
    expect(copy.measures).not.toBe(state.measures);
    expect(copy.marks).toEqual({ '0:0': 'G' });
    expect(library.order.indexOf(copy.id)).toBe(1);
    expect(library.currentId).toBe(first);
  });
  it('삭제: 현재 곡을 지우면 이웃 곡이 열리고, 마지막 곡을 지우면 빈 곡이 생긴다', () => {
    const first = currentSong().id;
    const second = createSong('둘째');
    const third = createSong('셋째');
    expect(deleteSong(first)).toBe(false);
    expect(library.currentId).toBe(third.id);
    expect(deleteSong(third.id)).toBe(true);
    expect(library.currentId).toBe(second.id);
    expect(state.title).toBe('둘째');
    expect(deleteSong(second.id)).toBe(true);
    expect(library.order.length).toBe(1);
    expect(state.title).toBe('');
    expect(state.measures.length).toBe(8);
    expect(deleteSong('nope')).toBe(false);
  });
});
