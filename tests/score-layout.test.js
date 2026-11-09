// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import { layoutScore } from '../src/score-layout.js';

const moduleUrl = import.meta.url;
const techniquesFixture = readFileSync(new URL('./fixtures/techniques.musicxml', moduleUrl), 'utf8');

const r = (n, d = 1) => ({ n, d });

function event(id, onset, duration, notes = [{ string: 3, fret: 5 }], extra = {}) {
  return { id, kind: 'notes', onset, duration, notes, ...extra };
}

function rest(id, onset, duration, extra = {}) {
  return { id, kind: 'rest', onset, duration, ...extra };
}

function measure(number, events, extra = {}) {
  return { number: String(number), divisions: 4, beats: 4, beatType: 4, events, ...extra };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

function findOverlaps(boxes) {
  const pairs = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (overlaps(boxes[i], boxes[j])) pairs.push([boxes[i].id, boxes[j].id]);
    }
  }
  return pairs;
}

const sparse = measure(1, [event('m1:e1', r(0), r(4))]);
const dense = measure(2, [
  event('m2:e1', r(0), r(1, 2), [{ string: 1, fret: 3 }]),
  event('m2:e2', r(1, 2), r(1, 2), [{ string: 2, fret: 5 }]),
  event('m2:e3', r(1), r(1, 2), [{ string: 3, fret: 7 }]),
  event('m2:e4', r(3, 2), r(1, 2), [{ string: 4, fret: 8 }]),
  event('m2:e5', r(2), r(1), [{ string: 5, fret: 10 }]),
  rest('m2:e6', r(3), r(1))
]);

describe('layoutScore geometry', () => {
  it('returns the complete plain-record contract for an empty score', () => {
    const layout = layoutScore({ partId: 'P1', measures: [], links: [], playbackMeasures: [] });

    expect(Object.keys(layout)).toEqual([
      'systems', 'measures', 'events', 'beams', 'tuplets', 'links', 'barlines', 'hitBoxes', 'totalHeight'
    ]);
    expect(layout).toEqual(JSON.parse(JSON.stringify(layout)));
    expect(layout.systems).toEqual([]);
    expect(layout.totalHeight).toBe(0);
  });

  it('treats null options like an empty options object', () => {
    const index = { partId: 'P1', measures: [sparse], links: [] };

    expect(layoutScore(index, null)).toEqual(layoutScore(index, {}));
  });

  it('allocates more width to rhythm-dense measures and wraps systems', () => {
    const layout = layoutScore(
      { partId: 'P1', measures: [sparse, dense, sparse, dense], links: [], playbackMeasures: [0, 1, 2, 3] },
      { width: 520, staffGap: 12, minMeasureWidth: 180, columnWidth: 34 }
    );

    expect(layout.measures[1].width).toBeGreaterThan(layout.measures[0].width);
    expect(layout.systems.length).toBeGreaterThan(1);
    expect(layout.systems.every((system) => system.width <= 520)).toBe(true);
  });

  it('rejects a measure whose exact required width exceeds the available width', () => {
    expect(() => layoutScore(
      { partId: 'P1', measures: [dense], links: [], playbackMeasures: [0] },
      { width: 120, minMeasureWidth: 240 }
    )).toThrowError(expect.objectContaining({
      name: 'RangeError',
      message: expect.stringMatching(/measure 2.*required 240.*available 120/i)
    }));
  });

  it('never returns a system wider than the available width', () => {
    const layout = layoutScore(
      { partId: 'P1', measures: [sparse, dense, sparse], links: [] },
      { width: 520, minMeasureWidth: 180, columnWidth: 34 }
    );

    expect(layout.systems.every((system) => system.width <= 520)).toBe(true);
  });

  it('places six TAB strings, fret labels, chords, and rests', () => {
    const chord = event('chord', r(0), r(1), [
      { string: 1, fret: 3 },
      { string: 4, fret: 10, dead: true }
    ], { chordSymbol: 'Fm' });
    const layout = layoutScore(
      { partId: 'P1', measures: [measure(1, [chord, rest('rest', r(1), r(1))])], links: [] },
      { width: 400, staffGap: 12 }
    );

    expect(layout.systems[0].staffLines).toHaveLength(6);
    expect(layout.systems[0].staffLines.map((line) => line.y)).toEqual([
      layout.systems[0].staffTop,
      layout.systems[0].staffTop + 12,
      layout.systems[0].staffTop + 24,
      layout.systems[0].staffTop + 36,
      layout.systems[0].staffTop + 48,
      layout.systems[0].staffTop + 60
    ]);
    expect(layout.events.find((item) => item.id === 'chord')).toMatchObject({
      kind: 'notes', chordSymbol: 'Fm', notes: [{ label: '3' }, { label: 'x' }]
    });
    expect(layout.events.find((item) => item.id === 'rest')).toMatchObject({ kind: 'rest', label: '𝜽' });
  });

  it('places zero-time grace notes before a following note at the same onset', () => {
    const grace = event('grace', r(2), r(0), [{ string: 1, fret: 15 }], { noteType: 'eighth' });
    const main = event('main', r(2), r(1, 2), [{ string: 1, fret: 17 }], { noteType: 'eighth' });

    const layout = layoutScore(
      { partId: 'P1', measures: [measure(71, [grace, main])], links: [] },
      { width: 240, staffGap: 12 }
    );

    expect(layout.events.find((item) => item.id === 'main').x
      - layout.events.find((item) => item.id === 'grace').x).toBeGreaterThanOrEqual(14);
    expect(findOverlaps(layout.hitBoxes)).toEqual([]);
  });

  it('uses one rhythmic column for a chord and keeps fret hit boxes separate', () => {
    const chord = event('chord', r(0), r(1), [
      { string: 1, fret: 12 },
      { string: 2, fret: 10 },
      { string: 6, fret: 1 }
    ]);
    const second = event('second', r(1), r(1), [{ string: 3, fret: 4 }]);
    const layout = layoutScore(
      { partId: 'P1', measures: [measure(1, [chord, second])], links: [] },
      { width: 500, staffGap: 14 }
    );
    const chordLayout = layout.events.find((item) => item.id === 'chord');
    const fretBoxes = layout.hitBoxes.filter((box) => box.kind === 'fret');

    expect(new Set(chordLayout.notes.map((note) => note.x)).size).toBe(1);
    expect(layout.measures[0].rhythmicColumns).toBe(2);
    expect(findOverlaps(fretBoxes)).toEqual([]);
  });

  it('creates stems, beams, dots, tuplets, and fermata records from durations', () => {
    const events = [
      event('e1', r(0), r(1, 2), [{ string: 2, fret: 5 }], { noteType: 'eighth', dots: 1, tuplet: { actual: 3, normal: 2 } }),
      event('e2', r(1, 2), r(1, 2), [{ string: 2, fret: 7 }], { noteType: 'eighth', tuplet: { actual: 3, normal: 2 } }),
      event('e3', r(1), r(1, 2), [{ string: 2, fret: 8 }], { noteType: 'eighth', tuplet: { actual: 3, normal: 2 }, fermata: true }),
      event('e4', r(3, 2), r(1, 4), [{ string: 3, fret: 9 }], { noteType: '16th' }),
      event('e5', r(7, 4), r(1, 4), [{ string: 3, fret: 10 }], { noteType: '16th' })
    ];
    const layout = layoutScore({ partId: 'P1', measures: [measure(1, events)], links: [] }, { width: 700 });

    expect(layout.events.find((item) => item.id === 'e1')).toMatchObject({ stem: expect.any(Object), dots: [{ x: expect.any(Number), y: expect.any(Number) }] });
    expect(layout.events.find((item) => item.id === 'e3').fermata).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(layout.beams.some((beam) => beam.level === 1 && beam.eventIds.includes('e1'))).toBe(true);
    expect(layout.beams.some((beam) => beam.level === 2 && beam.eventIds.includes('e4'))).toBe(true);
    expect(layout.tuplets).toEqual([expect.objectContaining({ label: '3', eventIds: ['e1', 'e2', 'e3'] })]);
  });

  it('does not beam notes across a rest', () => {
    const events = [
      event('left', r(0), r(1, 2)),
      rest('middle', r(1, 2), r(1, 2)),
      event('right', r(1), r(1, 2))
    ];
    const layout = layoutScore({ partId: 'P1', measures: [measure(1, events)], links: [] });

    expect(layout.beams).toEqual([]);
  });

  it('stacks overlapping technique links in lanes above the staff', () => {
    const events = [
      event('a', r(0), r(1)), event('b', r(1), r(1)),
      event('c', r(2), r(1)), event('d', r(3), r(1))
    ];
    const links = [
      { type: 'hammer-on', number: '1', startEventId: 'a', endEventId: 'd' },
      { type: 'slide', number: '1', startEventId: 'b', endEventId: 'c' },
      { type: 'tie', number: '1', startEventId: 'c', endEventId: 'd' }
    ];
    const layout = layoutScore({ partId: 'P1', measures: [measure(1, events)], links }, { width: 600 });

    expect(layout.links).toHaveLength(3);
    expect(layout.links[0].lane).not.toBe(layout.links[1].lane);
    expect(layout.links.every((link) => link.y < layout.systems[0].staffTop)).toBe(true);
    expect(new Set(layout.links.map((link) => `${link.systemIndex}:${link.lane}`)).size).toBeGreaterThan(1);
  });

  it('emits repeat, ending, and boundary barline records', () => {
    const first = measure(1, [rest('r1', r(0), r(4))], {
      barlines: [{ location: 'left', style: 'heavy-light', repeat: 'forward' }]
    });
    const ending = measure(2, [rest('r2', r(0), r(4))], {
      barlines: [{ location: 'right', style: 'light-heavy', repeat: 'backward', ending: { number: '1', type: 'stop' } }],
      endings: [{ number: '1', type: 'start' }]
    });
    const layout = layoutScore(
      { partId: 'P1', measures: [first, ending], links: [], playbackMeasures: [0, 1, 0] },
      { width: 500 }
    );

    expect(layout.barlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ measureIndex: 0, location: 'left', repeat: 'forward' }),
      expect.objectContaining({ measureIndex: 1, location: 'right', repeat: 'backward' })
    ]));
    expect(layout.measures[1].endings).toEqual([
      expect.objectContaining({
        number: '1', type: 'stop', startMeasureIndex: 1, endMeasureIndex: 1,
        startCap: true, stopCap: true, y: expect.any(Number)
      })
    ]);
  });

  it('lays out repeats, endings, and dots from a real MusicXML index', () => {
    const index = buildScoreIndex(parseMusicXml(techniquesFixture), 'P1');
    const layout = layoutScore(index, { width: 720 });

    expect(layout.barlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ measureIndex: 0, repeat: 'forward' }),
      expect.objectContaining({ measureIndex: 3, repeat: 'backward' })
    ]));
    expect(layout.measures[3].endings).toEqual([
      expect.objectContaining({ number: '1', type: 'stop', startCap: true, stopCap: true })
    ]);
    const dottedQuarter = layout.events.find((item) => item.id === index.measures[2].events[0].id);
    expect(dottedQuarter.dots).toHaveLength(1);
    expect(dottedQuarter.stem).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    expect(dottedQuarter.beamLevel).toBe(0);
    expect(layout.beams.flatMap((beam) => beam.eventIds)).not.toContain(dottedQuarter.id);
    const triplet = layout.events.slice(
      layout.events.findIndex((item) => item.id === index.measures[2].events[2].id),
      layout.events.findIndex((item) => item.id === index.measures[2].events[2].id) + 3
    );
    expect(triplet.map((item) => item.beamLevel)).toEqual([1, 1, 1]);
    expect(triplet.map((item) => item.beams[0].state)).toEqual(['begin', 'continue', 'end']);
  });

  it('prefers notation type and falls back through dots and tuplets for beam levels', () => {
    const doc = parseMusicXml(`<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>12</divisions></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>18</duration><type>eighth</type></note>
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration><type>16th</type></note>
        <note><pitch><step>E</step><octave>4</octave></pitch><duration>9</duration><dot/></note>
        <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>
        <note><rest/><duration>1</duration></note>
      </measure></part>
    </score-partwise>`);
    const layout = layoutScore(buildScoreIndex(doc, 'P1'), { width: 500 });

    expect(layout.events.map((item) => item.beamLevel)).toEqual([1, 2, 1, 1, undefined]);
  });

  it('gives half and quarter notes stems but reserves beams for eighth notes or shorter', () => {
    const events = [
      event('whole', r(0), r(4)),
      event('half', r(4), r(2)),
      event('quarter', r(6), r(1)),
      event('eighth-a', r(7), r(1, 2)),
      event('eighth-b', r(15, 2), r(1, 2)),
      rest('rest', r(8), r(1, 2))
    ];
    const layout = layoutScore(
      { partId: 'P1', measures: [measure(1, events)], links: [] },
      { width: 600 }
    );
    const byId = Object.fromEntries(layout.events.map((item) => [item.id, item]));

    expect(byId.whole.stem).toBeUndefined();
    expect(byId.half.stem).toEqual(expect.any(Object));
    expect(byId.quarter.stem).toEqual(expect.any(Object));
    expect(byId.rest.stem).toBeUndefined();
    expect(layout.beams).toEqual([
      expect.objectContaining({ level: 1, eventIds: ['eighth-a', 'eighth-b'] })
    ]);
  });

  it('groups explicit beam begin-to-end sequences independently', () => {
    const explicit = (id, onset, state) => event(
      id,
      onset,
      r(1, 2),
      [{ string: 2, fret: 5, noteType: 'eighth', beams: [{ number: 1, state }] }],
      { noteType: 'eighth', beams: [{ number: 1, state }] }
    );
    const layout = layoutScore({
      partId: 'P1',
      measures: [measure(1, [
        explicit('a', r(0), 'begin'), explicit('b', r(1, 2), 'end'),
        explicit('c', r(1), 'begin'), explicit('d', r(3, 2), 'end')
      ])],
      links: []
    });

    expect(layout.beams).toEqual([
      expect.objectContaining({ kind: 'beam', level: 1, eventIds: ['a', 'b'] }),
      expect.objectContaining({ kind: 'beam', level: 1, eventIds: ['c', 'd'] })
    ]);
  });

  it('groups multiple explicit levels separately and emits directional hooks', () => {
    const layout = layoutScore({
      partId: 'P1',
      measures: [measure(1, [
        event('a', r(0), r(1, 4), [], {
          noteType: '16th', beams: [{ number: 1, state: 'begin' }, { number: 2, state: 'begin' }]
        }),
        event('b', r(1, 4), r(1, 4), [], {
          noteType: '16th', beams: [{ number: 1, state: 'continue' }, { number: 2, state: 'end' }]
        }),
        event('c', r(1, 2), r(1, 4), [], {
          noteType: '16th', beams: [{ number: 1, state: 'end' }, { number: 2, state: 'forward hook' }]
        }),
        event('d', r(3, 4), r(1, 4), [], {
          noteType: '16th', beams: [{ number: 2, state: 'backward hook' }]
        })
      ])],
      links: []
    });

    expect(layout.beams).toEqual([
      expect.objectContaining({ kind: 'beam', level: 1, eventIds: ['a', 'b', 'c'] }),
      expect.objectContaining({ kind: 'beam', level: 2, eventIds: ['a', 'b'] }),
      expect.objectContaining({ kind: 'hook', level: 2, direction: 'forward', eventIds: ['c'] }),
      expect.objectContaining({ kind: 'hook', level: 2, direction: 'backward', eventIds: ['d'] })
    ]);
  });

  it('handles unmatched explicit beam states deterministically', () => {
    const index = {
      partId: 'P1',
      measures: [measure(1, [
        event('orphan-end', r(0), r(1, 2), [], {
          noteType: 'eighth', beams: [{ number: 1, state: 'end' }]
        }),
        event('open-begin', r(1, 2), r(1, 2), [], {
          noteType: 'eighth', beams: [{ number: 1, state: 'begin' }]
        })
      ])],
      links: []
    };

    const first = layoutScore(index);
    const second = layoutScore(index);

    expect(first.beams).toEqual([
      expect.objectContaining({ eventIds: ['orphan-end'], malformed: 'unmatched-end' }),
      expect.objectContaining({ eventIds: ['open-begin'], open: true })
    ]);
    expect(first).toEqual(second);
  });

  it('pairs a multi-measure ending and splits it into system segments', () => {
    const measures = [1, 2, 3, 4].map((number) => measure(number, [rest(`r${number}`, r(0), r(4))]));
    measures[0].endings = [{ number: '1', type: 'start' }];
    measures[3].endings = [{ number: '1', type: 'stop' }];

    const layout = layoutScore({ partId: 'P1', measures, links: [] }, { width: 360 });
    const segments = layout.measures.flatMap((item) => item.endings);

    expect(segments).toEqual([
      expect.objectContaining({
        number: '1', systemIndex: 0, startMeasureIndex: 0, endMeasureIndex: 1,
        x1: 0, x2: 360, label: '1', startCap: true, stopCap: false,
        continuationStart: false, continuationEnd: true
      }),
      expect.objectContaining({
        number: '1', systemIndex: 1, startMeasureIndex: 2, endMeasureIndex: 3,
        x1: 0, x2: 360, startCap: false, stopCap: true,
        continuationStart: true, continuationEnd: false
      })
    ]);
  });

  it('uses no stop hook for discontinue and handles nested or unmatched endings deterministically', () => {
    const measures = [1, 2, 3].map((number) => measure(number, [rest(`r${number}`, r(0), r(4))]));
    measures[0].endings = [{ number: '1', type: 'start' }, { number: '2', type: 'start' }];
    measures[1].endings = [{ number: '2', type: 'stop' }, { number: '9', type: 'stop' }];
    measures[2].endings = [{ number: '1', type: 'discontinue' }];
    const index = { partId: 'P1', measures, links: [] };

    const first = layoutScore(index, { width: 720 });
    const second = layoutScore(index, { width: 720 });
    const endings = first.measures.flatMap((item) => item.endings);

    expect(endings).toEqual(expect.arrayContaining([
      expect.objectContaining({ number: '1', type: 'discontinue', stopCap: false, discontinue: true }),
      expect.objectContaining({ number: '2', type: 'stop', stopCap: true }),
      expect.objectContaining({ number: '9', malformed: 'unmatched-stop' })
    ]));
    expect(first).toEqual(second);
  });

  it('reuses one lane for touching endings but separates overlapping endings', () => {
    const measures = [1, 2].map((number) => measure(number, [rest(`r${number}`, r(0), r(4))]));
    measures[0].endings = [
      { number: '1', type: 'start' }, { number: '1', type: 'stop' },
      { number: '3', type: 'start' }
    ];
    measures[1].endings = [
      { number: '2', type: 'start' }, { number: '2', type: 'stop' },
      { number: '3', type: 'stop' }
    ];

    const layout = layoutScore({ partId: 'P1', measures, links: [] }, { width: 360 });
    const endings = layout.measures.flatMap((item) => item.endings);
    const first = endings.find((ending) => ending.number === '1');
    const second = endings.find((ending) => ending.number === '2');
    const overlapping = endings.find((ending) => ending.number === '3');

    expect([first.x1, first.x2, second.x1, second.x2]).toEqual([0, 180, 180, 360]);
    expect(second.lane).toBe(first.lane);
    expect(second.y).toBe(first.y);
    expect(overlapping.lane).not.toBe(first.lane);
  });

  it('preserves malformed ending markers with source values and position', () => {
    const badMeasure = measure(7, [rest('r7', r(0), r(4))], {
      endings: [
        { number: '', type: 'start' },
        { number: '3', type: 'mystery' }
      ]
    });
    const index = { partId: 'P1', measures: [badMeasure], links: [] };

    const first = layoutScore(index, { width: 360 });
    const second = layoutScore(index, { width: 360 });

    expect(first.measures[0].endings).toEqual([
      expect.objectContaining({
        malformed: 'missing-number', originalNumber: '', originalType: 'start',
        startMeasureIndex: 0, endMeasureIndex: 0, x1: 0, x2: 180
      }),
      expect.objectContaining({
        malformed: 'unknown-type', originalNumber: '3', originalType: 'mystery',
        startMeasureIndex: 0, endMeasureIndex: 0, x1: 0, x2: 180
      })
    ]);
    expect(Number.isFinite(first.totalHeight)).toBe(true);
    expect(first).toEqual(second);
  });

  it('shares collision-free annotation lanes and grows system geometry dynamically', () => {
    const annotatedEvents = [
      event('a', r(0), r(1, 2), [{ string: 2, fret: 5 }], { noteType: 'eighth', tuplet: { actual: 3, normal: 2 }, fermata: true, chordSymbol: 'Fm' }),
      event('b', r(1, 2), r(1, 2), [{ string: 2, fret: 7 }], { noteType: 'eighth', tuplet: { actual: 3, normal: 2 } }),
      event('c', r(1), r(1, 2), [{ string: 2, fret: 8 }], { noteType: 'eighth', tuplet: { actual: 3, normal: 2 } })
    ];
    const firstMeasure = measure(1, annotatedEvents, {
      endings: [{ number: '1', type: 'start' }, { number: '1', type: 'stop' }]
    });
    const secondMeasure = measure(2, [rest('rest-2', r(0), r(4))]);
    const links = Array.from({ length: 6 }, (_, index) => ({
      type: `technique-${index}`,
      number: '1',
      startEventId: 'a',
      endEventId: 'c'
    }));
    const index = { partId: 'P1', measures: [firstMeasure, secondMeasure], links };

    const crowded = layoutScore(index, { width: 180, systemTopPadding: 24, techniqueLaneHeight: 16 });
    const plain = layoutScore(
      { partId: 'P1', measures: [measure(1, annotatedEvents), secondMeasure], links: [] },
      { width: 180, systemTopPadding: 24, techniqueLaneHeight: 16 }
    );
    const boxes = crowded.hitBoxes.filter((box) => box.kind === 'annotation');

    expect(crowded.systems[0].annotationLaneCount).toBeGreaterThanOrEqual(9);
    expect(findOverlaps(boxes.filter((box) => box.systemIndex === 0))).toEqual([]);
    expect(Math.min(...boxes.map((box) => box.y))).toBeGreaterThanOrEqual(crowded.systems[0].y);
    expect(crowded.systems[1].y).toBeGreaterThanOrEqual(crowded.systems[0].y + crowded.systems[0].height);
    expect(crowded.totalHeight).toBeGreaterThan(plain.totalHeight);
  });

  it('is deterministic and does not mutate its input', () => {
    const index = {
      partId: 'P1',
      measures: [sparse, dense],
      links: [{ type: 'slide', number: '1', startEventId: 'm1:e1', endEventId: 'm2:e1' }],
      playbackMeasures: [0, 1]
    };
    const before = structuredClone(index);

    const first = layoutScore(index, { width: 460 });
    const second = layoutScore(index, { width: 460 });

    expect(first).toEqual(second);
    expect(index).toEqual(before);
  });
});
