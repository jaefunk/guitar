// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseMusicXml, readScoreMetadata } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import * as songs from '../src/songs.js';

const scorePath = join(process.cwd(), 'songs', 'nell-1-03-gt1.musicxml');
const scoreExists = existsSync(scorePath);
const xml = scoreExists ? readFileSync(scorePath, 'utf8') : '';
const doc = scoreExists ? parseMusicXml(xml) : null;
const index = doc ? buildScoreIndex(doc, 'P1') : null;

function measure(number) {
  return index.measures.find((entry) => entry.number === String(number));
}

function tabFrets(number) {
  return measure(number).events.flatMap((event) =>
    event.kind === 'notes' ? event.notes.filter((note) => note.fret !== undefined).map((note) => note.fret) : []
  );
}

function tabStrings(number) {
  return measure(number).events.flatMap((event) =>
    event.kind === 'notes' ? event.notes.filter((note) => note.fret !== undefined).map((note) => note.string) : []
  );
}

function linkTypesStartingIn(number) {
  const ids = new Set(measure(number).events.map((event) => event.id));
  return index.links.filter((link) => ids.has(link.startEventId)).map((link) => link.type);
}

describe('1:03 Gt.1 reference score', () => {
  it('ships the transcribed score as a repository asset', () => {
    expect(scoreExists).toBe(true);
  });

  it.runIf(scoreExists)('matches the printed metadata and 77-measure structure', () => {
    expect(doc.querySelector('work-title')?.textContent).toBe('1:03');
    expect(doc.querySelector('score-part[id="P1"] part-name')?.textContent).toBe('Gt.1');
    expect(readScoreMetadata(doc, 'P1')).toEqual({ tempo: 84, capo: 1, beats: 4, beatType: 4 });
    expect(doc.querySelector('fifths')?.textContent).toBe('-4');
    expect(index.measures).toHaveLength(77);
    expect(index.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    expect(index.measures.every((entry) => entry.actualDuration.n === 4 && entry.actualDuration.d === 1)).toBe(true);
  });

  it.runIf(scoreExists)('keeps page and system anchors instead of placeholder measures', () => {
    expect(tabFrets(1).slice(0, 6)).toEqual([3, 3, 0, 2, 2, 0]);
    expect(tabFrets(5)).toEqual([8, 7, 8, 7, 8, 10, 10, 7, 10, 7, 7]);
    expect(measure(13).events).toHaveLength(1);
    expect(measure(13).events[0]).toMatchObject({ kind: 'notes', duration: { n: 4, d: 1 } });
    expect(tabFrets(21)).toEqual(expect.arrayContaining([5, 7]));
    expect(tabFrets(24).slice(0, 6)).toEqual([0, 2, 0, 2, 0, 0]);
    expect(measure(25).barlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ repeat: 'forward' })
    ]));
    expect(tabFrets(33)).toEqual(tabFrets(9));
    expect(measure(37).events[0]).toMatchObject({ kind: 'notes', duration: { n: 4, d: 1 } });
    expect(measure(41).events).toEqual([expect.objectContaining({ kind: 'rest', duration: { n: 4, d: 1 } })]);
    expect(tabFrets(45)).toEqual(expect.arrayContaining([5, 7]));
    expect(measure(48).barlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ repeat: 'backward' })
    ]));
    expect(tabFrets(49)).toEqual([10, 12, 10, 10, 9]);
    expect(tabStrings(49)).toEqual([4, 4, 4, 4, 4]);
    expect(tabFrets(50)).toEqual([9, 7, 5, 7]);
    expect(tabFrets(51)).toEqual([10, 12, 12, 10, 9, 7, 7, 7, 5, 5, 7, 7, 5, 5, 5]);
    expect(tabFrets(52)).toEqual([10, 12, 12, 9, 9, 7, 7, 5, 5, 7, 7, 5, 5, 5]);
    expect(tabFrets(53)).toEqual([10, 12, 10, 10, 9]);
    expect(tabFrets(54)).toEqual([9, 7, 5, 7, 9]);
    expect(tabFrets(56)).toEqual(tabFrets(52));
    expect(tabFrets(57)).toEqual([10, 12, 10, 9]);
    expect(tabStrings(57)).toEqual([4, 4, 4, 4]);
    expect(tabFrets(58)).toEqual([10]);
    expect(tabFrets(60)).toEqual(tabFrets(52));
    expect(tabFrets(67).slice(0, 6)).toEqual([3, 3, 0, 2, 2, 0]);
    expect(tabFrets(71).slice(0, 8)).toEqual([12, 13, 12, 15, 12, 13, 12, 15]);
    expect(tabStrings(71)).toEqual([...Array(13).fill(1), 2]);
    expect(tabFrets(75)).toEqual([12, 13, 12, 15, 12, 13, 12, 13, 13, 13, 12, 12]);
    expect(tabStrings(75)).toEqual([...Array(11).fill(1), 2]);
    expect(tabFrets(76)).toEqual(tabFrets(75));
    expect(tabFrets(77)).toEqual([12]);
  });

  it.runIf(scoreExists)('keeps the printed chord-symbol roadmap', () => {
    const roots = (number) => Array.from(doc.querySelectorAll(`measure[number="${number}"] harmony root-step`), (node) => node.textContent);
    expect(roots(1)).toEqual(['F', 'C']);
    expect(roots(21)).toEqual(['B']);
    expect(roots(49)).toEqual(['E']);
    expect(roots(61)).toEqual(['G']);
    expect(roots(64)).toEqual(['D', 'E']);
    expect(roots(71)).toEqual(['A', 'C']);
    expect(roots(77)).toEqual(['A']);
  });

  it.runIf(scoreExists)('uses explicit 3:2 timing for triplet durations', () => {
    const durations = (number) => measure(number).events.map((event) => event.duration.n * 24 / event.duration.d);
    expect(durations(71)).toEqual([6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 8]);
    expect(durations(72)).toEqual([6, 6, 6, 6, 6, 6, 6, 6, 8, 8, 8, 12, 12]);
    expect(durations(73)).toEqual(durations(71));
    const irregular = Array.from(doc.querySelectorAll('note')).filter((entry) => ['4', '8'].includes(entry.querySelector(':scope > duration')?.textContent));
    expect(irregular.length).toBeGreaterThan(0);
    expect(irregular.every((entry) =>
      entry.querySelector(':scope > time-modification > actual-notes')?.textContent === '3'
      && entry.querySelector(':scope > time-modification > normal-notes')?.textContent === '2'
    )).toBe(true);
  });

  it.runIf(scoreExists)('encodes the printed techniques, endings, repeats, and final fermata', () => {
    expect(linkTypesStartingIn(21)).toContain('hammer-on');
    expect(measure(21).events.some((event) => event.notes?.some((note) => note.dead))).toBe(true);
    expect(linkTypesStartingIn(49)).toContain('slide');
    expect(measure(50).events.some((event) => event.notes?.some((note) => note.bend?.n === 1 && note.bend?.d === 2))).toBe(true);
    expect(linkTypesStartingIn(51)).toEqual(expect.arrayContaining(['pull-off', 'slide']));
    expect(measure(51).events.some((event) => event.tuplet?.actual === 3 && event.tuplet?.normal === 2)).toBe(true);
    expect(measure(33).endings).toContainEqual({ number: '1', type: 'start' });
    expect(measure(49).endings).toContainEqual({ number: '2', type: 'start' });
    expect(measure(74).barlines).toEqual(expect.arrayContaining([expect.objectContaining({ repeat: 'backward' })]));
    expect(index.playbackMeasures.length).toBeGreaterThan(77);
    expect(measure(77).events.some((event) => event.fermata)).toBe(true);
  });

  it('loads the built-in score only after an explicit call', async () => {
    expect(songs.loadBuiltInNellGt1).toEqual(expect.any(Function));
    if (typeof songs.loadBuiltInNellGt1 !== 'function') return;
    const importSong = vi.fn((value) => value);
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '<score-partwise version="4.0"/>' }));

    const imported = await songs.loadBuiltInNellGt1({ fetchImpl, importSong });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(importSong).toHaveBeenCalledTimes(1);
    expect(imported).toMatchObject({ selectedPartId: 'P1', title: '1:03', editorMode: 'musicxml-score' });
  });
});
