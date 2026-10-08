// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMusicXml, serializeMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import { layoutScore } from '../src/score-layout.js';
import {
  createHistory,
  deleteEventCommand,
  insertEventCommand,
  setEndingCommand,
  setFlagsCommand,
  setFretCommand,
  setRepeatCommand,
  setRhythmCommand,
  setStringCommand,
  setTechniquePairCommand
} from '../src/score-edit.js';
import { createScoreEditorBindings } from '../src/score-ui.js';
import { createScoreWorkspaceController } from '../src/score-render.js';
import {
  KEY_V4,
  currentSong,
  load,
  persistCurrentScoreMusicXml,
  useStorage
} from '../src/state.js';

function scoreXml() {
  return `<?xml version="1.0"?>
  <score-partwise version="4.0" xmlns:ext="urn:test">
    <part-list>
      <score-part id="P1"><part-name>Gt.1</part-name></score-part>
      <score-part id="P2"><part-name>Keep</part-name></score-part>
    </part-list>
    <credit><ext:payload keep="yes">untouched</ext:payload></credit>
    <part id="P1">
      <measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note ext:keep="a"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><notations><technical><string>3</string><fret>5</fret><ext:ornament>keep</ext:ornament></technical></notations></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><notations><technical><string>3</string><fret>7</fret></technical></notations></note>
        <note><rest/><duration>8</duration><type>half</type></note>
      </measure>
      <measure number="2"><note><rest/><duration>16</duration><type>whole</type></note></measure>
    </part>
    <part id="P2"><measure number="1"><ext:data>preserve me</ext:data><note><rest/><duration>4</duration></note></measure></part>
  </score-partwise>`;
}

function multiSystemXml(measureCount = 5) {
  const measures = Array.from({ length: measureCount }, (_, index) => `<measure number="${index + 1}">
    ${index === 0 ? '<attributes><divisions>4</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>' : ''}
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type><notations><technical><string>1</string><fret>${index}</fret></technical></notations></note>
  </measure>`).join('');
  return `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

function setup() {
  const doc = parseMusicXml(scoreXml());
  const index = buildScoreIndex(doc, 'P1');
  return { doc, index, first: index.measures[0].events[0].id, second: index.measures[0].events[1].id };
}

function event(doc, id) {
  return buildScoreIndex(doc, 'P1').measures.flatMap((measure) => measure.events)
    .find((candidate) => candidate.id === id);
}

describe('MusicXML score commands', () => {
  it('changes fret/string and supports exact undo and redo on the same Document', () => {
    const { doc, first } = setup();
    const identity = doc;
    const changed = vi.fn();
    const history = createHistory(changed);

    history.execute(setFretCommand(doc, 'P1', first, 9));
    history.execute(setStringCommand(doc, 'P1', first, 2));
    expect(event(doc, first).notes[0]).toMatchObject({ fret: 9, string: 2 });
    expect(doc).toBe(identity);
    expect(history.canUndo()).toBe(true);
    expect(changed).toHaveBeenLastCalledWith([0]);

    history.undo();
    expect(event(doc, first).notes[0]).toMatchObject({ fret: 9, string: 3 });
    history.undo();
    expect(event(doc, first).notes[0]).toMatchObject({ fret: 5, string: 3 });
    history.redo();
    history.redo();
    expect(event(doc, first).notes[0]).toMatchObject({ fret: 9, string: 2 });
  });

  it('edits duration/type/dots/tuplet and rest/dead/ghost reversibly', () => {
    const { doc, first } = setup();
    const history = createHistory();
    history.execute(setRhythmCommand(doc, 'P1', first, {
      duration: 2, type: 'eighth', dots: 2, tuplet: { actual: 3, normal: 2 }
    }));
    history.execute(setFlagsCommand(doc, 'P1', first, { dead: true, ghost: true }));

    expect(event(doc, first)).toMatchObject({
      duration: { n: 1, d: 2 }, noteType: 'eighth', dots: 2, tuplet: { actual: 3, normal: 2 }
    });
    const note = doc.querySelector('part[id="P1"] measure note');
    expect(note.querySelector('notehead').textContent).toBe('x');
    expect(note.querySelector('notehead').getAttribute('parentheses')).toBe('yes');
    expect(layoutScore(buildScoreIndex(doc, 'P1'), { width: 700 }).events[0].notes[0].label).toBe('(x)');

    history.execute(setFlagsCommand(doc, 'P1', first, { rest: true }));
    expect(event(doc, first).kind).toBe('rest');
    history.undo();
    expect(event(doc, first).kind).toBe('notes');
  });

  it('inserts and deletes complete chord events without touching adjacent source nodes', () => {
    const { doc, first, second } = setup();
    const history = createHistory();
    history.execute(insertEventCommand(doc, 'P1', {
      measureIndex: 0,
      afterEventId: first,
      event: { duration: 4, type: 'quarter', notes: [{ string: 1, fret: 10 }, { string: 2, fret: 8 }] }
    }));
    let events = buildScoreIndex(doc, 'P1').measures[0].events;
    expect(events).toHaveLength(4);
    expect(events[1].notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ string: 1, fret: 10 }),
      expect.objectContaining({ string: 2, fret: 8 })
    ]));
    history.undo();
    expect(buildScoreIndex(doc, 'P1').measures[0].events).toHaveLength(3);

    history.execute(deleteEventCommand(doc, 'P1', second));
    expect(buildScoreIndex(doc, 'P1').measures[0].events).toHaveLength(2);
    history.undo();
    expect(event(doc, second).notes[0].fret).toBe(7);
  });

  it('adds paired techniques, repeat marks and a multi-measure ending', () => {
    const { doc, first, second } = setup();
    const history = createHistory();
    history.execute(setTechniquePairCommand(doc, 'P1', 'hammer-on', first, second, true));
    history.execute(setRepeatCommand(doc, 'P1', 0, 'forward', true));
    history.execute(setRepeatCommand(doc, 'P1', 1, 'backward', true));
    history.execute(setEndingCommand(doc, 'P1', 0, 1, '1', true));

    const index = buildScoreIndex(doc, 'P1');
    expect(index.links).toContainEqual(expect.objectContaining({
      type: 'hammer-on', startEventId: first, endEventId: second
    }));
    expect(index.measures[0].barlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ repeat: 'forward' })
    ]));
    expect(index.measures[1].barlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ repeat: 'backward' })
    ]));
    expect(index.measures[0].endings).toContainEqual({ number: '1', type: 'start' });
    expect(index.measures[1].endings).toContainEqual({ number: '1', type: 'stop' });

    history.undo();
    expect(buildScoreIndex(doc, 'P1').measures.flatMap((measure) => measure.endings)).toEqual([]);
  });

  it('preserves unsupported elements and every other part byte-semantically', () => {
    const { doc, first } = setup();
    const otherPartBefore = new XMLSerializer().serializeToString(doc.querySelector('part[id="P2"]'));
    const extensionBefore = new XMLSerializer().serializeToString(doc.querySelector('credit'));
    createHistory().execute(setFretCommand(doc, 'P1', first, 12));

    expect(new XMLSerializer().serializeToString(doc.querySelector('part[id="P2"]'))).toBe(otherPartBefore);
    expect(new XMLSerializer().serializeToString(doc.querySelector('credit'))).toBe(extensionBefore);
    expect(doc.querySelector('part[id="P1"] ext\\:ornament, part[id="P1"] ornament')?.textContent).toBe('keep');
  });

  it('rejects invalid commands atomically, does not push history, clears redo after a branch, and tolerates empty stacks', () => {
    const { doc, first } = setup();
    const before = serializeMusicXml(doc);
    const history = createHistory();
    expect(() => history.execute(setFretCommand(doc, 'P1', first, -1))).toThrow(/fret/i);
    expect(serializeMusicXml(doc)).toBe(before);
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);

    history.execute(setFretCommand(doc, 'P1', first, 9));
    history.undo();
    expect(history.canRedo()).toBe(true);
    history.execute(setStringCommand(doc, 'P1', first, 1));
    expect(history.canRedo()).toBe(false);
  });
});

describe('score inspector and persistence', () => {
  beforeEach(() => {
    document.body.innerHTML = '<aside id="scoreInspector"></aside>';
  });

  it('renders professional controls and persists an inspector edit while keeping selection', () => {
    const { doc, first } = setup();
    const song = { musicxml: serializeMusicXml(doc), selectedPartId: 'P1', editorMode: 'musicxml-readonly' };
    const persist = vi.fn((xml) => { song.musicxml = xml; });
    const rerender = vi.fn();
    const editor = createScoreEditorBindings({
      inspector: document.querySelector('#scoreInspector'),
      getSong: () => song,
      persistMusicXml: persist,
      rerender
    });

    editor.select(first);
    const fret = document.querySelector('[name="score-fret"]');
    expect(fret).not.toBeNull();
    expect(document.querySelector('[data-score-action="undo"]').disabled).toBe(true);
    fret.value = '11';
    fret.dispatchEvent(new Event('change', { bubbles: true }));

    expect(buildScoreIndex(parseMusicXml(song.musicxml), 'P1').measures[0].events[0].notes[0].fret).toBe(11);
    expect(editor.getSelectedEventId()).toBe(first);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(rerender).toHaveBeenCalledWith([0], first);
    expect(document.querySelector('[data-score-action="undo"]').disabled).toBe(false);

    document.querySelector('[data-score-action="undo"]').click();
    expect(buildScoreIndex(parseMusicXml(song.musicxml), 'P1').measures[0].events[0].notes[0].fret).toBe(5);
    document.querySelector('[data-score-action="redo"]').click();
    expect(buildScoreIndex(parseMusicXml(song.musicxml), 'P1').measures[0].events[0].notes[0].fret).toBe(11);
  });

  it('stores score-mode XML through the dedicated state API without changing grid ownership', () => {
    const storage = new Map();
    useStorage({ getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) });
    load();
    const song = currentSong();
    song.editorMode = 'musicxml-readonly';
    persistCurrentScoreMusicXml(scoreXml());
    const doc = parseMusicXml(currentSong().musicxml);
    const first = buildScoreIndex(doc, song.selectedPartId).measures[0].events[0].id;
    createHistory().execute(setFretCommand(doc, song.selectedPartId, first, 13));

    persistCurrentScoreMusicXml(serializeMusicXml(doc));

    const persisted = JSON.parse(storage.get(KEY_V4)).songs[song.id];
    expect(persisted.editorMode).toBe('musicxml-readonly');
    expect(buildScoreIndex(parseMusicXml(persisted.musicxml), persisted.selectedPartId)
      .measures[0].events[0].notes[0].fret).toBe(13);
  });

  it('lets the workspace use the editable inspector and preserve an explicit selection on rerender', () => {
    document.body.innerHTML = '<div id="canvas"></div><aside id="diagnostics"></aside><aside id="inspector"></aside>';
    const selected = [];
    const controller = createScoreWorkspaceController({
      canvas: document.querySelector('#canvas'),
      diagnostics: document.querySelector('#diagnostics'),
      inspector: document.querySelector('#inspector'),
      getSong: () => ({ musicxml: scoreXml(), selectedPartId: 'P1' }),
      getScreenWidth: () => 900,
      renderInspector: (_host, event) => { selected.push(event?.id || null); }
    });
    const result = controller.renderScreen();
    const second = result.index.measures[0].events[1].id;

    controller.setSelectedEventId(second);
    controller.renderScreen(true);

    expect(controller.getSelectedEventId()).toBe(second);
    expect(document.querySelector('#canvas .selected')?.dataset.eventId).toBe(second);
    expect(selected.at(-1)).toBe(second);
    controller.destroy();
  });

  it('patches only the affected system for fret edits and undo/redo', () => {
    document.body.innerHTML = '<div id="canvas"></div><aside id="diagnostics"></aside><aside id="inspector"></aside>';
    const song = { musicxml: multiSystemXml(), selectedPartId: 'P1' };
    const controller = createScoreWorkspaceController({
      canvas: document.querySelector('#canvas'), diagnostics: document.querySelector('#diagnostics'),
      inspector: document.querySelector('#inspector'), getSong: () => song, getScreenWidth: () => 400
    });
    controller.renderScreen();
    const canvas = document.querySelector('#canvas');
    const initialFirst = canvas.querySelector('[data-system-index="0"]');
    const originalSecond = canvas.querySelector('[data-system-index="1"]');
    const doc = parseMusicXml(song.musicxml);
    const eventId = buildScoreIndex(doc, 'P1').measures[0].events[0].id;
    controller.renderMeasures([0], eventId);
    const originalFirst = canvas.querySelector('[data-system-index="0"]');
    expect(originalFirst).not.toBe(initialFirst);
    expect(canvas.querySelector('[data-system-index="1"]')).toBe(originalSecond);
    canvas.querySelector(`[data-event-id="${eventId}"]`).focus();
    const history = createHistory((measures) => {
      song.musicxml = serializeMusicXml(doc);
      controller.renderMeasures(measures, eventId);
    });

    history.execute(setFretCommand(doc, 'P1', eventId, 9));
    const editedFirst = canvas.querySelector('[data-system-index="0"]');
    const untouchedSecond = canvas.querySelector('[data-system-index="1"]');
    expect(editedFirst).not.toBe(originalFirst);
    expect(untouchedSecond).toBe(originalSecond);
    expect(editedFirst.querySelector('.score-fret').textContent).toBe('9');
    expect(document.activeElement.dataset.eventId).toBe(eventId);

    history.undo();
    expect(canvas.querySelector('[data-system-index="0"]')).not.toBe(editedFirst);
    expect(canvas.querySelector('[data-system-index="1"]')).toBe(originalSecond);
    history.redo();
    expect(canvas.querySelector('[data-system-index="1"]')).toBe(originalSecond);
    expect(controller.getSelectedEventId()).toBe(eventId);
    controller.destroy();
  });

  it('patches downstream systems when inserted events change system reflow', () => {
    document.body.innerHTML = '<div id="canvas"></div><aside id="diagnostics"></aside><aside id="inspector"></aside>';
    const song = { musicxml: multiSystemXml(6), selectedPartId: 'P1' };
    const controller = createScoreWorkspaceController({
      canvas: document.querySelector('#canvas'), diagnostics: document.querySelector('#diagnostics'),
      inspector: document.querySelector('#inspector'), getSong: () => song, getScreenWidth: () => 400
    });
    controller.renderScreen();
    const canvas = document.querySelector('#canvas');
    const originalSystems = [...canvas.querySelectorAll('[data-system-index]')];
    const doc = parseMusicXml(song.musicxml);
    let anchor = buildScoreIndex(doc, 'P1').measures[0].events[0].id;
    const history = createHistory((measures) => {
      song.musicxml = serializeMusicXml(doc);
      controller.renderMeasures(measures, anchor);
    });
    for (let offset = 0; offset < 6; offset += 1) {
      history.execute(insertEventCommand(doc, 'P1', {
        measureIndex: 0, afterEventId: anchor,
        event: { duration: 4, type: 'quarter', notes: [{ string: 1, fret: offset + 10 }] }
      }));
      anchor = buildScoreIndex(doc, 'P1').measures[0].events.at(-1).id;
    }

    const nextSystems = [...canvas.querySelectorAll('[data-system-index]')];
    expect(nextSystems.length).toBeGreaterThan(originalSystems.length);
    expect(nextSystems[0]).not.toBe(originalSystems[0]);
    expect(nextSystems.slice(1).some((system, index) => system === originalSystems[index + 1])).toBe(false);
    expect(canvas.querySelector('svg').getAttribute('viewBox')).toMatch(`0 0 400 ${controller.getLastResult().layout.totalHeight}`);
    controller.destroy();
  });
});
