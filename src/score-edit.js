function children(element, name) {
  return Array.from(element?.children || []).filter((child) => child.localName === name);
}

function child(element, name) {
  return children(element, name)[0] || null;
}

function descendants(element, name) {
  return Array.from(element?.getElementsByTagName('*') || []).filter((node) => node.localName === name);
}

function element(doc, name, text) {
  const node = doc.createElementNS(doc.documentElement.namespaceURI, name);
  if (text !== undefined) node.textContent = String(text);
  return node;
}

const NOTE_ORDER = [
  'grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'instrument',
  'footnote', 'level', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem',
  'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen'
];
const BARLINE_ORDER = [
  'bar-style', 'footnote', 'level', 'wavy-line', 'segno', 'coda', 'fermata', 'ending', 'repeat'
];
const PITCH_ORDER = ['step', 'alter', 'octave'];
const TIME_MODIFICATION_ORDER = ['actual-notes', 'normal-notes', 'normal-type', 'normal-dot'];

function orderFor(parent) {
  if (parent.localName === 'note') return NOTE_ORDER;
  if (parent.localName === 'barline') return BARLINE_ORDER;
  if (parent.localName === 'pitch') return PITCH_ORDER;
  if (parent.localName === 'time-modification') return TIME_MODIFICATION_ORDER;
  return null;
}

function insertOrdered(parent, node) {
  const order = orderFor(parent);
  if (!order) {
    parent.appendChild(node);
    return node;
  }
  const rank = order.indexOf(node.localName);
  if (rank < 0) {
    parent.appendChild(node);
    return node;
  }
  const anchor = [...parent.children].find((candidate) => {
    const candidateRank = order.indexOf(candidate.localName);
    return candidateRank >= 0 && candidateRank > rank;
  });
  parent.insertBefore(node, anchor || null);
  return node;
}

const STEP_SEMITONES = Object.freeze({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 });
const SHARP_PITCHES = Object.freeze([
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]
]);
const STANDARD_LINE_MIDI = Object.freeze([40, 45, 50, 55, 59, 64]);

function numericText(node, fallback = null) {
  const value = Number(node?.textContent?.trim());
  return Number.isFinite(value) ? value : fallback;
}

function pitchMidi(pitch) {
  const step = child(pitch, 'step')?.textContent?.trim();
  const octave = numericText(child(pitch, 'octave'));
  if (!(step in STEP_SEMITONES) || !Number.isInteger(octave)) return null;
  return (octave + 1) * 12 + STEP_SEMITONES[step] + (numericText(child(pitch, 'alter'), 0) || 0);
}

function tuningAt(doc, partId, measureIndex) {
  const lineMidi = [...STANDARD_LINE_MIDI];
  let capo = 0;
  const measures = children(directPart(doc, partId), 'measure');
  for (let index = 0; index <= measureIndex; index += 1) {
    for (const details of descendants(child(measures[index], 'attributes'), 'staff-details')) {
      const capoValue = numericText(child(details, 'capo'));
      if (Number.isInteger(capoValue)) capo = capoValue;
      for (const tuning of children(details, 'staff-tuning')) {
        const line = Number(tuning.getAttribute('line'));
        const step = child(tuning, 'tuning-step')?.textContent?.trim();
        const octave = numericText(child(tuning, 'tuning-octave'));
        const alter = numericText(child(tuning, 'tuning-alter'), 0) || 0;
        if (Number.isInteger(line) && line >= 1 && line <= 6 && step in STEP_SEMITONES && Number.isInteger(octave)) {
          lineMidi[line - 1] = (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
        }
      }
    }
  }
  return { lineMidi, capo };
}

function midiForPosition(doc, partId, measureIndex, string, fret) {
  const { lineMidi, capo } = tuningAt(doc, partId, measureIndex);
  // MusicXML technical string 1 is the highest string; staff-tuning line 6 is highest.
  // Pitch is stored as sounding pitch, so capo is added to the open-string pitch.
  return lineMidi[6 - string] + capo + fret;
}

function setPitchMidi(doc, note, midi) {
  let pitch = child(note, 'pitch');
  if (!pitch) {
    pitch = element(doc, 'pitch');
    insertOrdered(note, pitch);
  }
  const [step, alter] = SHARP_PITCHES[((midi % 12) + 12) % 12];
  setTextChild(doc, pitch, 'step', step);
  if (alter) setTextChild(doc, pitch, 'alter', alter);
  else child(pitch, 'alter')?.remove();
  setTextChild(doc, pitch, 'octave', Math.floor(midi / 12) - 1);
}

function directPart(doc, partId) {
  const parts = children(doc.documentElement, 'part').filter((part) => part.getAttribute('id') === partId);
  if (parts.length !== 1) throw new Error(`Expected exactly one MusicXML part body for ${partId}`);
  return parts[0];
}

function measureAt(doc, partId, measureIndex) {
  if (!Number.isInteger(measureIndex) || measureIndex < 0) throw new Error('Invalid measure index');
  const measure = children(directPart(doc, partId), 'measure')[measureIndex];
  if (!measure) throw new Error(`MusicXML measure not found: ${measureIndex}`);
  return measure;
}

function parseEventId(partId, eventId) {
  const escaped = partId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}:m(\\d+):s(\\d+)$`).exec(eventId);
  if (!match) throw new Error(`Invalid event ID for part ${partId}: ${eventId}`);
  return { measureIndex: Number(match[1]), sourcePosition: Number(match[2]) };
}

function resolveEvent(doc, partId, eventId) {
  const location = parseEventId(partId, eventId);
  const measure = measureAt(doc, partId, location.measureIndex);
  const first = children(measure, 'note')[location.sourcePosition];
  const attachedChord = child(first, 'chord') && first?.previousElementSibling?.localName === 'note';
  if (!first || first.localName !== 'note' || attachedChord) {
    throw new Error(`MusicXML event not found: ${eventId}`);
  }
  const notes = [first];
  let cursor = first.nextElementSibling;
  while (cursor?.localName === 'note' && child(cursor, 'chord')) {
    notes.push(cursor);
    cursor = cursor.nextElementSibling;
  }
  return { ...location, measure, notes, after: cursor };
}

export function resolveXmlEvent(doc, eventId, partId = String(eventId).split(':m')[0]) {
  return resolveEvent(doc, partId, eventId);
}

function replaceMeasure(doc, partId, measureIndex, snapshot) {
  const current = measureAt(doc, partId, measureIndex);
  current.replaceWith(snapshot.cloneNode(true));
}

function measureCommand(doc, partId, measureIndices, mutate) {
  const measures = [...new Set(measureIndices)].sort((a, b) => a - b);
  for (const index of measures) measureAt(doc, partId, index);
  let before = null;
  let after = null;
  let applied = false;
  return {
    measures,
    apply() {
      if (applied) return;
      if (after) {
        after.forEach((snapshot, offset) => replaceMeasure(doc, partId, measures[offset], snapshot));
        applied = true;
        return;
      }
      before = measures.map((index) => measureAt(doc, partId, index).cloneNode(true));
      try {
        mutate();
        after = measures.map((index) => measureAt(doc, partId, index).cloneNode(true));
        applied = true;
      } catch (error) {
        before.forEach((snapshot, offset) => replaceMeasure(doc, partId, measures[offset], snapshot));
        before = null;
        throw error;
      }
    },
    revert() {
      if (!applied || !before) return;
      before.forEach((snapshot, offset) => replaceMeasure(doc, partId, measures[offset], snapshot));
      applied = false;
    }
  };
}

function integer(value, label, min, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Invalid ${label}`);
  return number;
}

function setTextChild(doc, parent, name, value) {
  let node = child(parent, name);
  if (!node) {
    node = element(doc, name);
    insertOrdered(parent, node);
  }
  node.textContent = String(value);
  return node;
}

function ensureChild(doc, parent, name) {
  let node = child(parent, name);
  if (!node) {
    node = element(doc, name);
    insertOrdered(parent, node);
  }
  return node;
}

function technicalFor(doc, note) {
  const notations = ensureChild(doc, note, 'notations');
  return ensureChild(doc, notations, 'technical');
}

function selectedNote(doc, partId, eventId, noteIndex) {
  const resolved = resolveEvent(doc, partId, eventId);
  const index = integer(noteIndex, 'note index', 0);
  const note = resolved.notes[index];
  if (!note) throw new Error(`Chord note not found: ${noteIndex}`);
  if (child(note, 'rest')) throw new Error('Cannot edit TAB position on a rest');
  return { ...resolved, note };
}

export function createHistory(onChanged = () => {}) {
  const undoStack = [];
  const redoStack = [];
  const notify = (command) => onChanged(command.measures.slice());
  return {
    execute(command) {
      if (!command || typeof command.apply !== 'function' || typeof command.revert !== 'function') {
        throw new Error('Invalid score command');
      }
      command.apply();
      undoStack.push(command);
      redoStack.length = 0;
      notify(command);
      return true;
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return false;
      command.revert();
      redoStack.push(command);
      notify(command);
      return true;
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return false;
      command.apply();
      undoStack.push(command);
      notify(command);
      return true;
    },
    clear() { undoStack.length = 0; redoStack.length = 0; },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; }
  };
}

export function setFretCommand(doc, partId, eventId, fret, noteIndex = 0) {
  const value = integer(fret, 'fret', 0, 36);
  const location = selectedNote(doc, partId, eventId, noteIndex);
  const technical = descendants(location.note, 'technical')[0];
  const string = integer(numericText(child(technical, 'string')), 'string', 1, 6);
  validateTechniqueEdit(doc, partId, location.note, string,
    midiForPosition(doc, partId, location.measureIndex, string, value));
  return measureCommand(doc, partId, [location.measureIndex], () => {
    const { note } = selectedNote(doc, partId, eventId, noteIndex);
    const technical = technicalFor(doc, note);
    setTextChild(doc, technical, 'fret', value);
    const string = integer(numericText(child(technical, 'string')), 'string', 1, 6);
    setPitchMidi(doc, note, midiForPosition(doc, partId, location.measureIndex, string, value));
  });
}

export function setStringCommand(doc, partId, eventId, string, noteIndex = 0) {
  const value = integer(string, 'string', 1, 6);
  const location = selectedNote(doc, partId, eventId, noteIndex);
  const technical = descendants(location.note, 'technical')[0];
  const fret = integer(numericText(child(technical, 'fret')), 'fret', 0, 36);
  validateTechniqueEdit(doc, partId, location.note, value,
    midiForPosition(doc, partId, location.measureIndex, value, fret));
  return measureCommand(doc, partId, [location.measureIndex], () => {
    const { note } = selectedNote(doc, partId, eventId, noteIndex);
    const technical = technicalFor(doc, note);
    setTextChild(doc, technical, 'string', value);
    const fret = integer(numericText(child(technical, 'fret')), 'fret', 0, 36);
    setPitchMidi(doc, note, midiForPosition(doc, partId, location.measureIndex, value, fret));
  });
}

const TYPE_QUARTERS = Object.freeze({
  whole: 4, half: 2, quarter: 1, eighth: 1 / 2, '16th': 1 / 4,
  '32nd': 1 / 8, '64th': 1 / 16, '128th': 1 / 32
});

function divisionsAt(doc, partId, measureIndex) {
  let divisions = 1;
  const measures = children(directPart(doc, partId), 'measure');
  for (let index = 0; index <= measureIndex; index += 1) {
    const value = numericText(child(child(measures[index], 'attributes'), 'divisions'));
    if (Number.isInteger(value) && value > 0) divisions = value;
  }
  return divisions;
}

function rawDuration(note) {
  return integer(numericText(child(note, 'duration')), 'duration', 1);
}

function durationFromNotation(type, dots, tuplet, divisions) {
  const quarters = TYPE_QUARTERS[type];
  if (!quarters) throw new Error(`Invalid note type: ${type}`);
  let multiplier = 1;
  for (let count = 1; count <= dots; count += 1) multiplier += 1 / (2 ** count);
  const ratio = tuplet ? tuplet.normal / tuplet.actual : 1;
  const duration = divisions * quarters * multiplier * ratio;
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error('Notation duration must resolve to a positive integer at current divisions');
  }
  return duration;
}

function rhythmValues(note, values, divisions) {
  const type = values.type === undefined
    ? child(note, 'type')?.textContent?.trim() || 'quarter'
    : String(values.type).trim();
  if (!type) throw new Error('Invalid note type');
  const dots = values.dots === undefined ? children(note, 'dot').length : integer(values.dots, 'dots', 0, 4);
  let tuplet;
  if (values.tuplet === undefined) {
    const modification = child(note, 'time-modification');
    const actual = numericText(child(modification, 'actual-notes'));
    const normal = numericText(child(modification, 'normal-notes'));
    tuplet = actual > 0 && normal > 0 ? { actual, normal } : null;
  } else if (values.tuplet === null) {
    tuplet = null;
  } else {
    tuplet = {
      actual: integer(values.tuplet.actual, 'tuplet actual notes', 1),
      normal: integer(values.tuplet.normal, 'tuplet normal notes', 1)
    };
  }
  const duration = values.duration !== undefined && values.type === undefined
    ? integer(values.duration, 'duration', 1)
    : durationFromNotation(type, dots, tuplet, divisions);
  return { type, dots, tuplet, duration };
}

function setNoteRhythm(doc, note, rhythm) {
  setTextChild(doc, note, 'duration', rhythm.duration);
  setTextChild(doc, note, 'type', rhythm.type);
  const existingDots = children(note, 'dot');
  existingDots.slice(rhythm.dots).forEach((dot) => dot.remove());
  for (let count = existingDots.length; count < rhythm.dots; count += 1) {
    insertOrdered(note, element(doc, 'dot'));
  }
  if (rhythm.tuplet) {
    const modification = child(note, 'time-modification') || insertOrdered(note, element(doc, 'time-modification'));
    setTextChild(doc, modification, 'actual-notes', rhythm.tuplet.actual);
    setTextChild(doc, modification, 'normal-notes', rhythm.tuplet.normal);
  } else {
    child(note, 'time-modification')?.remove();
  }
}

function assertSimpleMeasure(measure) {
  if (children(measure, 'backup').length || children(measure, 'forward').length) {
    throw new Error('Duration editing does not support backup/forward or multi-voice measures');
  }
  const voices = new Set(children(measure, 'note').map((note) => child(note, 'voice')?.textContent?.trim() || '1'));
  if (voices.size > 1) throw new Error('Duration editing does not support multi-voice measures');
}

function restAt(node, neededDuration) {
  if (node?.localName !== 'note' || child(node, 'chord') || !child(node, 'rest')) return null;
  return rawDuration(node) >= neededDuration ? node : null;
}

function adjustRestDuration(doc, rest, delta) {
  const next = rawDuration(rest) - delta;
  if (next < 0) throw new Error('Not enough rest duration to preserve the measure');
  if (next === 0) rest.remove();
  else setTextChild(doc, rest, 'duration', next);
}

function convertNoteToRest(doc, note) {
  for (const name of [
    'chord', 'pitch', 'unpitched', 'tie', 'instrument', 'accidental', 'stem',
    'notehead', 'notehead-text', 'beam', 'notations', 'play', 'listen'
  ]) children(note, name).forEach((node) => node.remove());
  if (!child(note, 'rest')) insertOrdered(note, element(doc, 'rest'));
}

export function setRhythmCommand(doc, partId, eventId, values = {}) {
  const location = resolveEvent(doc, partId, eventId);
  assertSimpleMeasure(location.measure);
  const divisions = divisionsAt(doc, partId, location.measureIndex);
  const nextRhythm = rhythmValues(location.notes[0], values, divisions);
  const previousDuration = rawDuration(location.notes[0]);
  const delta = nextRhythm.duration - previousDuration;
  if (delta !== 0) {
    if (!restAt(location.after, Math.max(delta, 0))) {
      throw new Error('An adjacent rest after the event is required to preserve the measure timeline');
    }
  }

  return measureCommand(doc, partId, [location.measureIndex], () => {
    const resolved = resolveEvent(doc, partId, eventId);
    if (delta !== 0) adjustRestDuration(doc, restAt(resolved.after, Math.max(delta, 0)), delta);
    for (const note of resolved.notes) setNoteRhythm(doc, note, nextRhythm);
  });
}

export function setFlagsCommand(doc, partId, eventId, flags = {}) {
  const location = resolveEvent(doc, partId, eventId);
  for (const name of ['rest', 'dead', 'ghost']) {
    if (flags[name] !== undefined && typeof flags[name] !== 'boolean') throw new Error(`Invalid ${name} flag`);
  }
  const cleanupPairs = flags.rest === true ? pairsTouchingNotes(directPart(doc, partId), location.notes) : [];
  const measureIndices = [location.measureIndex, ...cleanupPairs.flatMap((pair) => [pair.start.measureIndex, pair.end.measureIndex])];
  return measureCommand(doc, partId, measureIndices, () => {
    const resolved = resolveEvent(doc, partId, eventId);
    if (flags.rest === true) {
      removePairs(cleanupPairs);
      const source = resolved.notes[0];
      convertNoteToRest(doc, source);
      resolved.notes.slice(1).forEach((note) => note.remove());
      return;
    }
    if (flags.rest === false && child(resolved.notes[0], 'rest')) {
      const note = resolved.notes[0];
      child(note, 'rest').remove();
      setPitchMidi(doc, note, midiForPosition(doc, partId, location.measureIndex, 1, 0));
      const technical = technicalFor(doc, note);
      technical.append(element(doc, 'string', 1), element(doc, 'fret', 0));
    }
    for (const note of resolveEvent(doc, partId, eventId).notes) {
      if (child(note, 'rest')) continue;
      if (flags.dead !== undefined || flags.ghost !== undefined) {
        let notehead = child(note, 'notehead');
        if (!notehead && (flags.dead || flags.ghost)) {
          notehead = element(doc, 'notehead', 'normal');
          insertOrdered(note, notehead);
        }
        if (flags.dead !== undefined && notehead) notehead.textContent = flags.dead ? 'x' : 'normal';
        if (flags.ghost !== undefined && notehead) {
          if (flags.ghost) notehead.setAttribute('parentheses', 'yes');
          else notehead.removeAttribute('parentheses');
        }
        if (notehead && notehead.textContent === 'normal' && !notehead.hasAttribute('parentheses')) notehead.remove();
      }
    }
  });
}

function insertionRhythm(spec, divisions) {
  const type = String(spec.type || 'quarter').trim();
  const dots = integer(spec.dots ?? 0, 'dots', 0, 4);
  const tuplet = spec.tuplet ? {
    actual: integer(spec.tuplet.actual, 'tuplet actual notes', 1),
    normal: integer(spec.tuplet.normal, 'tuplet normal notes', 1)
  } : null;
  const duration = spec.duration === undefined
    ? durationFromNotation(type, dots, tuplet, divisions)
    : integer(spec.duration, 'duration', 1);
  return { duration, type, dots, tuplet };
}

function buildInsertedNotes(doc, partId, measureIndex, spec, rhythm) {
  if (spec.rest) {
    const note = element(doc, 'note');
    insertOrdered(note, element(doc, 'rest'));
    setNoteRhythm(doc, note, rhythm);
    return [note];
  }
  if (!Array.isArray(spec.notes) || spec.notes.length === 0) throw new Error('Inserted event requires notes');
  return spec.notes.map((value, index) => {
    const string = integer(value.string, 'string', 1, 6);
    const fret = integer(value.fret, 'fret', 0, 36);
    const note = element(doc, 'note');
    if (index > 0) insertOrdered(note, element(doc, 'chord'));
    setPitchMidi(doc, note, midiForPosition(doc, partId, measureIndex, string, fret));
    setNoteRhythm(doc, note, rhythm);
    const technical = technicalFor(doc, note);
    technical.append(element(doc, 'string', string), element(doc, 'fret', fret));
    return note;
  });
}

export function insertEventCommand(doc, partId, { measureIndex, afterEventId = null, event: spec }) {
  const measure = measureAt(doc, partId, measureIndex);
  assertSimpleMeasure(measure);
  const rhythm = insertionRhythm(spec || {}, divisionsAt(doc, partId, measureIndex));
  const preview = buildInsertedNotes(doc, partId, measureIndex, spec || {}, rhythm);
  if (afterEventId && resolveEvent(doc, partId, afterEventId).measureIndex !== measureIndex) {
    throw new Error('Insertion anchor must be in the target measure');
  }
  const leading = new Set(['attributes', 'print', 'direction', 'harmony', 'barline']);
  const insertionNode = afterEventId
    ? resolveEvent(doc, partId, afterEventId).after
    : [...measure.children].find((node) => !leading.has(node.localName)) || null;
  if (!restAt(insertionNode, rhythm.duration)) {
    throw new Error('Insertion requires enough rest duration at the insertion point');
  }
  return measureCommand(doc, partId, [measureIndex], () => {
    const target = measureAt(doc, partId, measureIndex);
    let anchor = afterEventId
      ? resolveEvent(doc, partId, afterEventId).after
      : [...target.children].find((node) => !leading.has(node.localName)) || null;
    const currentRest = restAt(anchor, rhythm.duration);
    if (anchor === currentRest && rawDuration(currentRest) === rhythm.duration) anchor = currentRest.nextSibling;
    adjustRestDuration(doc, currentRest, rhythm.duration);
    for (const note of preview.map((node) => node.cloneNode(true))) target.insertBefore(note, anchor);
  });
}

export function deleteEventCommand(doc, partId, eventId) {
  const location = resolveEvent(doc, partId, eventId);
  if (child(location.notes[0], 'rest')) throw new Error('Cannot delete a rest event');
  const cleanupPairs = pairsTouchingNotes(directPart(doc, partId), location.notes);
  const measureIndices = [location.measureIndex, ...cleanupPairs.flatMap((pair) => [pair.start.measureIndex, pair.end.measureIndex])];
  return measureCommand(doc, partId, measureIndices, () => {
    const resolved = resolveEvent(doc, partId, eventId);
    removePairs(cleanupPairs);
    const source = resolved.notes[0];
    convertNoteToRest(doc, source);
    resolved.notes.slice(1).forEach((note) => note.remove());
  });
}

function numberedTechniqueNodes(note, type, action) {
  const name = type === 'tie' ? 'tied' : type;
  return descendants(note, name).filter((node) => node.getAttribute('type') === action);
}

function removeTechniqueNumber(note, type, action, number) {
  const matches = numberedTechniqueNodes(note, type, action)
    .filter((node) => (node.getAttribute('number') || '1') === number);
  matches.forEach((node) => node.remove());
  if (type === 'tie' && matches.length > 0) {
    const direct = children(note, 'tie').find((node) => node.getAttribute('type') === action);
    direct?.remove();
  }
}

function addTechnique(doc, note, type, action, number) {
  if (type === 'tie') {
    const tie = element(doc, 'tie');
    tie.setAttribute('type', action);
    insertOrdered(note, tie);
    const tied = element(doc, 'tied');
    tied.setAttribute('type', action);
    tied.setAttribute('number', number);
    ensureChild(doc, note, 'notations').appendChild(tied);
    return;
  }
  const node = element(doc, type, action === 'start' ? ({ 'hammer-on': 'H', 'pull-off': 'P' }[type] || '') : '');
  node.setAttribute('type', action);
  node.setAttribute('number', number);
  const parent = type === 'slide' ? ensureChild(doc, note, 'notations') : technicalFor(doc, note);
  parent.appendChild(node);
}

function noteTimeline(part) {
  const result = [];
  let order = 0;
  let onsetOrder = -1;
  children(part, 'measure').forEach((measure, measureIndex) => {
    children(measure, 'note').forEach((note, sourcePosition) => {
      if (!child(note, 'chord')) onsetOrder += 1;
      result.push({ note, measureIndex, sourcePosition, order: order++, onsetOrder });
    });
  });
  return result;
}

function tieSignature(note) {
  const voice = child(note, 'voice')?.textContent?.trim() || '1';
  const midi = pitchMidi(child(note, 'pitch'));
  return `${voice}:${midi ?? 'unknown'}`;
}

function logicalTieEndpoints(entry) {
  const endpoints = [];
  // A continuation note may stop one tie and start the next. Stop must be
  // consumed first so the direct-only state machine never sees two active ties.
  for (const action of ['stop', 'start']) {
    const tied = descendants(entry.note, 'tied').filter((node) => node.getAttribute('type') === action);
    const direct = children(entry.note, 'tie').filter((node) => node.getAttribute('type') === action);
    if (tied.length) {
      tied.forEach((node, index) => endpoints.push({
        ...entry,
        node,
        nodes: index === 0 ? [node, ...direct] : [node],
        type: 'tie',
        action,
        number: node.getAttribute('number') || '1',
        directOnly: false
      }));
    } else if (direct.length) {
      endpoints.push({
        ...entry,
        node: direct[0],
        nodes: direct,
        type: 'tie',
        action,
        number: '1',
        directOnly: true
      });
    }
  }
  for (const node of [
    ...descendants(entry.note, 'tied').filter((candidate) => !['start', 'stop'].includes(candidate.getAttribute('type'))),
    ...children(entry.note, 'tie').filter((candidate) => !['start', 'stop'].includes(candidate.getAttribute('type')))
  ]) {
    endpoints.push({
      ...entry,
      node,
      nodes: [node],
      type: 'tie',
      action: node.getAttribute('type'),
      number: node.localName === 'tied' ? node.getAttribute('number') || '1' : '1',
      directOnly: node.localName === 'tie'
    });
  }
  return endpoints;
}

function logicalTechniqueEndpoints(entry, type) {
  if (type === 'tie') return logicalTieEndpoints(entry);
  return descendants(entry.note, type).map((node) => ({
    ...entry,
    node,
    nodes: [node],
    type,
    action: node.getAttribute('type'),
    number: node.getAttribute('number') || '1',
    directOnly: false
  }));
}

function techniqueInventory(part, requestedType = null) {
  const pairs = [];
  const malformedNumbers = new Set();
  const endpoints = [];
  const stacks = new Map();
  const directTieStates = new Map();
  for (const entry of noteTimeline(part)) {
    for (const type of (requestedType ? [requestedType] : ['hammer-on', 'pull-off', 'slide', 'tie'])) {
      for (const endpoint of logicalTechniqueEndpoints(entry, type)) {
        const { action, number } = endpoint;
        endpoints.push(endpoint);
        const numeric = Number(number);
        if (!Number.isInteger(numeric) || numeric < 1 || numeric > 16 || !['start', 'stop'].includes(action)) {
          malformedNumbers.add(number);
          continue;
        }
        if (endpoint.directOnly) {
          const key = `${type}:${tieSignature(entry.note)}`;
          const active = directTieStates.get(key);
          if (action === 'start') {
            if (active) {
              malformedNumbers.add(number);
              directTieStates.set(key, { ambiguous: true });
            } else {
              directTieStates.set(key, endpoint);
            }
          } else if (active && !active.ambiguous) {
            pairs.push({ type, number, start: active, end: endpoint });
            directTieStates.delete(key);
          } else {
            malformedNumbers.add(number);
            directTieStates.delete(key);
          }
          continue;
        }
        const key = `${type}:${number}`;
        const stack = stacks.get(key) || [];
        if (action === 'start') {
          stack.push(endpoint);
          stacks.set(key, stack);
        } else if (stack.length) {
          pairs.push({ type, number, start: stack.pop(), end: endpoint });
        } else {
          malformedNumbers.add(number);
        }
      }
    }
  }
  for (const [key, stack] of stacks) {
    if (stack.length) malformedNumbers.add(key.split(':')[1]);
  }
  if (directTieStates.size) malformedNumbers.add('1');
  return { pairs, malformedNumbers, endpoints };
}

function pairsTouchingNotes(part, notes) {
  const targets = new Set(notes);
  return techniqueInventory(part).pairs.filter((pair) => targets.has(pair.start.note) || targets.has(pair.end.note));
}

function removePairs(pairs) {
  for (const pair of pairs) {
    pair.start.nodes.forEach((node) => node.remove());
    pair.end.nodes.forEach((node) => node.remove());
  }
}

function validateTechniqueEdit(doc, partId, note, proposedString, proposedMidi) {
  const inventory = techniqueInventory(directPart(doc, partId));
  const endpoints = inventory.endpoints.filter((endpoint) => endpoint.note === note);
  const pairs = inventory.pairs.filter((pair) => pair.start.note === note || pair.end.note === note);
  if (endpoints.length !== pairs.length) throw new Error('Cannot edit a malformed technique endpoint');
  for (const pair of pairs) {
    const counterpart = pair.start.note === note ? pair.end.note : pair.start.note;
    if (pair.type === 'tie' && pitchMidi(child(counterpart, 'pitch')) !== proposedMidi) {
      throw new Error('Technique edit would break an equal-pitch tie');
    }
    if (pair.type !== 'tie') {
      const counterpartString = numericText(child(descendants(counterpart, 'technical')[0], 'string'));
      if (counterpartString !== proposedString) throw new Error('Technique edit would break the same-string pair');
    }
  }
}

function intervalsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function nextTechniqueNumber(part, type, startNote, endNote) {
  const inventory = techniqueInventory(part, type);
  const timeline = noteTimeline(part);
  const startOrder = timeline.find((entry) => entry.note === startNote)?.order;
  const endOrder = timeline.find((entry) => entry.note === endNote)?.order;
  for (let number = 1; number <= 16; number += 1) {
    const label = String(number);
    if (inventory.malformedNumbers.has(label)) continue;
    const occupied = inventory.pairs.some((pair) => pair.number === label
      && intervalsOverlap(pair.start.order, pair.end.order, startOrder, endOrder));
    if (!occupied) return label;
  }
  throw new Error('No technique number from 1 to 16 is available for this interval');
}

function exactPairNumber(startNote, endNote, type) {
  const starts = new Set(numberedTechniqueNodes(startNote, type, 'start')
    .map((node) => node.getAttribute('number') || '1'));
  return numberedTechniqueNodes(endNote, type, 'stop')
    .map((node) => node.getAttribute('number') || '1')
    .find((number) => starts.has(number)) || null;
}

export function setTechniquePairCommand(
  doc, partId, type, startEventId, endEventId, enabled, startNoteIndex = 0, endNoteIndex = startNoteIndex
) {
  if (!['hammer-on', 'pull-off', 'slide', 'tie'].includes(type)) throw new Error('Invalid technique type');
  if (typeof enabled !== 'boolean') throw new Error('Invalid technique state');
  const start = selectedNote(doc, partId, startEventId, startNoteIndex);
  const end = selectedNote(doc, partId, endEventId, endNoteIndex);
  if (start.measureIndex > end.measureIndex
    || (start.measureIndex === end.measureIndex && start.sourcePosition >= end.sourcePosition)) {
    throw new Error('Technique endpoints must be in temporal order');
  }
  const startString = numericText(child(descendants(start.note, 'technical')[0], 'string'));
  const endString = numericText(child(descendants(end.note, 'technical')[0], 'string'));
  if (['hammer-on', 'pull-off', 'slide'].includes(type) && startString !== endString) {
    throw new Error(`${type} endpoints must use the same string`);
  }
  if (type === 'tie' && pitchMidi(child(start.note, 'pitch')) !== pitchMidi(child(end.note, 'pitch'))) {
    throw new Error('Tie endpoints must have equal sounding pitch');
  }
  const existingPair = techniqueInventory(directPart(doc, partId), type).pairs
    .find((pair) => pair.start.note === start.note && pair.end.note === end.note);
  const existingNumber = existingPair?.number || exactPairNumber(start.note, end.note, type);
  if (!enabled && !existingPair && !existingNumber) throw new Error('Technique pair not found');
  const number = enabled ? nextTechniqueNumber(directPart(doc, partId), type, start.note, end.note) : existingNumber;
  return measureCommand(doc, partId, [start.measureIndex, end.measureIndex], () => {
    const startNote = selectedNote(doc, partId, startEventId, startNoteIndex).note;
    const endNote = selectedNote(doc, partId, endEventId, endNoteIndex).note;
    if (enabled) {
      addTechnique(doc, startNote, type, 'start', number);
      addTechnique(doc, endNote, type, 'stop', number);
    } else if (existingPair) {
      removePairs([existingPair]);
    } else {
      removeTechniqueNumber(startNote, type, 'start', number);
      removeTechniqueNumber(endNote, type, 'stop', number);
    }
  });
}

function barlineAt(doc, measure, location) {
  let barline = children(measure, 'barline').find((node) => (node.getAttribute('location') || 'right') === location);
  if (!barline) {
    barline = element(doc, 'barline');
    barline.setAttribute('location', location);
    if (location === 'left') {
      const leading = new Set(['attributes', 'print', 'direction', 'harmony']);
      const anchor = [...measure.children].find((node) => !leading.has(node.localName)) || null;
      measure.insertBefore(barline, anchor);
    } else {
      measure.appendChild(barline);
    }
  }
  return barline;
}

function removeEmptyBarline(barline) {
  if (barline && barline.children.length === 0 && !barline.textContent.trim()) barline.remove();
}

export function setRepeatCommand(doc, partId, measureIndex, direction, enabled) {
  if (!['forward', 'backward'].includes(direction)) throw new Error('Invalid repeat direction');
  if (typeof enabled !== 'boolean') throw new Error('Invalid repeat state');
  measureAt(doc, partId, measureIndex);
  return measureCommand(doc, partId, [measureIndex], () => {
    const measure = measureAt(doc, partId, measureIndex);
    const location = direction === 'forward' ? 'left' : 'right';
    const barline = barlineAt(doc, measure, location);
    children(barline, 'repeat').filter((node) => node.getAttribute('direction') === direction).forEach((node) => node.remove());
    if (enabled) {
      const repeat = element(doc, 'repeat');
      repeat.setAttribute('direction', direction);
      insertOrdered(barline, repeat);
    }
    removeEmptyBarline(barline);
  });
}

export function setEndingCommand(doc, partId, startMeasureIndex, endMeasureIndex, number, enabled) {
  integer(startMeasureIndex, 'ending start measure', 0);
  integer(endMeasureIndex, 'ending end measure', startMeasureIndex);
  const label = String(number).trim();
  if (!label) throw new Error('Invalid ending number');
  if (typeof enabled !== 'boolean') throw new Error('Invalid ending state');
  measureAt(doc, partId, startMeasureIndex);
  measureAt(doc, partId, endMeasureIndex);
  return measureCommand(doc, partId, [startMeasureIndex, endMeasureIndex], () => {
    for (const [measureIndex, location, type] of [
      [startMeasureIndex, 'left', 'start'], [endMeasureIndex, 'right', 'stop']
    ]) {
      const barline = barlineAt(doc, measureAt(doc, partId, measureIndex), location);
      children(barline, 'ending').filter((node) => node.getAttribute('number') === label).forEach((node) => node.remove());
      if (enabled) {
        const ending = element(doc, 'ending');
        ending.setAttribute('number', label);
        ending.setAttribute('type', type);
        insertOrdered(barline, ending);
      }
      removeEmptyBarline(barline);
    }
  });
}
