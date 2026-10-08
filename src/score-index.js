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

function numberValue(element) {
  const value = Number(element?.textContent?.trim());
  return Number.isFinite(value) ? value : null;
}

function durationValue(element, divisions) {
  const duration = numberValue(childElement(element, 'duration'));
  return rational(duration ?? 0, divisions);
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
  const pitch = readPitch(noteElement);
  if (string !== null) note.string = string;
  if (fret !== null) note.fret = fret;
  if (pitch) note.pitch = pitch;
  return note;
}

function updateContext(attributesElement, context) {
  const divisions = numberValue(childElement(attributesElement, 'divisions'));
  const time = childElement(attributesElement, 'time');
  const beats = numberValue(childElement(time, 'beats'));
  const beatType = numberValue(childElement(time, 'beat-type'));

  if (divisions !== null) context.divisions = divisions;
  if (beats !== null) context.beats = beats;
  if (beatType !== null) context.beatType = beatType;
}

function indexMeasure(measureElement, context, measureIndex) {
  let cursor = rational(0);
  let previousNoteOnset = null;
  let previousNotesEvent = null;
  const events = [];

  for (const element of Array.from(measureElement.children || [])) {
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

    if (childElement(element, 'rest')) {
      events.push({ kind: 'rest', onset, duration });
      previousNotesEvent = null;
    } else if (canJoinChord) {
      previousNotesEvent.notes.push(readNote(element));
    } else {
      previousNotesEvent = {
        kind: 'notes',
        onset,
        duration,
        notes: [readNote(element)]
      };
      events.push(previousNotesEvent);
    }

    previousNoteOnset = onset;
    if (!canJoinChord) cursor = addRational(cursor, duration);
  }

  const orderedEvents = events
    .map((event, sourceOrder) => ({ event, sourceOrder }))
    .sort((a, b) => compareRational(a.event.onset, b.event.onset) || a.sourceOrder - b.sourceOrder)
    .map(({ event }) => event);

  return {
    number: measureElement.getAttribute('number') || String(measureIndex + 1),
    divisions: context.divisions,
    beats: context.beats,
    beatType: context.beatType,
    events: orderedEvents
  };
}

export function buildScoreIndex(doc, partId) {
  const parts = childElements(doc.documentElement, 'part')
    .filter((part) => part.getAttribute('id') === partId);
  if (parts.length !== 1) {
    throw new Error(`Expected exactly one MusicXML part body for ${partId}`);
  }

  const context = { divisions: 1, beats: 4, beatType: 4 };
  const measures = childElements(parts[0], 'measure')
    .map((measure, index) => indexMeasure(measure, context, index));
  return { partId, measures };
}
