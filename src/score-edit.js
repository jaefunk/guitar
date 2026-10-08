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
  if (!first || first.localName !== 'note' || child(first, 'chord')) {
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
    parent.appendChild(node);
  }
  node.textContent = String(value);
  return node;
}

function ensureChild(doc, parent, name) {
  let node = child(parent, name);
  if (!node) {
    node = element(doc, name);
    parent.appendChild(node);
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
  return measureCommand(doc, partId, [location.measureIndex], () => {
    const { note } = selectedNote(doc, partId, eventId, noteIndex);
    setTextChild(doc, technicalFor(doc, note), 'fret', value);
  });
}

export function setStringCommand(doc, partId, eventId, string, noteIndex = 0) {
  const value = integer(string, 'string', 1, 6);
  const location = selectedNote(doc, partId, eventId, noteIndex);
  return measureCommand(doc, partId, [location.measureIndex], () => {
    const { note } = selectedNote(doc, partId, eventId, noteIndex);
    setTextChild(doc, technicalFor(doc, note), 'string', value);
  });
}

export function setRhythmCommand(doc, partId, eventId, values = {}) {
  const location = resolveEvent(doc, partId, eventId);
  const duration = values.duration === undefined ? undefined : integer(values.duration, 'duration', 1);
  const dots = values.dots === undefined ? undefined : integer(values.dots, 'dots', 0, 4);
  const type = values.type === undefined ? undefined : String(values.type).trim();
  if (type !== undefined && !type) throw new Error('Invalid note type');
  let tuplet;
  if (values.tuplet !== undefined && values.tuplet !== null) {
    tuplet = {
      actual: integer(values.tuplet.actual, 'tuplet actual notes', 1),
      normal: integer(values.tuplet.normal, 'tuplet normal notes', 1)
    };
  } else if (values.tuplet === null) tuplet = null;

  return measureCommand(doc, partId, [location.measureIndex], () => {
    const resolved = resolveEvent(doc, partId, eventId);
    for (const note of resolved.notes) {
      if (duration !== undefined) setTextChild(doc, note, 'duration', duration);
      if (type !== undefined) setTextChild(doc, note, 'type', type);
      if (dots !== undefined) {
        children(note, 'dot').forEach((dot) => dot.remove());
        const anchor = child(note, 'type');
        for (let count = 0; count < dots; count += 1) {
          const dot = element(doc, 'dot');
          anchor?.nextSibling ? note.insertBefore(dot, anchor.nextSibling) : note.appendChild(dot);
        }
      }
      if (tuplet !== undefined) {
        child(note, 'time-modification')?.remove();
        if (tuplet) {
          const modification = element(doc, 'time-modification');
          modification.append(element(doc, 'actual-notes', tuplet.actual), element(doc, 'normal-notes', tuplet.normal));
          note.appendChild(modification);
        }
      }
    }
  });
}

export function setFlagsCommand(doc, partId, eventId, flags = {}) {
  const location = resolveEvent(doc, partId, eventId);
  for (const name of ['rest', 'dead', 'ghost']) {
    if (flags[name] !== undefined && typeof flags[name] !== 'boolean') throw new Error(`Invalid ${name} flag`);
  }
  return measureCommand(doc, partId, [location.measureIndex], () => {
    const resolved = resolveEvent(doc, partId, eventId);
    for (const note of resolved.notes) {
      if (flags.rest === true) {
        child(note, 'pitch')?.remove();
        if (!child(note, 'rest')) note.insertBefore(element(doc, 'rest'), note.firstChild);
      } else if (flags.rest === false) {
        child(note, 'rest')?.remove();
        if (!child(note, 'pitch')) {
          const pitch = element(doc, 'pitch');
          pitch.append(element(doc, 'step', 'C'), element(doc, 'octave', 4));
          note.insertBefore(pitch, note.firstChild);
        }
      }
      if (flags.dead !== undefined || flags.ghost !== undefined) {
        let notehead = child(note, 'notehead');
        if (!notehead && (flags.dead || flags.ghost)) {
          notehead = element(doc, 'notehead', 'normal');
          note.appendChild(notehead);
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

function buildInsertedNotes(doc, spec) {
  const duration = integer(spec.duration ?? 4, 'duration', 1);
  const type = String(spec.type || 'quarter');
  if (spec.rest) {
    const note = element(doc, 'note');
    note.append(element(doc, 'rest'), element(doc, 'duration', duration), element(doc, 'type', type));
    return [note];
  }
  if (!Array.isArray(spec.notes) || spec.notes.length === 0) throw new Error('Inserted event requires notes');
  return spec.notes.map((value, index) => {
    const string = integer(value.string, 'string', 1, 6);
    const fret = integer(value.fret, 'fret', 0, 36);
    const note = element(doc, 'note');
    if (index > 0) note.appendChild(element(doc, 'chord'));
    const pitch = element(doc, 'pitch');
    pitch.append(element(doc, 'step', 'C'), element(doc, 'octave', 4));
    note.append(pitch, element(doc, 'duration', duration), element(doc, 'type', type));
    const technical = technicalFor(doc, note);
    technical.append(element(doc, 'string', string), element(doc, 'fret', fret));
    return note;
  });
}

export function insertEventCommand(doc, partId, { measureIndex, afterEventId = null, event: spec }) {
  measureAt(doc, partId, measureIndex);
  const preview = buildInsertedNotes(doc, spec || {});
  if (afterEventId && resolveEvent(doc, partId, afterEventId).measureIndex !== measureIndex) {
    throw new Error('Insertion anchor must be in the target measure');
  }
  return measureCommand(doc, partId, [measureIndex], () => {
    const measure = measureAt(doc, partId, measureIndex);
    const anchor = afterEventId ? resolveEvent(doc, partId, afterEventId).after : null;
    for (const note of preview.map((node) => node.cloneNode(true))) measure.insertBefore(note, anchor);
  });
}

export function deleteEventCommand(doc, partId, eventId) {
  const location = resolveEvent(doc, partId, eventId);
  return measureCommand(doc, partId, [location.measureIndex], () => {
    resolveEvent(doc, partId, eventId).notes.forEach((note) => note.remove());
  });
}

function removeTechnique(note, type, action) {
  if (type === 'tie') {
    children(note, 'tie').filter((node) => node.getAttribute('type') === action).forEach((node) => node.remove());
    descendants(note, 'tied').filter((node) => node.getAttribute('type') === action).forEach((node) => node.remove());
  } else {
    descendants(note, type).filter((node) => node.getAttribute('type') === action).forEach((node) => node.remove());
  }
}

function addTechnique(doc, note, type, action) {
  if (type === 'tie') {
    const tie = element(doc, 'tie');
    tie.setAttribute('type', action);
    note.appendChild(tie);
    const tied = element(doc, 'tied');
    tied.setAttribute('type', action);
    ensureChild(doc, note, 'notations').appendChild(tied);
    return;
  }
  const node = element(doc, type, action === 'start' ? ({ 'hammer-on': 'H', 'pull-off': 'P' }[type] || '') : '');
  node.setAttribute('type', action);
  node.setAttribute('number', '1');
  const parent = type === 'slide' ? ensureChild(doc, note, 'notations') : technicalFor(doc, note);
  parent.appendChild(node);
}

export function setTechniquePairCommand(doc, partId, type, startEventId, endEventId, enabled, noteIndex = 0) {
  if (!['hammer-on', 'pull-off', 'slide', 'tie'].includes(type)) throw new Error('Invalid technique type');
  if (typeof enabled !== 'boolean') throw new Error('Invalid technique state');
  const start = selectedNote(doc, partId, startEventId, noteIndex);
  const end = selectedNote(doc, partId, endEventId, noteIndex);
  return measureCommand(doc, partId, [start.measureIndex, end.measureIndex], () => {
    const startNote = selectedNote(doc, partId, startEventId, noteIndex).note;
    const endNote = selectedNote(doc, partId, endEventId, noteIndex).note;
    removeTechnique(startNote, type, 'start');
    removeTechnique(endNote, type, 'stop');
    if (enabled) {
      addTechnique(doc, startNote, type, 'start');
      addTechnique(doc, endNote, type, 'stop');
    }
  });
}

function barlineAt(doc, measure, location) {
  let barline = children(measure, 'barline').find((node) => (node.getAttribute('location') || 'right') === location);
  if (!barline) {
    barline = element(doc, 'barline');
    barline.setAttribute('location', location);
    location === 'left' ? measure.insertBefore(barline, measure.firstChild) : measure.appendChild(barline);
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
      barline.appendChild(repeat);
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
        barline.appendChild(ending);
      }
      removeEmptyBarline(barline);
    }
  });
}
