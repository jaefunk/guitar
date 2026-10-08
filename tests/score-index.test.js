// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/musicxml.js';
import { addRational, buildScoreIndex, rational } from '../src/score-index.js';

const moduleUrl = import.meta.url;
const fixture = readFileSync(new URL('./fixtures/basic-tab.musicxml', moduleUrl), 'utf8');

function scoreWithMeasures(measures) {
  return parseMusicXml(`<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list>
    <part id="P1">${measures}</part>
  </score-partwise>`);
}

describe('ScoreIndex timing', () => {
  it('reduces rationals and keeps their denominator positive', () => {
    expect(rational(6, -8)).toEqual({ n: -3, d: 4 });
    expect(rational(0, -5)).toEqual({ n: 0, d: 1 });
    expect(addRational({ n: 1, d: 6 }, { n: 1, d: 3 })).toEqual({ n: 1, d: 2 });
    expect(() => rational(1, 0)).toThrow(/denominator/i);
  });

  it('uses MusicXML cursor rules and groups chord notes', () => {
    const index = buildScoreIndex(parseMusicXml(fixture), 'P1');
    const measure = index.measures[0];

    expect(index.partId).toBe('P1');
    expect(measure).toMatchObject({ number: '1', divisions: 4, beats: 4, beatType: 4 });
    expect(measure.events.map((event) => [event.kind, event.onset, event.duration])).toEqual([
      ['notes', { n: 0, d: 1 }, { n: 1, d: 2 }],
      ['rest', { n: 1, d: 2 }, { n: 1, d: 2 }]
    ]);
    expect(measure.events[0].notes).toHaveLength(2);
    expect(measure.events[0].notes).toEqual([
      expect.objectContaining({ string: 3, fret: 5, pitch: { step: 'C', octave: 4 } }),
      expect.objectContaining({ string: 3, fret: 7, pitch: { step: 'D', octave: 4 } })
    ]);
  });

  it('subtracts backup duration from the cursor for another voice', () => {
    const doc = scoreWithMeasures(`<measure number="7">
      <attributes><divisions>2</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice></note>
    </measure>`);

    expect(buildScoreIndex(doc, 'P1').measures[0].events.map((event) => event.onset)).toEqual([
      { n: 0, d: 1 },
      { n: 0, d: 1 }
    ]);
  });

  it('advances the cursor by forward duration', () => {
    const doc = scoreWithMeasures(`<measure number="8">
      <attributes><divisions>2</divisions></attributes>
      <forward><duration>1</duration></forward>
      <note><rest/><duration>1</duration><voice>1</voice></note>
    </measure>`);

    expect(buildScoreIndex(doc, 'P1').measures[0].events[0]).toMatchObject({
      kind: 'rest',
      onset: { n: 1, d: 2 },
      duration: { n: 1, d: 2 }
    });
  });

  it('carries divisions and time signature context across measures', () => {
    const doc = scoreWithMeasures(`<measure number="1">
      <attributes>
        <divisions>2</divisions>
        <time><beats>3</beats><beat-type>8</beat-type></time>
      </attributes>
      <note><rest/><duration>1</duration></note>
    </measure>
    <measure number="2"><note><rest/><duration>1</duration></note></measure>`);

    const index = buildScoreIndex(doc, 'P1');

    expect(index.measures[1]).toMatchObject({
      number: '2',
      divisions: 2,
      beats: 3,
      beatType: 8
    });
    expect(index.measures[1].events[0].duration).toEqual({ n: 1, d: 2 });
  });

  it('selects only the requested top-level part body', () => {
    const doc = parseMusicXml(`<score-partwise version="4.0">
      <part-list>
        <score-part id="P1"><part-name>One</part-name></score-part>
        <score-part id="P2"><part-name>Two</part-name></score-part>
      </part-list>
      <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><rest/><duration>1</duration></note></measure></part>
      <part id="P2"><measure number="9"><attributes><divisions>2</divisions></attributes><note><rest/><duration>1</duration></note></measure></part>
    </score-partwise>`);

    expect(buildScoreIndex(doc, 'P2').measures).toHaveLength(1);
    expect(buildScoreIndex(doc, 'P2').measures[0]).toMatchObject({ number: '9', divisions: 2 });
    expect(() => buildScoreIndex(doc, 'missing')).toThrow(/part/i);
  });
});
