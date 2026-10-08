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

function linkedFrets(number, type) {
  const ids = new Set(measure(number).events.map((event) => event.id));
  const byId = new Map(index.measures.flatMap((entry) => entry.events).map((event) => [event.id, event]));
  return index.links.filter((link) => link.type === type && ids.has(link.startEventId)).map((link) => {
    const from = byId.get(link.startEventId).notes[link.fromNoteIndex];
    const to = byId.get(link.endEventId).notes[link.toNoteIndex];
    return [from.fret, to.fret, from.string, to.string];
  });
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
    expect(Array.from(doc.querySelectorAll('staff-tuning'), (entry) => [
      Number(entry.getAttribute('line')),
      entry.querySelector('tuning-step')?.textContent,
      Number(entry.querySelector('tuning-octave')?.textContent)
    ])).toEqual([
      [1, 'E', 2], [2, 'A', 2], [3, 'D', 3], [4, 'G', 3], [5, 'B', 3], [6, 'E', 4]
    ]);
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
    for (const number of [6, 10, 26, 30, 34, 68]) {
      const second = doc.querySelectorAll(`measure[number="${number}"] harmony`)[1];
      expect(second.querySelector('root-step')?.textContent).toBe('E');
      expect(second.querySelector('root-alter')?.textContent).toBe('-1');
      expect(second.querySelector('kind')?.textContent).toBe('major');
      expect(second.querySelector('bass')).toBeNull();
    }
  });

  it.runIf(scoreExists)('uses zero-time grace notes and explicit 3:2 timing', () => {
    const durations = (number) => measure(number).events.map((event) => event.duration.n * 24 / event.duration.d);
    expect(durations(71)).toEqual([6, 6, 6, 6, 6, 6, 6, 0, 8, 8, 8, 12, 6, 12]);
    expect(durations(72)).toEqual([6, 6, 6, 6, 6, 6, 6, 0, 12, 12, 12, 6, 12]);
    expect(durations(73)).toEqual(durations(71));
    for (const number of [71, 72, 73]) {
      const grace = doc.querySelector(`measure[number="${number}"] note:has(> grace)`);
      expect(grace).not.toBeNull();
      expect(grace.querySelector(':scope > duration')).toBeNull();
      expect(grace.querySelector('fret')?.textContent).toBe('15');
      expect(grace.querySelector('string')?.textContent).toBe('1');
      const graceEvent = measure(number).events.find((event) => event.notes?.some((note) => note.fret === 15) && event.duration.n === 0);
      const following = measure(number).events[measure(number).events.indexOf(graceEvent) + 1];
      expect(graceEvent.onset).toEqual({ n: 7, d: 4 });
      expect(following.onset).toEqual(graceEvent.onset);
    }
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
    expect(measure(50).events.some((event) => event.notes?.some((note) => note.bend?.n === 1 && note.bend?.d === 1))).toBe(true);
    expect(linkTypesStartingIn(51)).toEqual(expect.arrayContaining(['pull-off', 'slide']));
    expect(measure(51).events.some((event) => event.tuplet?.actual === 3 && event.tuplet?.normal === 2)).toBe(true);
    expect(measure(33).endings).toContainEqual({ number: '1', type: 'start' });
    expect(measure(49).endings).toContainEqual({ number: '2', type: 'start' });
    expect(measure(74).barlines).toEqual(expect.arrayContaining([expect.objectContaining({ repeat: 'backward' })]));
    expect(index.playbackMeasures.length).toBeGreaterThan(77);
    expect(measure(77).events.some((event) => event.fermata)).toBe(true);
  });

  it.runIf(scoreExists)('matches bend amounts, pull-off endpoints, dead strokes, and the D4 tie', () => {
    for (const number of [50, 52, 54, 56, 60, 62]) {
      const bends = measure(number).events.flatMap((event) => event.notes || []).filter((note) => note.bend);
      expect(bends).toHaveLength(1);
      expect(bends[0].bend).toEqual({ n: 1, d: 1 });
    }
    for (const number of [6, 10, 34]) {
      expect(linkedFrets(number, 'pull-off')).toEqual([[8, 7, 2, 2], [10, 8, 2, 2]]);
    }
    for (const number of [51, 55, 59]) {
      expect(linkedFrets(number, 'pull-off')).toEqual([[10, 9, 4, 4], [9, 7, 4, 4]]);
    }
    for (const number of [71, 73]) {
      expect(linkedFrets(number, 'pull-off')).toEqual([[17, 15, 1, 1], [15, 14, 1, 1]]);
    }
    for (const number of [22, 46]) {
      const dead = measure(number).events.filter((event) => event.notes?.some((note) => note.dead));
      expect(dead.map((event) => [event.onset, event.duration])).toEqual([
        [{ n: 5, d: 2 }, { n: 1, d: 1 }],
        [{ n: 7, d: 2 }, { n: 1, d: 4 }],
        [{ n: 15, d: 4 }, { n: 1, d: 4 }]
      ]);
    }
    const tie = index.links.find((link) => link.type === 'tie' && link.startEventId.startsWith('P1:m61:'));
    expect(tie).toBeTruthy();
    const start = measure(62).events.find((event) => event.id === tie.startEventId).notes[tie.fromNoteIndex];
    const stop = measure(63).events.find((event) => event.id === tie.endEventId).notes[tie.toNoteIndex];
    expect(start.pitch).toEqual({ step: 'D', octave: 4 });
    expect(stop.pitch).toEqual(start.pitch);
    expect(doc.querySelector('measure[number="62"] note > tie[type="start"]')).not.toBeNull();
    expect(doc.querySelector('measure[number="62"] note tied[type="start"]')).not.toBeNull();
    expect(doc.querySelector('measure[number="63"] note > tie[type="stop"]')).not.toBeNull();
    expect(doc.querySelector('measure[number="63"] note tied[type="stop"]')).not.toBeNull();
  });

  it.runIf(scoreExists)('keeps every recurring printed motif in sync', () => {
    const fingerprint = (number) => measure(number).events.map((event) => ({
      kind: event.kind, onset: event.onset, duration: event.duration,
      notes: event.notes?.map((note) => ({ string: note.string, fret: note.fret, dead: note.dead, ghost: note.ghost }))
    }));
    for (const group of [
      [5, 9, 33], [6, 10, 34], [7, 11, 35], [8, 12, 36],
      [21, 23, 45, 47], [22, 46],
      [25, 29, 67], [26, 30, 68], [27, 31, 69], [28, 32, 70],
      [49, 53], [51, 55, 59], [52, 56, 60], [71, 73], [74, 75, 76]
    ]) {
      for (const candidate of group.slice(1)) expect(fingerprint(candidate)).toEqual(fingerprint(group[0]));
    }
  });

  it.runIf(scoreExists)('keeps every TAB position consistent with capo-one sounding pitch', () => {
    const stepPc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    const openMidi = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
    for (const entry of index.measures) {
      for (const event of entry.events) {
        for (const note of event.notes || []) {
          if (note.string === undefined || note.fret === undefined || !note.pitch?.step) continue;
          const actual = (note.pitch.octave + 1) * 12 + stepPc[note.pitch.step] + (note.pitch.alter || 0);
          expect(actual, `measure ${entry.number}, string ${note.string}, fret ${note.fret}`)
            .toBe(openMidi[note.string] + 1 + note.fret);
        }
      }
    }
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
