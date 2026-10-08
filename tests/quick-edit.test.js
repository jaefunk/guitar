// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { emptyMeasure } from '../src/tab.js';
import { KEY_V4, load, state, useStorage } from '../src/state.js';
import { applyBpmInput, applyTitleInput, syncQuickEditability } from '../src/quick-edit.js';
import { v3SongToMusicXml } from '../src/v3-musicxml.js';

function readonlyStorage() {
  const xml = v3SongToMusicXml({ title: 'XML title', tuning: 'standard', bpm: 84, measures: [emptyMeasure()], marks: {} });
  const values = {
    [KEY_V4]: JSON.stringify({
      v: 4,
      songs: { r: { id: 'r', title: 'XML title', musicxml: xml, selectedPartId: 'P1', editorMode: 'musicxml-readonly', createdAt: 1, updatedAt: 2 } },
      order: ['r'], currentId: 'r', settings: {}
    })
  };
  return { getItem(key) { return values[key] ?? null; }, setItem(key, value) { values[key] = String(value); } };
}

describe('quick edit controls', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <input id="title"><input id="bpm"><select id="tuning"></select>
      <div id="readOnlyStatus" hidden></div><button id="undo"></button><div id="pad"><button></button></div>`;
    useStorage(readonlyStorage());
    load();
    document.querySelector('#title').value = state.title;
    document.querySelector('#bpm').value = String(state.bpm);
  });

  it('restores title and BPM inputs without mutating readonly state', () => {
    const title = document.querySelector('#title');
    const bpm = document.querySelector('#bpm');
    title.value = 'stale title';
    bpm.value = '200';

    expect(applyTitleInput(title)).toBe(false);
    expect(applyBpmInput(bpm)).toBe(false);

    expect(title.value).toBe('XML title');
    expect(bpm.value).toBe('84');
    expect(state).toMatchObject({ title: 'XML title', bpm: 84 });
  });

  it('disables quick edit controls and exposes a readonly signal', () => {
    syncQuickEditability();

    expect(document.querySelector('#title').disabled).toBe(true);
    expect(document.querySelector('#bpm').disabled).toBe(true);
    expect(document.querySelector('#tuning').disabled).toBe(true);
    expect(document.querySelector('#undo').disabled).toBe(true);
    expect(document.querySelector('#pad button').disabled).toBe(true);
    expect(document.querySelector('#readOnlyStatus').hidden).toBe(false);
  });
});
