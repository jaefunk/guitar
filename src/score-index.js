function greatestCommonDivisor(a, b) {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

export function rational(n, d = 1) {
  if (!Number.isFinite(n) || !Number.isFinite(d)) {
    throw new Error('Rational values must be finite');
  }
  if (d === 0) throw new Error('Rational denominator cannot be zero');
  if (n === 0) return { n: 0, d: 1 };

  const divisor = greatestCommonDivisor(Math.abs(n), Math.abs(d));
  const sign = d < 0 ? -1 : 1;
  return {
    n: (n / divisor) * sign,
    d: Math.abs(d) / divisor
  };
}

export function addRational(a, b) {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

function childElements(element, name) {
  return Array.from(element?.children || []).filter((child) => child.localName === name);
}

function childElement(element, name) {
  return childElements(element, name)[0] || null;
}

function descendantElement(element, name) {
  return Array.from(element?.getElementsByTagName('*') || [])
    .find((child) => child.localName === name) || null;
}

function descendantElements(element, name) {
  return Array.from(element?.getElementsByTagName('*') || [])
    .filter((child) => child.localName === name);
}

function numberValue(element) {
  const text = element?.textContent?.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function durationValue(element, divisions) {
  const duration = numberValue(childElement(element, 'duration'));
  return rational(duration ?? 0, divisions > 0 ? divisions : 1);
}

function compareRational(a, b) {
  return a.n * b.d - b.n * a.d;
}

function readPitch(noteElement) {
  const pitchElement = childElement(noteElement, 'pitch');
  if (!pitchElement) return null;

  const pitch = {};
  const step = childElement(pitchElement, 'step')?.textContent?.trim();
  const alter = numberValue(childElement(pitchElement, 'alter'));
  const octave = numberValue(childElement(pitchElement, 'octave'));
  if (step) pitch.step = step;
  if (alter !== null) pitch.alter = alter;
  if (octave !== null) pitch.octave = octave;
  return pitch;
}

function readNote(noteElement) {
  const note = {};
  const string = numberValue(descendantElement(noteElement, 'string'));
  const fret = numberValue(descendantElement(noteElement, 'fret'));
  const bendAlter = numberValue(descendantElement(noteElement, 'bend-alter'));
  const notehead = childElement(noteElement, 'notehead')?.textContent?.trim().toLowerCase();
  const otherTechnical = descendantElements(noteElement, 'other-technical')
    .some((element) => element.textContent?.trim().toLowerCase() === 'dead');
  const pitch = readPitch(noteElement);
  if (string !== null) note.string = string;
  if (fret !== null) note.fret = fret;
  if (bendAlter !== null) note.bend = rational(bendAlter);
  if (notehead === 'x' || otherTechnical) note.dead = true;
  if (pitch) note.pitch = pitch;
  return note;
}

function readTuplet(noteElement) {
  const timeModification = childElement(noteElement, 'time-modification');
  if (!timeModification) return null;
  const actual = numberValue(childElement(timeModification, 'actual-notes'));
  const normal = numberValue(childElement(timeModification, 'normal-notes'));
  return actual > 0 && normal > 0 ? { actual, normal } : null;
}

function readTechniques(noteElement) {
  const techniques = [];
  for (const type of ['hammer-on', 'pull-off', 'slide']) {
    for (const element of descendantElements(noteElement, type)) {
      const action = element.getAttribute('type');
      if (action === 'start' || action === 'stop') {
        techniques.push({
          type,
          action,
          number: element.getAttribute('number') || '1'
        });
      }
    }
  }
  for (const element of childElements(noteElement, 'tie')) {
    const action = element.getAttribute('type');
    if (action === 'start' || action === 'stop') {
      techniques.push({
        type: 'tie',
        action,
        number: element.getAttribute('number') || '1'
      });
    }
  }
  return techniques;
}

function updateContext(attributesElement, context) {
  const divisions = numberValue(childElement(attributesElement, 'divisions'));
  const time = childElement(attributesElement, 'time');
  const beats = numberValue(childElement(time, 'beats'));
  const beatType = numberValue(childElement(time, 'beat-type'));

  if (divisions > 0) context.divisions = divisions;
  if (beats > 0) context.beats = beats;
  if (beatType > 0) context.beatType = beatType;
}

function techniqueDiagnostic(severity, code, measureNumber, eventId, message) {
  return { severity, code, measureNumber, eventId, message };
}

function registerTechniques(noteElement, eventId, measureNumber, techniqueStacks, links, diagnostics) {
  for (const technique of readTechniques(noteElement)) {
    const key = `${technique.type}:${technique.number}`;
    const stack = techniqueStacks.get(key) || [];
    if (technique.action === 'start') {
      stack.push({
        type: technique.type,
        number: technique.number,
        eventId,
        measureNumber
      });
      techniqueStacks.set(key, stack);
      continue;
    }

    const start = stack.pop();
    if (!start) {
      diagnostics.push(techniqueDiagnostic(
        'error',
        'UNCLOSED_TECHNIQUE',
        measureNumber,
        eventId,
        `Technique ${key} has a stop without a start`
      ));
      continue;
    }
    links.push({
      type: technique.type,
      number: technique.number,
      startEventId: start.eventId,
      endEventId: eventId
    });
  }
}

function indexMeasure(
  measureElement,
  context,
  measureIndex,
  partId,
  techniqueStacks,
  links,
  diagnostics
) {
  let cursor = rational(0);
  let previousNoteOnset = null;
  let previousNotesEvent = null;
  const events = [];
  const measureNumber = measureElement.getAttribute('number') || String(measureIndex + 1);

  for (const [sourcePosition, element] of Array.from(measureElement.children || []).entries()) {
    if (element.localName === 'attributes') {
      updateContext(element, context);
      previousNoteOnset = null;
      previousNotesEvent = null;
      continue;
    }

    if (element.localName === 'backup' || element.localName === 'forward') {
      const duration = durationValue(element, context.divisions);
      cursor = addRational(cursor, element.localName === 'backup'
        ? rational(-duration.n, duration.d)
        : duration);
      previousNoteOnset = null;
      previousNotesEvent = null;
      continue;
    }

    if (element.localName !== 'note') {
      previousNoteOnset = null;
      previousNotesEvent = null;
      continue;
    }

    const duration = durationValue(element, context.divisions);
    const isChord = Boolean(childElement(element, 'chord'));
    const canJoinChord = isChord && previousNotesEvent;
    const onset = canJoinChord ? previousNoteOnset : cursor;
    const eventId = canJoinChord
      ? previousNotesEvent.id
      : `${partId}:m${measureIndex}:s${sourcePosition}`;
    const note = childElement(element, 'rest') ? null : readNote(element);
    const tuplet = readTuplet(element);
    const fermata = Boolean(descendantElement(element, 'fermata'));

    if (childElement(element, 'rest')) {
      const event = { id: eventId, kind: 'rest', onset, duration };
      if (tuplet) event.tuplet = tuplet;
      if (fermata) event.fermata = true;
      events.push(event);
      previousNotesEvent = null;
    } else if (canJoinChord) {
      if (tuplet) note.tuplet = tuplet;
      if (fermata) note.fermata = true;
      previousNotesEvent.notes.push(note);
      if (tuplet && !previousNotesEvent.tuplet) previousNotesEvent.tuplet = tuplet;
      if (fermata) previousNotesEvent.fermata = true;
    } else {
      previousNotesEvent = {
        id: eventId,
        kind: 'notes',
        onset,
        duration,
        notes: [note]
      };
      if (tuplet) {
        note.tuplet = tuplet;
        previousNotesEvent.tuplet = tuplet;
      }
      if (fermata) {
        note.fermata = true;
        previousNotesEvent.fermata = true;
      }
      events.push(previousNotesEvent);
    }

    if (note?.string !== undefined && (!Number.isInteger(note.string) || note.string < 1 || note.string > 6)) {
      diagnostics.push(techniqueDiagnostic(
        'error',
        'INVALID_STRING',
        measureNumber,
        eventId,
        `String ${note.string} is outside the supported TAB range 1-6`
      ));
    }
    registerTechniques(element, eventId, measureNumber, techniqueStacks, links, diagnostics);

    previousNoteOnset = onset;
    if (!canJoinChord) cursor = addRational(cursor, duration);
  }

  const orderedEvents = events
    .map((event, sourceOrder) => ({ event, sourceOrder }))
    .sort((a, b) => compareRational(a.event.onset, b.event.onset) || a.sourceOrder - b.sourceOrder)
    .map(({ event }) => event);

  const expectedDuration = rational(context.beats * 4, context.beatType);
  let actualDuration = rational(0);
  for (const event of events) {
    const end = addRational(event.onset, event.duration);
    if (compareRational(end, actualDuration) > 0) actualDuration = end;
  }
  if (compareRational(actualDuration, expectedDuration) !== 0) {
    diagnostics.push(techniqueDiagnostic(
      'error',
      'MEASURE_DURATION',
      measureNumber,
      orderedEvents[0]?.id,
      `Measure duration ${actualDuration.n}/${actualDuration.d} does not match ${expectedDuration.n}/${expectedDuration.d}`
    ));
  }

  return {
    number: measureNumber,
    divisions: context.divisions,
    beats: context.beats,
    beatType: context.beatType,
    events: orderedEvents
  };
}

function endingNumbers(measureElement) {
  const values = descendantElements(measureElement, 'ending')
    .filter((element) => element.getAttribute('type') === 'start')
    .flatMap((element) => (element.getAttribute('number') || '')
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isInteger));
  return new Set(values);
}

function hasRepeat(measureElement, direction) {
  return descendantElements(measureElement, 'repeat')
    .some((element) => element.getAttribute('direction') === direction);
}

function expandPlaybackMeasures(measureElements) {
  if (!measureElements.some((measure) => descendantElements(measure, 'repeat').length > 0)) {
    return measureElements.map((_, index) => index);
  }

  const playback = [];
  const repeatedBackward = new Set();
  let repeatStart = 0;
  let pass = 1;
  let index = 0;
  let steps = 0;
  const maxSteps = Math.max(1, measureElements.length * 4);

  while (index < measureElements.length && steps < maxSteps) {
    steps += 1;
    const measure = measureElements[index];
    if (hasRepeat(measure, 'forward')) repeatStart = index;

    const endings = endingNumbers(measure);
    if (endings.size > 0 && !endings.has(pass)) {
      index += 1;
      continue;
    }

    playback.push(index);
    if (hasRepeat(measure, 'backward') && !repeatedBackward.has(index)) {
      repeatedBackward.add(index);
      pass += 1;
      index = repeatStart;
      continue;
    }
    index += 1;
  }
  return playback;
}

export function buildScoreIndex(doc, partId) {
  const parts = childElements(doc.documentElement, 'part')
    .filter((part) => part.getAttribute('id') === partId);
  if (parts.length !== 1) {
    throw new Error(`Expected exactly one MusicXML part body for ${partId}`);
  }

  const context = { divisions: 1, beats: 4, beatType: 4 };
  const links = [];
  const diagnostics = [];
  const techniqueStacks = new Map();
  const measureElements = childElements(parts[0], 'measure');
  const measures = measureElements.map((measure, index) => indexMeasure(
    measure,
    context,
    index,
    partId,
    techniqueStacks,
    links,
    diagnostics
  ));

  for (const stack of techniqueStacks.values()) {
    for (const start of stack) {
      diagnostics.push(techniqueDiagnostic(
        'warning',
        'UNCLOSED_TECHNIQUE',
        start.measureNumber,
        start.eventId,
        `Technique ${start.type}:${start.number} is not closed`
      ));
    }
  }

  return {
    partId,
    measures,
    links,
    diagnostics,
    playbackMeasures: expandPlaybackMeasures(measureElements)
  };
}
