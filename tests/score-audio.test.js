// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  buildPlaybackPlan, createLookaheadPlaybackController, createScoreHighlighter
} from '../src/score-audio.js';
import { parseMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';

const q = (n, d = 1) => ({ n, d });

function note(id, onset, duration, notes) {
  return { id, kind: 'notes', onset: q(onset), duration: q(duration), notes };
}

function scoreIndex(overrides = {}) {
  return {
    measures: [
      {
        number: '1', beats: 4, beatType: 4,
        events: [
          note('a', 0, 1, [{ string: 6, fret: 1, pitch: { step: 'F', octave: 2 } }]),
          note('b', 1, 1, [
            { string: 5, fret: 3, pitch: { step: 'C', octave: 3 } },
            { string: 4, fret: 3, pitch: { step: 'F', octave: 3 }, ghost: true }
          ])
        ]
      },
      {
        number: '2', beats: 4, beatType: 4,
        events: [note('c', 0, 2, [{ string: 3, fret: 2, pitch: { step: 'A', octave: 3 }, bend: q(1, 2) }])]
      }
    ],
    links: [],
    playbackMeasures: [0, 1, 0],
    ...overrides
  };
}

describe('buildPlaybackPlan', () => {
  it('expands repeat occurrences onto an absolute quarter/second timeline and keeps chords simultaneous', () => {
    const plan = buildPlaybackPlan(scoreIndex(), { bpm: 120 });

    expect(plan.durationQuarter).toBe(12);
    expect(plan.durationSeconds).toBe(6);
    expect(plan.measureNumbers).toEqual(['1', '2', '1']);
    expect(plan.events).toBe(plan.notes);
    expect(plan.notes.map((entry) => [entry.eventId, entry.occurrence, entry.startQuarter, entry.startSeconds]))
      .toEqual([
        ['a', 0, 0, 0], ['b', 0, 1, 0.5], ['b', 0, 1, 0.5],
        ['c', 0, 4, 2],
        ['a', 1, 8, 4], ['b', 1, 9, 4.5], ['b', 1, 9, 4.5]
      ]);
    expect(plan.notes.map((entry) => entry.midi)).toEqual([41, 48, 53, 57, 41, 48, 53]);
    expect(plan.notes[2].velocity).toBeLessThan(plan.notes[1].velocity);
    expect(plan.notes[3].bendSemitones).toBe(0.5);
    expect(plan.notes[0]).toMatchObject({ measureIndex: 0, measureNumber: '1', string: 6, key: 'a@0:0' });
    expect(plan.tempoSource).toBe('explicit-bpm');
  });

  it('rejects invalid BPM values', () => {
    expect(() => buildPlaybackPlan(scoreIndex(), { bpm: 0 })).toThrow(/BPM/);
    expect(() => buildPlaybackPlan(scoreIndex(), { bpm: Number.NaN })).toThrow(/BPM/);
  });

  it('sustains a tie chain as one voice without restriking, separately for each repeat occurrence', () => {
    const index = scoreIndex({
      measures: [{
        number: '1', beats: 4, beatType: 4,
        events: [
          note('start', 0, 2, [{ string: 1, fret: 1, pitch: { step: 'F', octave: 4 } }]),
          note('end', 2, 2, [{ string: 1, fret: 1, pitch: { step: 'F', octave: 4 } }])
        ]
      }],
      links: [{ type: 'tie', startEventId: 'start', endEventId: 'end' }],
      playbackMeasures: [0, 0]
    });

    const plan = buildPlaybackPlan(index, { bpm: 60 });

    expect(plan.notes).toHaveLength(2);
    expect(plan.notes.map((entry) => [entry.eventId, entry.occurrence, entry.durationQuarter, entry.key]))
      .toEqual([['start', 0, 4, 'start@0:0'], ['start', 1, 4, 'start@1:0']]);
  });

  it('ties a stop to the nearest unmatched start occurrence', () => {
    const index = scoreIndex({
      measures: [
        { number: '1', beats: 4, beatType: 4, events: [
          note('start', 0, 4, [{ string: 1, fret: 0, pitch: { step: 'E', octave: 4 } }])
        ] },
        { number: '2', beats: 4, beatType: 4, events: [
          note('stop', 0, 1, [{ string: 1, fret: 0, pitch: { step: 'E', octave: 4 } }])
        ] }
      ],
      links: [{ type: 'tie', startEventId: 'start', endEventId: 'stop' }],
      playbackMeasures: [0, 0, 1]
    });

    const plan = buildPlaybackPlan(index, { bpm: 60 });

    expect(plan.notes.map((entry) => [entry.eventId, entry.occurrence, entry.durationQuarter]))
      .toEqual([['start', 0, 4], ['start', 1, 5]]);
  });

  it('does not connect a stale tie start across a backward repeat jump', () => {
    const index = scoreIndex({
      measures: [
        { number: '1', beats: 4, beatType: 4, events: [
          note('filler', 0, 1, [{ string: 2, fret: 0, pitch: { step: 'B', octave: 3 } }])
        ] },
        { number: '2', beats: 4, beatType: 4, events: [
          note('start', 0, 1, [{ string: 1, fret: 0, pitch: { step: 'E', octave: 4 } }])
        ] },
        { number: '3', beats: 4, beatType: 4, events: [
          note('stop', 0, 1, [{ string: 1, fret: 0, pitch: { step: 'E', octave: 4 } }])
        ] }
      ],
      links: [{ type: 'tie', startEventId: 'start', endEventId: 'stop' }],
      playbackMeasures: [0, 1, 0, 2]
    });

    const plan = buildPlaybackPlan(index, { bpm: 60 });

    expect(plan.notes.find((entry) => entry.eventId === 'start').durationQuarter).toBe(1);
    expect(plan.notes.some((entry) => entry.eventId === 'stop')).toBe(true);
  });

  it('advances repeated pickup occurrences by actual implicit duration', () => {
    const doc = parseMusicXml(`<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list>
      <part id="P1">
        <measure number="0" implicit="yes">
          <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
          <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
        </measure>
        <measure number="1"><note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration></note></measure>
      </part>
    </score-partwise>`);
    const index = buildScoreIndex(doc, 'P1');
    index.playbackMeasures = [0, 1, 0, 1];

    const plan = buildPlaybackPlan(index, { bpm: 60 });

    expect(plan.notes.map((entry) => entry.startQuarter)).toEqual([0, 1, 5, 6]);
    expect(plan.durationQuarter).toBe(10);
  });

  it('emits short percussive dead notes and link metadata for legato techniques', () => {
    const index = scoreIndex({
      measures: [{
        number: '7', beats: 4, beatType: 4,
        events: [
          note('x', 0, 2, [{ string: 2, fret: 3, pitch: { step: 'D', octave: 4 }, dead: true }]),
          note('y', 2, 2, [{ string: 2, fret: 5, pitch: { step: 'E', octave: 4 } }])
        ]
      }],
      links: [
        { type: 'hammer-on', startEventId: 'x', endEventId: 'y' },
        { type: 'slide', startEventId: 'x', endEventId: 'y' }
      ],
      playbackMeasures: [0]
    });

    const plan = buildPlaybackPlan(index, { bpm: 60 });

    expect(plan.notes[0]).toMatchObject({ muted: true, durationSeconds: 0.12 });
    expect(plan.notes[0].legato).toEqual([
      { type: 'hammer-on', targetEventId: 'y' },
      { type: 'slide', targetEventId: 'y', targetMidi: 64 }
    ]);
  });

  it('only creates rest gates for voices that actually overlap the rest', () => {
    const index = scoreIndex({
      measures: [{
        number: '1', beats: 4, beatType: 4,
        events: [
          note('long', 0, 4, [{ string: 6, fret: 1, pitch: { step: 'F', octave: 2 } }]),
          note('short', 0, 1, [{ string: 5, fret: 1, pitch: { step: 'A', alter: -1, octave: 2 } }]),
          { id: 'rest', kind: 'rest', onset: q(2), duration: q(1) }
        ]
      }], links: [], playbackMeasures: [0]
    });

    const plan = buildPlaybackPlan(index, { bpm: 60 });

    expect(plan.gates).toEqual([{ atQuarter: 2, atSeconds: 2, key: 'long@0:0', string: 6 }]);
    expect(plan.events.find((entry) => entry.endsAtRest)).toMatchObject({
      eventId: 'long', gateSeconds: 0.12
    });
  });

  it('uses an explicit playback-measure slice and creates deterministic quarter-note metronome clicks', () => {
    const plan = buildPlaybackPlan(scoreIndex(), { bpm: 120, playbackMeasures: [1], metronome: true });

    expect(plan.playbackMeasures).toEqual([1]);
    expect(plan.notes.map((entry) => entry.eventId)).toEqual(['c']);
    expect(plan.clicks).toEqual([
      { atSeconds: 0, accent: true }, { atSeconds: 0.5, accent: false },
      { atSeconds: 1, accent: false }, { atSeconds: 1.5, accent: false }
    ]);
  });
});

describe('createLookaheadPlaybackController', () => {
  function harness() {
    let now = 10;
    let nextTimerId = 1;
    const timers = new Map();
    const calls = { scheduled: [], stopped: [], highlighted: [], cleared: 0, ended: 0 };
    const setTimer = (callback, delay) => {
      const id = nextTimerId++;
      timers.set(id, { callback, due: now + delay / 1000 });
      return id;
    };
    const clearTimer = (id) => timers.delete(id);
    const advance = (seconds) => {
      const target = now + seconds;
      while (true) {
        const ready = [...timers.entries()].filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!ready) break;
        timers.delete(ready[0]);
        now = ready[1].due;
        ready[1].callback();
      }
      now = target;
    };
    const voiceAdapter = {
      schedule(entry, at) { const handle = { entry, at }; calls.scheduled.push(handle); return handle; },
      stop(handle, at) { calls.stopped.push({ handle, at }); }
    };
    return { clock: () => now, setTimer, clearTimer, advance, voiceAdapter, calls, timers };
  }

  const plan = {
    durationSeconds: 0.8,
    notes: [
      { key: 'a@0:0', eventId: 'a', occurrence: 0, startSeconds: 0, durationSeconds: 0.5 },
      { key: 'b@0:0', eventId: 'b', occurrence: 0, startSeconds: 0.3, durationSeconds: 0.5 }
    ],
    gates: []
  };

  it('schedules each note once inside the 250ms horizon and highlights at sounding time', () => {
    const h = harness();
    const controller = createLookaheadPlaybackController({
      plan, clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer,
      voiceAdapter: h.voiceAdapter,
      onHighlight: (id, occurrence) => h.calls.highlighted.push([id, occurrence]),
      onClearHighlight: () => { h.calls.cleared += 1; }, onEnd: () => { h.calls.ended += 1; }
    });

    controller.start({ delaySeconds: 0.1 });
    expect(h.calls.scheduled.map((voice) => voice.entry.key)).toEqual(['a@0:0']);
    h.advance(0.22);
    expect(h.calls.scheduled.map((voice) => voice.entry.key)).toEqual(['a@0:0', 'b@0:0']);
    expect(h.calls.highlighted).toEqual([['a', 0]]);
    h.advance(0.18);
    expect(h.calls.highlighted).toEqual([['a', 0], ['b', 0]]);
    expect(new Set(h.calls.scheduled.map((voice) => voice.entry.key)).size).toBe(2);
  });

  it('highlights a simultaneous chord occurrence only once', () => {
    const h = harness();
    const chordPlan = {
      durationSeconds: 1, gates: [],
      notes: [
        { key: 'chord@0:0', eventKey: 'chord@0', eventId: 'chord', occurrence: 0, startSeconds: 0, durationSeconds: 1 },
        { key: 'chord@0:1', eventKey: 'chord@0', eventId: 'chord', occurrence: 0, startSeconds: 0, durationSeconds: 1 }
      ]
    };
    const controller = createLookaheadPlaybackController({
      plan: chordPlan, clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer,
      voiceAdapter: h.voiceAdapter,
      onHighlight: (id, occurrence) => h.calls.highlighted.push([id, occurrence])
    });

    controller.start({ delaySeconds: 0 });
    h.advance(0);

    expect(h.calls.scheduled).toHaveLength(2);
    expect(h.calls.highlighted).toEqual([['chord', 0]]);
  });

  it('stop cancels timers, stops scheduled voices, clears highlights, and prevents end callback', () => {
    const h = harness();
    const controller = createLookaheadPlaybackController({
      plan, clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer,
      voiceAdapter: h.voiceAdapter,
      onHighlight: () => {}, onClearHighlight: () => { h.calls.cleared += 1; },
      onEnd: () => { h.calls.ended += 1; }
    });

    controller.start({ delaySeconds: 0 });
    controller.stop();
    h.advance(2);

    expect(h.calls.stopped).toHaveLength(1);
    expect(h.calls.cleared).toBe(1);
    expect(h.calls.ended).toBe(0);
    expect(h.timers.size).toBe(0);
    expect(controller.isPlaying()).toBe(false);
  });

  it('cleans up naturally at the end', () => {
    const h = harness();
    const controller = createLookaheadPlaybackController({
      plan, clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer,
      voiceAdapter: h.voiceAdapter,
      onHighlight: () => {}, onClearHighlight: () => { h.calls.cleared += 1; },
      onEnd: () => { h.calls.ended += 1; }
    });

    controller.start({ delaySeconds: 0 });
    h.advance(1);

    expect(h.calls.ended).toBe(1);
    expect(h.calls.cleared).toBe(1);
    expect(controller.isPlaying()).toBe(false);
  });

  it('loops from the exact plan boundary and schedules metronome clicks through the same horizon', () => {
    const h = harness();
    const clicked = [];
    const controller = createLookaheadPlaybackController({
      plan: { ...plan, durationSeconds: 0.4, clicks: [{ atSeconds: 0, accent: true }] },
      clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer,
      voiceAdapter: h.voiceAdapter, clickAdapter: { schedule: (at, accent) => clicked.push([at, accent]) },
      loop: true
    });

    controller.start({ delaySeconds: 0 });
    h.advance(0.41);

    expect(h.calls.scheduled.filter((voice) => voice.entry.key === 'a@0:0')).toHaveLength(2);
    expect(clicked).toEqual([[10, true], [10.4, true]]);
    expect(controller.isPlaying()).toBe(true);
    controller.stop();
  });

  it('finishes an empty zero-duration loop without creating a zero-delay timer cycle', () => {
    const h = harness();
    const controller = createLookaheadPlaybackController({
      plan: { durationSeconds: 0, notes: [], gates: [], clicks: [] },
      clock: h.clock, setTimer: h.setTimer, clearTimer: h.clearTimer,
      voiceAdapter: h.voiceAdapter, loop: true,
      onEnd: () => { h.calls.ended += 1; }
    });

    controller.start({ delaySeconds: 0 });

    expect(controller.isPlaying()).toBe(false);
    expect(h.calls.ended).toBe(1);
    expect(h.timers.size).toBe(0);
  });
});

describe('createScoreHighlighter', () => {
  it('tracks repeat occurrence and restores pre-existing SVG classes when cleared', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><g data-event-id="a" class="score-event selected"></g><g data-event-id="b" class="score-event"></g></svg>';
    const highlighter = createScoreHighlighter(host);

    highlighter.highlight('a', 2);
    expect(host.querySelector('[data-event-id="a"]').classList.contains('play')).toBe(true);
    expect(host.querySelector('[data-event-id="a"]').dataset.playbackOccurrence).toBe('2');
    highlighter.highlight('b', 0);
    expect(host.querySelector('[data-event-id="a"]').className.baseVal).toBe('score-event selected');
    highlighter.clear();
    expect(host.querySelector('[data-event-id="b"]').className.baseVal).toBe('score-event');
    expect(host.querySelector('[data-playback-occurrence]')).toBeNull();
  });
});
