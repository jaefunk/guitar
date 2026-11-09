// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { emptyMeasure } from '../src/tab.js';
import { KEY_V4, ed, load, state, useStorage } from '../src/state.js';
import { setVal } from '../src/edit.js';
import { v3SongToMusicXml } from '../src/v3-musicxml.js';
import { dom } from '../src/render.js';

function storageWithReadonlySong() {
  const measure = emptyMeasure();
  measure[0][0] = '3';
  const xml = v3SongToMusicXml({ title: '', tuning: 'standard', bpm: 90, measures: [measure], marks: {} });
  const data = {
    [KEY_V4]: JSON.stringify({
      v: 4,
      songs: { r: {
        id: 'r', title: 'Readonly', musicxml: xml, selectedPartId: 'P1',
        editorMode: 'musicxml-readonly', createdAt: 1, updatedAt: 2
      } },
      order: ['r'], currentId: 'r', settings: {}
    })
  };
  return {
    getItem(key) { return data[key] ?? null; },
    setItem(key, value) { data[key] = String(value); }
  };
}

function storageWithGridSong() {
  const storage = storageWithReadonlySong();
  const raw = JSON.parse(storage.getItem(KEY_V4));
  raw.songs.r.editorMode = 'grid-v3';
  storage.setItem(KEY_V4, JSON.stringify(raw));
  return storage;
}

describe('legacy quick editor readonly guard', () => {
  it('blocks a cell mutation before state or DOM paint changes', () => {
    useStorage(storageWithReadonlySong());
    load();
    ed.sel = { m: 0, s: 0, i: 0 };

    expect(() => setVal(ed.sel, '9')).not.toThrow();
    expect(state.measures[0][0][0]).toBe('3');
    expect(ed.undoStack).toEqual([]);
  });

  it('keeps cell mutation enabled for grid-v3 songs', () => {
    useStorage(storageWithGridSong());
    load();
    const cell = document.createElement('button');
    dom.cells = [[[]]];
    dom.cells[0][0][0] = cell;
    ed.sel = { m: 0, s: 0, i: 0 };

    expect(setVal(ed.sel, '9')).toBe(true);

    expect(state.measures[0][0][0]).toBe('9');
    expect(cell.textContent).toBe('9');
    expect(ed.undoStack).toHaveLength(1);
  });
});
