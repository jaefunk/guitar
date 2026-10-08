// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import { emptyMeasure } from '../src/tab.js';
import { v3SongToMusicXml } from '../src/v3-musicxml.js';

function songWith(measures, overrides = {}) {
  return {
    id: 'legacy-1',
    title: 'A & B <demo>',
    tuning: 'standard',
    bpm: 84,
    measures,
    marks: {},
    createdAt: 10,
    updatedAt: 20,
    ...overrides
  };
}

describe('v3 grid to MusicXML 4.0', () => {
  it('converts notes in one slot to a MusicXML chord', () => {
    const measure = emptyMeasure();
    measure[0][0] = '3';
    measure[1][0] = '5';

    const xml = v3SongToMusicXml(songWith([measure]));
    const doc = parseMusicXml(xml);
    const index = buildScoreIndex(doc, 'P1');

    expect(index.measures[0].events[0].notes.map((note) => [note.string, note.fret]))
      .toEqual([[1, 3], [2, 5]]);
    expect(doc.documentElement.getAttribute('version')).toBe('4.0');
    expect(doc.querySelector('divisions')?.textContent).toBe('4');
    expect(doc.querySelector('time')?.textContent.replace(/\s/g, '')).toBe('44');
    expect(doc.querySelector('clef sign')?.textContent).toBe('TAB');
    expect(doc.querySelectorAll('staff-tuning')).toHaveLength(6);
  });

  it('emits one complete measure per legacy measure and rests for empty slots', () => {
    const first = emptyMeasure();
    const second = emptyMeasure();
    first[2][8] = '7';

    const index = buildScoreIndex(parseMusicXml(v3SongToMusicXml(songWith([first, second]))), 'P1');

    expect(index.measures).toHaveLength(2);
    expect(index.measures[0].events).toHaveLength(16);
    expect(index.measures[0].events[0].kind).toBe('rest');
    expect(index.measures[0].events[8].notes[0]).toMatchObject({ string: 3, fret: 7 });
    expect(index.measures[1].events.every((event) => event.kind === 'rest')).toBe(true);
    expect(index.diagnostics.filter((diagnostic) => diagnostic.code === 'MEASURE_DURATION')).toEqual([]);
  });

  it('maps marks and known modifiers to MusicXML notation elements', () => {
    const measure = emptyMeasure();
    measure[0][0] = '3h';
    measure[0][1] = '5p';
    measure[0][2] = '3/';
    measure[0][3] = '7b';
    measure[1][4] = '8~';
    measure[2][5] = 'x';
    const xml = v3SongToMusicXml(songWith([measure], { marks: { '0:0': 'Verse & <loud>' } }));
    const doc = parseMusicXml(xml);

    expect(doc.querySelector('direction words')?.textContent).toBe('Verse & <loud>');
    expect(doc.querySelector('hammer-on[type="start"]')).not.toBeNull();
    expect(doc.querySelector('hammer-on[type="stop"]')).not.toBeNull();
    expect(doc.querySelector('pull-off[type="start"]')).not.toBeNull();
    expect(doc.querySelector('slide[type="start"]')).not.toBeNull();
    expect(doc.querySelector('bend bend-alter')?.textContent).toBe('1');
    expect([...doc.querySelectorAll('other-technical')].map((node) => node.textContent)).toContain('vibrato');
    expect(doc.querySelector('notehead')?.textContent).toBe('x');
  });

  it('escapes metadata and text while keeping valid MusicXML', () => {
    const xml = v3SongToMusicXml(songWith([emptyMeasure()], {
      title: 'Rock & Roll <"live">',
      marks: { '0:3': 'A&B < C' }
    }));
    const doc = parseMusicXml(xml);

    expect(doc.querySelector('work-title')?.textContent).toBe('Rock & Roll <"live">');
    expect(doc.querySelector('words')?.textContent).toBe('A&B < C');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
  });

  it('rejects malformed legacy measure data instead of emitting invalid XML', () => {
    expect(() => v3SongToMusicXml(songWith([]))).toThrow(/v3|measure/i);
    expect(() => v3SongToMusicXml(songWith([[['not-a-measure']]]))).toThrow(/v3|measure/i);
  });
});
