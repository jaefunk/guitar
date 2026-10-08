// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  readDoc, migrateLegacy, sanitizeDoc, useStorage, load, save, state, ed, library,
  listSongs, createSong, switchSong, renameSong, duplicateSong, deleteSong, currentSong, touch,
  KEY_V4, canEditCurrentSong
} from '../src/state.js';
import { emptyMeasure } from '../src/tab.js';
import { KEY } from '../src/constants.js';
import { parseMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import { v3SongToMusicXml } from '../src/v3-musicxml.js';

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
  it('save는 v4 키에 MusicXML 정본을 쓰고, 다시 읽으면 같은 곡이 나온다', () => {
    state.measures[1][1][1] = '7'; touch();
    save();
    const d = JSON.parse(st.dump()[KEY_V4]);
    expect(d.v).toBe(4);
    expect(Object.keys(d.songs[d.currentId]).sort()).toEqual([
      'createdAt', 'editorMode', 'id', 'musicxml', 'selectedPartId', 'title', 'updatedAt'
    ]);
    expect(d.songs[d.currentId].editorMode).toBe('grid-v3');
    const index = buildScoreIndex(parseMusicXml(d.songs[d.currentId].musicxml), 'P1');
    expect(index.measures[1].events[1].notes[0]).toMatchObject({ string: 2, fret: 7 });
    expect(d.settings.zoom).toBe('l');
    // 옛 키는 건드리지 않는다
    expect(st.dump()['gtab-editor-v2']).toBeTruthy();
    load();
    expect(state.measures[1][1][1]).toBe('7');
  });

  it('v3에서 v4를 만들 때 v3 키를 그대로 두고 ID와 메타데이터를 보존한다', () => {
    const legacy = v2Blob();
    const v3Song = { ...legacy, id: 'kept-id', createdAt: 123, updatedAt: 456 };
    const v3 = {
      v: 3,
      songs: { 'kept-id': v3Song },
      order: ['kept-id'],
      currentId: 'kept-id',
      settings: { zoom: 'l' }
    };
    st = memStorage({ [KEY]: JSON.stringify(v3) });
    useStorage(st);

    load();

    expect(st.getItem(KEY)).toBe(JSON.stringify(v3));
    const migrated = JSON.parse(st.getItem(KEY_V4));
    expect(migrated.currentId).toBe('kept-id');
    expect(migrated.order).toEqual(['kept-id']);
    expect(migrated.songs['kept-id']).toMatchObject({
      id: 'kept-id', title: '옛 곡', selectedPartId: 'P1', editorMode: 'grid-v3', createdAt: 123, updatedAt: 456
    });
    expect(parseMusicXml(migrated.songs['kept-id'].musicxml)).toBeTruthy();
  });

  it('v4가 있으면 변경된 v3보다 v4를 우선하며 마이그레이션은 멱등적이다', () => {
    const firstStorage = memStorage({ [KEY]: JSON.stringify({
      v: 3,
      songs: { a: { ...v2Blob(), id: 'a', title: 'v4가 될 제목' } },
      order: ['a'], currentId: 'a', settings: {}
    }) });
    useStorage(firstStorage);
    load();
    const firstV4 = firstStorage.getItem(KEY_V4);
    firstStorage.setItem(KEY, JSON.stringify({ ...v2Blob(), title: '무시할 v3' }));

    load();

    expect(state.title).toBe('v4가 될 제목');
    expect(firstStorage.getItem(KEY_V4)).toBe(firstV4);
  });

  it('손상된 v4 JSON은 유효한 v3로 복구하고, 모두 손상되면 새 v4 문서를 만든다', () => {
    const fromV3 = readDoc(memStorage({
      [KEY_V4]: '{broken',
      [KEY]: JSON.stringify({ v: 3, songs: { a: { ...v2Blob(), id: 'a' } }, order: ['a'], currentId: 'a' })
    }), 77);
    expect(fromV3.v).toBe(4);
    expect(fromV3.songs.a.title).toBe('옛 곡');

    const empty = readDoc(memStorage({ [KEY_V4]: '{broken', [KEY]: 'null' }), 77);
    expect(empty.v).toBe(4);
    expect(empty.order).toHaveLength(1);
    expect(parseMusicXml(empty.songs[empty.currentId].musicxml)).toBeTruthy();
  });

  it('v4 JSON에 유효한 MusicXML 곡이 없으면 보존된 v3로 복구한다', () => {
    const storage = memStorage({
      [KEY_V4]: JSON.stringify({
        v: 4,
        songs: { broken: {
          id: 'broken',
          musicxml: '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Broken</part-name></score-part></part-list><part id="P1"/></score-partwise>',
          selectedPartId: 'P1'
        } },
        order: ['broken'], currentId: 'broken', settings: {}
      }),
      [KEY]: JSON.stringify({
        v: 3,
        songs: { fallback: { ...v2Blob(), id: 'fallback', title: 'fallback v3' } },
        order: ['fallback'], currentId: 'fallback', settings: {}
      })
    });

    const recovered = readDoc(storage, 77);

    expect(recovered.order).toEqual(['fallback']);
    expect(recovered.songs.fallback.title).toBe('fallback v3');
  });

  it('생성·이름 변경·복제·삭제와 설정 변경을 v4 문서에 반영한다', () => {
    const first = currentSong().id;
    const second = createSong('둘째');
    renameSong(second.id, '바뀐 & 제목');
    const copy = duplicateSong(second.id);
    state.theme = 'light';
    save();
    deleteSong(first);

    const persisted = JSON.parse(st.getItem(KEY_V4));
    expect(persisted.order).toEqual([second.id, copy.id]);
    expect(persisted.songs[first]).toBeUndefined();
    expect(persisted.songs[second.id].title).toBe('바뀐 & 제목');
    expect(parseMusicXml(persisted.songs[second.id].musicxml).querySelector('work-title')?.textContent)
      .toBe('바뀐 & 제목');
    expect(persisted.songs[copy.id].title).toBe('바뀐 & 제목 사본');
    expect(persisted.settings.theme).toBe('light');
  });

  it('현재 곡이 아닌 곡의 이름도 해당 MusicXML 제목에 반영한다', () => {
    const first = currentSong().id;
    const second = createSong('둘째');
    switchSong(first);

    renameSong(second.id, '백그라운드 곡');

    const persisted = JSON.parse(st.getItem(KEY_V4));
    expect(parseMusicXml(persisted.songs[second.id].musicxml).querySelector('work-title')?.textContent)
      .toBe('백그라운드 곡');
  });

  it('이름 변경과 복제는 MusicXML의 지원하지 않는 요소를 보존한다', () => {
    const first = currentSong().id;
    library.songs[first].musicxml = library.songs[first].musicxml.replace(
      '<part-list>',
      '<credit><credit-words>keep me</credit-words></credit><part-list>'
    );
    createSong('현재 곡');

    renameSong(first, '보존된 곡');
    const copy = duplicateSong(first);

    const persisted = JSON.parse(st.getItem(KEY_V4));
    expect(persisted.songs[first].musicxml).toContain('<credit-words>keep me</credit-words>');
    expect(persisted.songs[copy.id].musicxml).toContain('<credit-words>keep me</credit-words>');
    expect(parseMusicXml(persisted.songs[copy.id].musicxml).querySelector('work-title')?.textContent)
      .toBe('보존된 곡 사본');
  });

  it('빠른 격자 수정은 선택하지 않은 MusicXML 파트를 보존한다', () => {
    const first = currentSong().id;
    library.songs[first].musicxml = library.songs[first].musicxml
      .replace('</part-list>', '<score-part id="P2"><part-name>Keep</part-name></score-part></part-list>')
      .replace('</score-partwise>', '<part id="P2"><measure number="1"><note><rest/><duration>4</duration></note></measure></part></score-partwise>');
    state.measures[0][0][1] = '9';
    touch();

    save();

    const persisted = JSON.parse(st.getItem(KEY_V4));
    const doc = parseMusicXml(persisted.songs[first].musicxml);
    expect(doc.querySelector('part[id="P2"] note rest')).not.toBeNull();
    expect(buildScoreIndex(doc, 'P1').measures[0].events[1].notes[0]).toMatchObject({ string: 1, fret: 9 });
  });

  it('marker가 없는 imported MusicXML은 빠른 격자 저장에서 문자열 그대로 보존한다', () => {
    const imported = v3SongToMusicXml({ ...v2Blob(), id: 'imported' })
      .replace(/<identification>[\s\S]*?<\/identification>/, '')
      .replace('<part-list>', '<credit><miscellaneous-field name="gtab-editor-source">v3-grid-v1</miscellaneous-field></credit><part-list>')
      .replace('<measure number="1">', '<measure number="1"><print new-system="yes"/><barline location="left"><repeat direction="forward"/></barline>');
    const storage = memStorage({
      [KEY_V4]: JSON.stringify({
        v: 4,
        songs: { imported: { id: 'imported', title: 'Imported', musicxml: imported, selectedPartId: 'P1', createdAt: 1, updatedAt: 2 } },
        order: ['imported'], currentId: 'imported', settings: {}
      })
    });
    useStorage(storage);
    load();
    state.measures[0][0][1] = '9';
    touch();

    save();

    const persisted = JSON.parse(storage.getItem(KEY_V4)).songs.imported;
    expect(persisted.musicxml).toBe(imported);
    expect(persisted.updatedAt).toBe(2);
    expect(state.measures[0][0][1]).toBe('');
  });

  it('editorMode가 없는 v4는 정확한 XML marker가 있어도 readonly로 취급한다', () => {
    const imported = v3SongToMusicXml({ ...v2Blob(), id: 'imported' });
    const storage = memStorage({
      [KEY_V4]: JSON.stringify({
        v: 4,
        songs: { imported: { id: 'imported', title: 'Imported', musicxml: imported, selectedPartId: 'P1', createdAt: 1, updatedAt: 2 } },
        order: ['imported'], currentId: 'imported', settings: {}
      })
    });
    useStorage(storage);
    load();

    expect(canEditCurrentSong()).toBe(false);
    expect(currentSong().editorMode).toBe('musicxml-readonly');
    expect(JSON.parse(storage.getItem(KEY_V4)).songs.imported.editorMode).toBe('musicxml-readonly');
  });

  it('readonly 거부 시 제목 fallback, BPM, updatedAt과 quick state snapshot을 정확히 복원한다', () => {
    const measure = emptyMeasure();
    measure[0][0] = '3';
    const withoutTitle = v3SongToMusicXml({
      id: 'readonly', title: '', tuning: 'dropd', bpm: 72, measures: [measure], marks: {}
    }).replace(/<identification>[\s\S]*?<\/identification>/, '');
    const storage = memStorage({
      [KEY_V4]: JSON.stringify({
        v: 4,
        songs: { readonly: {
          id: 'readonly', title: 'Fallback title', musicxml: withoutTitle,
          selectedPartId: 'P1', editorMode: 'musicxml-readonly', createdAt: 1, updatedAt: 2
        } },
        order: ['readonly'], currentId: 'readonly', settings: {}
      })
    });
    useStorage(storage);
    load();
    expect(state.title).toBe('Fallback title');
    expect(state.bpm).toBe(72);
    expect(state.tuning).toBe('dropd');
    state.title = 'Mutated';
    state.bpm = 200;
    state.measures[0][0][0] = '19';
    touch();

    save();

    const persisted = JSON.parse(storage.getItem(KEY_V4)).songs.readonly;
    expect(persisted.musicxml).toBe(withoutTitle);
    expect(persisted.title).toBe('Fallback title');
    expect(persisted.updatedAt).toBe(2);
    expect(state).toMatchObject({ title: 'Fallback title', bpm: 72, tuning: 'dropd' });
    expect(state.measures[0][0][0]).toBe('3');
    expect(state.readOnly).toBe(true);
    expect(renameSong('readonly', 'Renamed')).toBe(false);
    expect(currentSong().title).toBe('Fallback title');
    expect(currentSong().musicxml).toBe(withoutTitle);
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
