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
      <div id="readOnlyStatus" hidden></div>
      <button id="undo"></button><button id="addLine"></button><button id="measureMenu"></button>
      <button id="clearAll"></button><button id="chordBtn"></button><button id="markBtn"></button><button id="doImport"></button>
      <div id="pad">
        <button id="playBtn"></button><button id="restartBtn"></button><button id="metroBtn"></button>
        <button id="collapseBtn"></button><button id="modeKeys"></button><button id="modeFret"></button>
        <button id="fbShift"></button><button id="fbClear"></button>
        <label><input id="autoAdv" type="checkbox"></label>
        <select id="instr"></select><select id="loop"></select>
        <div id="digits"><button data-digit="1"></button></div>
        <button data-mod="h"></button><button id="del"></button>
        <div id="fretboard"><button class="fb-cell"></button></div>
        <button class="nav" data-move="1,0"></button>
      </div>`;
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
    for (const selector of [
      '#digits button', '[data-mod]', '#del', '.fb-cell', '#fbClear',
      '#addLine', '#measureMenu', '#clearAll', '#chordBtn', '#markBtn', '#doImport'
    ]) expect(document.querySelector(selector).disabled, selector).toBe(true);
    for (const selector of [
      '#playBtn', '#restartBtn', '#metroBtn', '#collapseBtn', '#modeKeys', '#modeFret',
      '#fbShift', '.nav', '#autoAdv', '#instr', '#loop'
    ]) expect(document.querySelector(selector).disabled, selector).toBe(false);
    expect(document.querySelector('#readOnlyStatus').hidden).toBe(false);
    expect(document.querySelector('#readOnlyStatus').textContent).toMatch(/빠른 격자.*전문 TAB 편집 가능/);
  });
});
