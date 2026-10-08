const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function rationalNumber(value) {
  if (!value || !Number.isFinite(value.n) || !Number.isFinite(value.d) || value.d === 0) return 0;
  return value.n / value.d;
}

function pitchMidi(pitch) {
  const pitchClass = PITCH_CLASS[pitch?.step];
  if (pitchClass === undefined || !Number.isFinite(pitch?.octave)) return null;
  const alter = Number.isFinite(pitch.alter) ? pitch.alter : 0;
  return (pitch.octave + 1) * 12 + pitchClass + alter;
}

function measureQuarters(measure) {
  const normalized = rationalNumber(measure?.playbackDuration || measure?.duration);
  if (normalized > 0) return normalized;
  const beats = Number(measure?.beats);
  const beatType = Number(measure?.beatType);
  return beats > 0 && beatType > 0 ? beats * 4 / beatType : 4;
}

function occurrenceKey(eventId, occurrence) {
  return `${eventId}@${occurrence}`;
}

export function createScoreHighlighter(host) {
  let active = [];
  const clear = () => {
    for (const element of active) {
      element.classList.remove('play');
      delete element.dataset.playbackOccurrence;
    }
    active = [];
  };
  const highlight = (eventId, occurrence) => {
    clear();
    active = [...host.querySelectorAll('[data-event-id]')]
      .filter((element) => element.dataset.eventId === eventId);
    for (const element of active) {
      element.classList.add('play');
      element.dataset.playbackOccurrence = String(occurrence);
    }
    active[0]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  return { highlight, clear };
}

function pairLinkOccurrences(rawEvents, link) {
  const waiting = [];
  const pairs = [];
  let playbackRun = null;
  for (const event of rawEvents) {
    if (event.playbackRun !== playbackRun) {
      waiting.length = 0;
      playbackRun = event.playbackRun;
    }
    if (event.eventId === link.startEventId) waiting.push(event);
    if (event.eventId === link.endEventId && waiting.length > 0) {
      pairs.push([waiting.pop(), event]);
    }
  }
  return pairs;
}

function matchingNote(start, end, startIndex) {
  const sameString = end.notes.find((note) => note.string === start.string);
  return sameString || end.notes[startIndex] || end.notes[0] || null;
}

/**
 * ScoreIndex를 AudioContext와 무관한 절대 재생 시간표로 변환한다.
 * 현재 ScoreIndex는 direction tempo를 보존하지 않으므로 명시한 단일 BPM만 사용한다.
 */
export function buildPlaybackPlan(index, {
  bpm = 84,
  ghostVelocity = 0.42,
  velocity = 0.72,
  playbackMeasures: requestedPlaybackMeasures,
  metronome = false
} = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('BPM must be a positive finite number');
  if (!index || !Array.isArray(index.measures)) throw new Error('ScoreIndex measures are required');

  const secondsPerQuarter = 60 / bpm;
  const playbackMeasures = Array.isArray(requestedPlaybackMeasures)
    ? requestedPlaybackMeasures
    : Array.isArray(index.playbackMeasures)
      ? index.playbackMeasures : index.measures.map((_, measureIndex) => measureIndex);
  const eventOccurrences = new Map();
  const rawEvents = [];
  const rests = [];
  let absoluteQuarter = 0;
  let playbackRun = 0;
  let previousMeasureIndex = null;

  for (const measureIndex of playbackMeasures) {
    if (previousMeasureIndex !== null && measureIndex <= previousMeasureIndex) playbackRun += 1;
    const measure = index.measures[measureIndex];
    if (!measure) continue;
    for (const event of measure.events || []) {
      const occurrence = eventOccurrences.get(event.id) || 0;
      eventOccurrences.set(event.id, occurrence + 1);
      const record = {
        source: event,
        eventId: event.id,
        occurrence,
        eventKey: occurrenceKey(event.id, occurrence),
        measureIndex,
        measureNumber: measure.number,
        playbackRun,
        startQuarter: absoluteQuarter + rationalNumber(event.onset),
        durationQuarter: rationalNumber(event.duration),
        notes: event.notes || []
      };
      if (event.kind === 'rest') rests.push(record);
      else rawEvents.push(record);
    }
    absoluteQuarter += measureQuarters(measure);
    previousMeasureIndex = measureIndex;
  }

  const rawNotes = [];
  const rawNoteByKey = new Map();
  for (const event of rawEvents) {
    event.notes.forEach((note, noteIndex) => {
      const midi = pitchMidi(note.pitch);
      if (midi === null) return;
      const key = `${event.eventKey}:${noteIndex}`;
      const entry = {
        key,
        eventKey: event.eventKey,
        eventId: event.eventId,
        occurrence: event.occurrence,
        noteIndex,
        measureIndex: event.measureIndex,
        measureNumber: event.measureNumber,
        string: note.string,
        fret: note.fret,
        midi,
        startQuarter: event.startQuarter,
        durationQuarter: event.durationQuarter,
        velocity: note.ghost ? ghostVelocity : velocity,
        ghost: Boolean(note.ghost),
        muted: Boolean(note.dead),
        bendSemitones: rationalNumber(note.bend),
        legato: []
      };
      if (entry.bendSemitones) entry.technique = 'bend';
      rawNotes.push(entry);
      rawNoteByKey.set(key, entry);
    });
  }

  const parents = new Map();
  const find = (key) => {
    const parent = parents.get(key);
    if (!parent || parent === key) return key;
    const root = find(parent);
    parents.set(key, root);
    return root;
  };
  const tieTargets = new Set();

  for (const link of index.links || []) {
    for (const [startEvent, endEvent] of pairLinkOccurrences(rawEvents, link)) {
      startEvent.notes.forEach((startNote, startIndex) => {
        const endNote = matchingNote(startNote, endEvent, startIndex);
        if (!endNote) return;
        const endIndex = endEvent.notes.indexOf(endNote);
        const startKey = `${startEvent.eventKey}:${startIndex}`;
        const endKey = `${endEvent.eventKey}:${endIndex}`;
        const startEntry = rawNoteByKey.get(startKey);
        const endEntry = rawNoteByKey.get(endKey);
        if (!startEntry || !endEntry) return;
        if (link.type === 'tie') {
          parents.set(endKey, find(startKey));
          tieTargets.add(endKey);
          return;
        }
        const metadata = { type: link.type, targetEventId: endEvent.eventId };
        if (link.type === 'slide') metadata.targetMidi = endEntry.midi;
        startEntry.legato.push(metadata);
      });
    }
  }

  const notes = rawNotes.filter((entry) => !tieTargets.has(entry.key));
  const rootByKey = new Map(notes.map((entry) => [entry.key, entry]));
  for (const targetKey of tieTargets) {
    const target = rawNoteByKey.get(targetKey);
    const root = rootByKey.get(find(targetKey));
    if (!target || !root) continue;
    root.durationQuarter = Math.max(
      root.durationQuarter,
      target.startQuarter + target.durationQuarter - root.startQuarter
    );
  }

  for (const entry of notes) {
    entry.startSeconds = entry.startQuarter * secondsPerQuarter;
    entry.durationSeconds = entry.muted
      ? Math.min(0.12, entry.durationQuarter * secondsPerQuarter)
      : entry.durationQuarter * secondsPerQuarter;
  }

  const gates = [];
  for (const rest of rests) {
    const activeByString = new Map();
    for (const entry of notes) {
      if (entry.startQuarter >= rest.startQuarter) continue;
      if (entry.startQuarter + entry.durationQuarter <= rest.startQuarter) continue;
      const current = activeByString.get(entry.string);
      if (!current || current.startQuarter < entry.startQuarter) activeByString.set(entry.string, entry);
    }
    for (const entry of activeByString.values()) {
      entry.endsAtRest = true;
      entry.gateSeconds = 0.12;
      gates.push({
        atQuarter: rest.startQuarter,
        atSeconds: rest.startQuarter * secondsPerQuarter,
        key: entry.key,
        string: entry.string
      });
    }
  }

  const clicks = [];
  if (metronome) {
    let measureStart = 0;
    for (const measureIndex of playbackMeasures) {
      const duration = measureQuarters(index.measures[measureIndex]);
      for (let quarter = 0; quarter < duration; quarter += 1) {
        clicks.push({ atSeconds: (measureStart + quarter) * secondsPerQuarter, accent: quarter === 0 });
      }
      measureStart += duration;
    }
  }

  const playbackNotes = notes.sort((a, b) => a.startQuarter - b.startQuarter || a.noteIndex - b.noteIndex);
  return {
    bpm,
    tempoSource: 'explicit-bpm',
    secondsPerQuarter,
    durationQuarter: absoluteQuarter,
    durationSeconds: absoluteQuarter * secondsPerQuarter,
    playbackMeasures: playbackMeasures.slice(),
    measureNumbers: playbackMeasures.map((measureIndex) => index.measures[measureIndex]?.number),
    notes: playbackNotes,
    events: playbackNotes,
    gates: gates.sort((a, b) => a.atQuarter - b.atQuarter),
    clicks
  };
}

/** 주입 가능한 250ms/70ms lookahead 스케줄러. */
export function createLookaheadPlaybackController({
  plan,
  clock,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  voiceAdapter,
  clickAdapter = null,
  onHighlight = () => {},
  onClearHighlight = () => {},
  onEnd = () => {},
  horizonSeconds = 0.25,
  tickMilliseconds = 70,
  loop = false
}) {
  if (!plan || !Array.isArray(plan.notes)) throw new Error('Playback plan is required');
  if (typeof clock !== 'function') throw new Error('Playback clock is required');
  if (!voiceAdapter?.schedule || !voiceAdapter?.stop) throw new Error('Voice adapter is required');

  let playing = false;
  let startTime = 0;
  let noteCursor = 0;
  let gateCursor = 0;
  let clickCursor = 0;
  let tickTimer = null;
  let endTimer = null;
  const highlightTimers = new Set();
  const gateTimers = new Set();
  const voices = new Map();
  const scheduledHighlights = new Set();

  const scheduleTimer = (collection, callback, delayMs) => {
    let id;
    id = setTimer(() => {
      collection.delete(id);
      callback();
    }, Math.max(0, delayMs));
    collection.add(id);
    return id;
  };

  const finish = () => {
    if (!playing) return;
    if (loop) {
      if (tickTimer !== null) clearTimer(tickTimer);
      tickTimer = null;
      highlightTimers.forEach(clearTimer);
      gateTimers.forEach(clearTimer);
      highlightTimers.clear();
      gateTimers.clear();
      voices.clear();
      scheduledHighlights.clear();
      onClearHighlight();
      noteCursor = 0;
      gateCursor = 0;
      clickCursor = 0;
      startTime += plan.durationSeconds;
      tick();
      endTimer = setTimer(finish, Math.max(0, (startTime + plan.durationSeconds - clock()) * 1000));
      return;
    }
    playing = false;
    if (tickTimer !== null) clearTimer(tickTimer);
    tickTimer = null;
    highlightTimers.forEach(clearTimer);
    gateTimers.forEach(clearTimer);
    highlightTimers.clear();
    gateTimers.clear();
    voices.clear();
    onClearHighlight();
    onEnd();
  };

  const tick = () => {
    if (!playing) return;
    const now = clock();
    const horizon = now + horizonSeconds;
    while (noteCursor < plan.notes.length) {
      const entry = plan.notes[noteCursor];
      const at = startTime + entry.startSeconds;
      if (at > horizon) break;
      noteCursor += 1;
      const handle = voiceAdapter.schedule(entry, at);
      voices.set(entry.key, handle);
      const highlightKey = entry.eventKey || occurrenceKey(entry.eventId, entry.occurrence);
      if (!scheduledHighlights.has(highlightKey)) {
        scheduledHighlights.add(highlightKey);
        scheduleTimer(highlightTimers, () => {
          if (playing) onHighlight(entry.eventId, entry.occurrence);
        }, (at - now) * 1000);
      }
    }
    while (gateCursor < (plan.gates || []).length) {
      const gate = plan.gates[gateCursor];
      const at = startTime + gate.atSeconds;
      if (at > horizon) break;
      gateCursor += 1;
      scheduleTimer(gateTimers, () => {
        const handle = voices.get(gate.key);
        if (playing && handle) voiceAdapter.stop(handle, at);
      }, (at - now) * 1000);
    }
    while (clickCursor < (plan.clicks || []).length) {
      const metronomeClick = plan.clicks[clickCursor];
      const at = startTime + metronomeClick.atSeconds;
      if (at > horizon) break;
      clickCursor += 1;
      clickAdapter?.schedule(at, metronomeClick.accent);
    }
    tickTimer = setTimer(tick, tickMilliseconds);
  };

  const stop = () => {
    if (!playing) return;
    playing = false;
    if (tickTimer !== null) clearTimer(tickTimer);
    if (endTimer !== null) clearTimer(endTimer);
    tickTimer = null;
    endTimer = null;
    highlightTimers.forEach(clearTimer);
    gateTimers.forEach(clearTimer);
    highlightTimers.clear();
    gateTimers.clear();
    const now = clock();
    voices.forEach((handle) => voiceAdapter.stop(handle, now));
    voices.clear();
    scheduledHighlights.clear();
    onClearHighlight();
  };

  const start = ({ delaySeconds = 0.1 } = {}) => {
    if (playing) stop();
    if (!(plan.durationSeconds > 0)) {
      onClearHighlight();
      onEnd();
      return;
    }
    playing = true;
    noteCursor = 0;
    gateCursor = 0;
    clickCursor = 0;
    scheduledHighlights.clear();
    startTime = clock() + Math.max(0, delaySeconds);
    tick();
    endTimer = setTimer(finish, Math.max(0, (startTime + plan.durationSeconds - clock()) * 1000));
  };

  return { start, stop, isPlaying: () => playing };
}
