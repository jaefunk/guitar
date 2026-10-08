// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXml, serializeMusicXml } from '../src/musicxml.js';
import { addRational, buildScoreIndex, rational } from '../src/score-index.js';

const moduleUrl = import.meta.url;
const fixture = readFileSync(new URL('./fixtures/basic-tab.musicxml', moduleUrl), 'utf8');
const techniquesFixture = readFileSync(new URL('./fixtures/techniques.musicxml', moduleUrl), 'utf8');

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
    expect(() => rational(Number.NaN)).toThrow(/finite/i);
    expect(() => rational(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
    expect(() => rational(1, Number.NEGATIVE_INFINITY)).toThrow(/finite/i);
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
      expect.objectContaining({ string: 2, fret: 7, pitch: { step: 'D', octave: 4 } })
    ]);
  });

  it('subtracts backup duration from the cursor for another voice', () => {
    const doc = scoreWithMeasures(`<measure number="7">
      <attributes><divisions>2</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice></note>
    </measure>`);

    const events = buildScoreIndex(doc, 'P1').measures[0].events;

    expect(events.map((event) => event.onset)).toEqual([
      { n: 0, d: 1 },
      { n: 0, d: 1 }
    ]);
    expect(events.map((event) => event.notes[0].pitch.step)).toEqual(['C', 'E']);
  });

  it('stable-sorts completed events by rational onset', () => {
    const doc = scoreWithMeasures(`<measure number="7">
      <attributes><divisions>2</divisions></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <backup><duration>2</duration></backup>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>2</voice></note>
    </measure>`);

    const events = buildScoreIndex(doc, 'P1').measures[0].events;

    expect(events.map((event) => event.onset)).toEqual([
      { n: 0, d: 1 },
      { n: 1, d: 2 },
      { n: 1, d: 1 }
    ]);
    expect(events.map((event) => event.notes[0].pitch.step)).toEqual(['C', 'E', 'D']);
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

  it('includes forward movement in measure duration validation', () => {
    const doc = scoreWithMeasures(`<measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><rest/><duration>1</duration></note>
      <forward><duration>3</duration></forward>
    </measure>`);

    const index = buildScoreIndex(doc, 'P1');

    expect(index.diagnostics.map((diagnostic) => diagnostic.code))
      .not.toContain('MEASURE_DURATION');
  });

  it('allows incomplete implicit pickup measures', () => {
    const doc = scoreWithMeasures(`<measure number="0" implicit="yes">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><rest/><duration>1</duration></note>
    </measure>`);

    const index = buildScoreIndex(doc, 'P1');

    expect(index.diagnostics.map((diagnostic) => diagnostic.code))
      .not.toContain('MEASURE_DURATION');
  });

  it('treats a chord marker at measure start as an advancing note', () => {
    const doc = scoreWithMeasures(`<measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>`);

    expect(buildScoreIndex(doc, 'P1').measures[0].events.map((event) => event.onset)).toEqual([
      { n: 0, d: 1 },
      { n: 1, d: 1 }
    ]);
  });

  it('treats a chord marker after a rest as an advancing note', () => {
    const doc = scoreWithMeasures(`<measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <note><rest/><duration>1</duration></note>
      <note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration></note>
    </measure>`);

    expect(buildScoreIndex(doc, 'P1').measures[0].events.map((event) => event.onset)).toEqual([
      { n: 0, d: 1 },
      { n: 1, d: 2 },
      { n: 1, d: 1 }
    ]);
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

  it('does not mutate the retained MusicXML document', () => {
    const doc = parseMusicXml(fixture);
    const before = serializeMusicXml(doc);

    buildScoreIndex(doc, 'P1');

    expect(serializeMusicXml(doc)).toBe(before);
  });
});

describe('ScoreIndex techniques and playback', () => {
  it('indexes paired guitar techniques with stable event IDs', () => {
    const first = buildScoreIndex(parseMusicXml(techniquesFixture), 'P1');
    const second = buildScoreIndex(parseMusicXml(techniquesFixture), 'P1');

    expect(first.links.map((link) => link.type)).toEqual([
      'hammer-on',
      'pull-off',
      'slide',
      'tie'
    ]);
    expect(first.links).toEqual(second.links);
    expect(first.measures.flatMap((measure) => measure.events.map((event) => event.id)))
      .toEqual(second.measures.flatMap((measure) => measure.events.map((event) => event.id)));
    expect(first.links[0]).toEqual({
      type: 'hammer-on',
      number: '1',
      startEventId: first.measures[0].events[0].id,
      endEventId: first.measures[0].events[1].id
    });
  });

  it('links tied-only notation elements', () => {
    const doc = scoreWithMeasures(`<measure number="1">
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration>
        <notations><tied type="start" number="3"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration>
        <notations><tied type="stop" number="3"/></notations>
      </note>
    </measure>`);

    const index = buildScoreIndex(doc, 'P1');

    expect(index.links).toEqual([{
      type: 'tie',
      number: '3',
      startEventId: index.measures[0].events[0].id,
      endEventId: index.measures[0].events[1].id
    }]);
  });

  it('does not duplicate links when tie and tied are both present', () => {
    const doc = scoreWithMeasures(`<measure number="1">
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/>
        <notations><tied type="start"/></notations>
      </note>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/>
        <notations><tied type="stop"/></notations>
      </note>
    </measure>`);

    const index = buildScoreIndex(doc, 'P1');

    expect(index.links.filter((link) => link.type === 'tie')).toHaveLength(1);
    expect(index.diagnostics.map((diagnostic) => diagnostic.code))
      .not.toContain('UNCLOSED_TECHNIQUE');
  });

  it('preserves tied notation numbers', () => {
    const doc = scoreWithMeasures(`<measure number="1">
      <note>
        <pitch><step>D</step><octave>4</octave></pitch><duration>2</duration>
        <notations><tied type="start" number="9"/></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch><duration>2</duration>
        <notations><tied type="stop" number="9"/></notations>
      </note>
    </measure>`);

    expect(buildScoreIndex(doc, 'P1').links[0].number).toBe('9');
  });

  it('does not mutate the techniques fixture document', () => {
    const doc = parseMusicXml(techniquesFixture);
    const before = serializeMusicXml(doc);

    buildScoreIndex(doc, 'P1');

    expect(serializeMusicXml(doc)).toBe(before);
  });

  it('normalizes bends, dead notes, tuplets, and fermatas', () => {
    const index = buildScoreIndex(parseMusicXml(techniquesFixture), 'P1');
    const techniqueEvents = index.measures[2].events;

    expect(techniqueEvents[0].notes[0].bend).toEqual({ n: 1, d: 2 });
    expect(techniqueEvents[1].notes[0].dead).toBe(true);
    expect(techniqueEvents[2].tuplet).toEqual({ actual: 3, normal: 2 });
    expect(index.measures[5].events.at(-1).fermata).toBe(true);
  });

  it('expands repeats and first and second endings without cloning measures', () => {
    const index = buildScoreIndex(parseMusicXml(techniquesFixture), 'P1');

    expect(index.playbackMeasures).toEqual([0, 1, 2, 3, 0, 1, 2, 4, 5]);
    expect(buildScoreIndex(scoreWithMeasures(`
      <measure number="1"><note><rest/><duration>4</duration></note></measure>
      <measure number="2"><note><rest/><duration>4</duration></note></measure>
    `), 'P1').playbackMeasures).toEqual([0, 1]);
  });

  it('starts each independent repeat section on its first pass', () => {
    const doc = scoreWithMeasures(`
      <measure number="1">
        <barline location="left"><repeat direction="forward"/></barline>
        <note><rest/><duration>4</duration></note>
      </measure>
      <measure number="2">
        <barline location="left"><ending number="1" type="start"/></barline>
        <note><rest/><duration>4</duration></note>
        <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
      </measure>
      <measure number="3">
        <barline location="left"><ending number="2" type="start"/></barline>
        <note><rest/><duration>4</duration></note>
        <barline location="right"><ending number="2" type="stop"/></barline>
      </measure>
      <measure number="4">
        <barline location="left"><repeat direction="forward"/></barline>
        <note><rest/><duration>4</duration></note>
      </measure>
      <measure number="5">
        <barline location="left"><ending number="1" type="start"/></barline>
        <note><rest/><duration>4</duration></note>
        <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
      </measure>
      <measure number="6">
        <barline location="left"><ending number="2" type="start"/></barline>
        <note><rest/><duration>4</duration></note>
        <barline location="right"><ending number="2" type="stop"/></barline>
      </measure>
    `);

    expect(buildScoreIndex(doc, 'P1').playbackMeasures).toEqual([
      0, 1, 0, 2,
      3, 4, 3, 5
    ]);
  });

  it('applies an ending number to every measure through stop or discontinue', () => {
    const doc = scoreWithMeasures(`
      <measure number="1">
        <barline location="left"><repeat direction="forward"/></barline>
        <note><rest/><duration>4</duration></note>
      </measure>
      <measure number="2">
        <barline location="left"><ending number="1" type="start"/></barline>
        <note><rest/><duration>4</duration></note>
      </measure>
      <measure number="3">
        <note><rest/><duration>4</duration></note>
        <barline location="right"><ending number="1" type="discontinue"/><repeat direction="backward"/></barline>
      </measure>
      <measure number="4">
        <barline location="left"><ending number="2" type="start"/></barline>
        <note><rest/><duration>4</duration></note>
        <barline location="right"><ending number="2" type="stop"/></barline>
      </measure>
    `);

    expect(buildScoreIndex(doc, 'P1').playbackMeasures).toEqual([0, 1, 2, 0, 3]);
  });

  it('reports invalid strings, measure duration mismatches, and unclosed techniques', () => {
    const doc = scoreWithMeasures(`<measure number="9">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
        <notations><technical><string>7</string><fret>1</fret><hammer-on type="start" number="2"/></technical></notations>
      </note>
    </measure>`);

    const index = buildScoreIndex(doc, 'P1');
    const byCode = Object.fromEntries(index.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic]));

    expect(Object.keys(byCode)).toEqual(expect.arrayContaining([
      'INVALID_STRING',
      'MEASURE_DURATION',
      'UNCLOSED_TECHNIQUE'
    ]));
    expect(byCode.INVALID_STRING).toMatchObject({
      severity: 'error',
      measureNumber: '9',
      eventId: index.measures[0].events[0].id
    });
    expect(byCode.MEASURE_DURATION.severity).toBe('error');
    expect(byCode.UNCLOSED_TECHNIQUE).toMatchObject({ severity: 'warning', measureNumber: '9' });
    expect(byCode.INVALID_STRING.message).toEqual(expect.any(String));
  });

  it('reports malformed timing without crashing', () => {
    const doc = scoreWithMeasures(`<measure number="bad-time">
      <attributes>
        <divisions>0</divisions>
        <time><beats>4</beats><beat-type>0</beat-type></time>
      </attributes>
      <note><rest/><duration>not-a-number</duration></note>
    </measure>`);

    const index = buildScoreIndex(doc, 'P1');

    expect(index.measures).toHaveLength(1);
    expect(index.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'MEASURE_DURATION',
        measureNumber: 'bad-time'
      })
    ]));
  });
});
