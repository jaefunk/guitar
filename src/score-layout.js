const DEFAULTS = Object.freeze({
  width: 1120,
  minMeasureWidth: 180,
  leftPadding: 28,
  rightPadding: 20,
  columnWidth: 32,
  staffGap: 12,
  systemGap: 36,
  systemTopPadding: 76,
  systemBottomPadding: 48,
  techniqueLaneHeight: 16
});

function finitePositive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function optionsWithDefaults(options) {
  const source = options || {};
  return {
    width: finitePositive(source.width, DEFAULTS.width),
    minMeasureWidth: finitePositive(source.minMeasureWidth, DEFAULTS.minMeasureWidth),
    leftPadding: finitePositive(source.leftPadding, DEFAULTS.leftPadding),
    rightPadding: finitePositive(source.rightPadding, DEFAULTS.rightPadding),
    columnWidth: finitePositive(source.columnWidth, DEFAULTS.columnWidth),
    staffGap: finitePositive(source.staffGap, DEFAULTS.staffGap),
    systemGap: finitePositive(source.systemGap, DEFAULTS.systemGap),
    systemTopPadding: finitePositive(source.systemTopPadding, DEFAULTS.systemTopPadding),
    systemBottomPadding: finitePositive(source.systemBottomPadding, DEFAULTS.systemBottomPadding),
    techniqueLaneHeight: finitePositive(source.techniqueLaneHeight, DEFAULTS.techniqueLaneHeight)
  };
}

function rationalKey(value) {
  return `${value?.n ?? 0}/${value?.d ?? 1}`;
}

function rationalNumber(value) {
  return (value?.n ?? 0) / (value?.d || 1);
}

function rhythmicColumns(measure) {
  return new Set((measure.events || []).map((event) => rationalKey(event.onset))).size;
}

function measureWidths(measures, options) {
  return measures.map((measure) => {
    const columns = rhythmicColumns(measure);
    const desired = Math.max(
      options.minMeasureWidth,
      options.leftPadding + columns * options.columnWidth + options.rightPadding
    );
    return { columns, width: desired };
  });
}

function groupSystems(widths, widthLimit) {
  const groups = [];
  let current = [];
  let width = 0;

  widths.forEach((item, measureIndex) => {
    if (current.length > 0 && width + item.width > widthLimit) {
      groups.push({ measureIndexes: current, width });
      current = [];
      width = 0;
    }
    current.push(measureIndex);
    width += item.width;
  });

  if (current.length > 0) groups.push({ measureIndexes: current, width });
  return groups;
}

const NOTATION_QUARTERS = Object.freeze({
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 1 / 2,
  '16th': 1 / 4,
  '32nd': 1 / 8,
  '64th': 1 / 16,
  '128th': 1 / 32,
  '256th': 1 / 64,
  '512th': 1 / 128,
  '1024th': 1 / 256
});

function dotMultiplier(dots) {
  let multiplier = 1;
  for (let index = 1; index <= dots; index += 1) multiplier += 1 / (2 ** index);
  return multiplier;
}

function notationQuarters(event) {
  if (NOTATION_QUARTERS[event.noteType] !== undefined) return NOTATION_QUARTERS[event.noteType];
  let quarters = rationalNumber(event.duration) / dotMultiplier(eventDots(event));
  if (event.tuplet?.actual > 0 && event.tuplet?.normal > 0) {
    quarters *= event.tuplet.actual / event.tuplet.normal;
  }
  return quarters;
}

function beamLevel(event) {
  if (event.beams?.length > 0) {
    return Math.max(...event.beams.map((beam) => beam.number));
  }
  const quarters = notationQuarters(event);
  if (!(quarters > 0) || quarters > 0.5) return 0;
  return Math.max(1, Math.round(Math.log2(1 / quarters)));
}

function eventDots(event) {
  const count = event.dots ?? Math.max(0, ...(event.notes || []).map((note) => note.dots || 0));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

function endingNumbers(number) {
  return String(number || '').split(/[\s,]+/).filter(Boolean);
}

function measureEndingMarkers(measure) {
  const markers = [
    ...(measure.endings || []),
    ...(measure.barlines || []).flatMap((barline) => barline.ending ? [barline.ending] : [])
  ];
  const seen = new Set();
  return markers.flatMap((marker) => {
    const originalNumber = String(marker.number ?? '');
    const originalType = String(marker.type ?? '');
    const numbers = endingNumbers(originalNumber);
    if (numbers.length === 0) {
      const key = `raw:${originalNumber}:${originalType}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        number: originalNumber,
        type: originalType,
        originalNumber,
        originalType,
        malformed: 'missing-number'
      }];
    }
    return numbers.flatMap((number) => {
      const key = `${number}:${originalType}`;
      if (seen.has(key)) return [];
      seen.add(key);
      if (!['start', 'stop', 'discontinue'].includes(originalType)) {
        return [{
          number,
          type: originalType,
          originalNumber,
          originalType,
          malformed: 'unknown-type'
        }];
      }
      return [{ number, type: originalType }];
    });
  });
}

function pairEndingSpans(sourceMeasures) {
  const active = new Map();
  const spans = [];
  let order = 0;
  sourceMeasures.forEach((measure, measureIndex) => {
    for (const marker of measureEndingMarkers(measure)) {
      if (marker.malformed) {
        spans.push({
          ...marker,
          startMeasureIndex: measureIndex,
          endMeasureIndex: measureIndex,
          order: order += 1
        });
        continue;
      }
      const stack = active.get(marker.number) || [];
      if (marker.type === 'start') {
        stack.push({ number: marker.number, startMeasureIndex: measureIndex, order: order += 1 });
        active.set(marker.number, stack);
      } else if (marker.type === 'stop' || marker.type === 'discontinue') {
        const start = stack.pop();
        if (stack.length === 0) active.delete(marker.number);
        if (start) {
          spans.push({ ...start, endMeasureIndex: measureIndex, type: marker.type });
        } else {
          spans.push({
            number: marker.number,
            startMeasureIndex: measureIndex,
            endMeasureIndex: measureIndex,
            type: marker.type,
            malformed: 'unmatched-stop',
            order: order += 1
          });
        }
      }
    }
  });
  for (const stack of active.values()) {
    for (const start of stack) {
      spans.push({
        ...start,
        endMeasureIndex: sourceMeasures.length - 1,
        type: 'start',
        open: true,
        malformed: 'unmatched-start'
      });
    }
  }
  return spans.sort((a, b) => a.order - b.order);
}

function endingSegments(sourceMeasures, measures, systems) {
  const segments = [];
  for (const span of pairEndingSpans(sourceMeasures)) {
    const firstSystem = measures[span.startMeasureIndex].systemIndex;
    const lastSystem = measures[span.endMeasureIndex].systemIndex;
    for (let systemIndex = firstSystem; systemIndex <= lastSystem; systemIndex += 1) {
      const system = systems[systemIndex];
      const startMeasureIndex = Math.max(span.startMeasureIndex, system.measureIndexes[0]);
      const endMeasureIndex = Math.min(span.endMeasureIndex, system.measureIndexes.at(-1));
      const first = systemIndex === firstSystem;
      const last = systemIndex === lastSystem;
      const startMeasure = measures[startMeasureIndex];
      const endMeasure = measures[endMeasureIndex];
      const segment = {
        number: span.number,
        type: span.type,
        systemIndex,
        startMeasureIndex,
        endMeasureIndex,
        x1: startMeasure.x,
        x2: endMeasure.x + endMeasure.width,
        ...(first ? { label: span.number } : {}),
        startCap: first,
        stopCap: last && span.type === 'stop',
        discontinue: last && span.type === 'discontinue',
        continuationStart: !first,
        continuationEnd: !last,
        ...(span.open ? { open: true } : {}),
        ...(span.malformed ? {
          malformed: span.malformed,
          originalNumber: span.originalNumber ?? span.number,
          originalType: span.originalType ?? span.type
        } : {})
      };
      measures[startMeasureIndex].endings.push(segment);
      segments.push(segment);
    }
  }
  return segments;
}

function makeBarlines(measure, measureLayout, isSystemStart) {
  const source = measure.barlines || [];
  const records = [];
  const hasLeft = source.some((barline) => barline.location === 'left');
  const hasRight = source.some((barline) => barline.location === 'right');

  if (isSystemStart && !hasLeft) {
    records.push({
      measureIndex: measureLayout.index,
      systemIndex: measureLayout.systemIndex,
      location: 'left',
      style: 'regular',
      x: measureLayout.x,
      y1: measureLayout.staffTop,
      y2: measureLayout.staffBottom
    });
  }
  for (const barline of source) {
    const location = barline.location === 'left' ? 'left' : 'right';
    records.push({
      measureIndex: measureLayout.index,
      systemIndex: measureLayout.systemIndex,
      location,
      style: barline.style || 'regular',
      ...(barline.repeat ? { repeat: barline.repeat } : {}),
      ...(barline.ending ? { ending: { ...barline.ending } } : {}),
      x: location === 'left' ? measureLayout.x : measureLayout.x + measureLayout.width,
      y1: measureLayout.staffTop,
      y2: measureLayout.staffBottom
    });
  }
  if (!hasRight) {
    records.push({
      measureIndex: measureLayout.index,
      systemIndex: measureLayout.systemIndex,
      location: 'right',
      style: 'regular',
      x: measureLayout.x + measureLayout.width,
      y1: measureLayout.staffTop,
      y2: measureLayout.staffBottom
    });
  }
  return records;
}

function layoutEvents(measure, measureLayout, options) {
  const onsetKeys = [...new Set((measure.events || []).map((event) => rationalKey(event.onset)))];
  const onsetColumns = new Map(onsetKeys.map((key, index) => [key, index]));
  const usableWidth = Math.max(0, measureLayout.width - options.leftPadding - options.rightPadding);
  const spacing = usableWidth / Math.max(1, onsetKeys.length);

  return (measure.events || []).map((event) => {
    const column = onsetColumns.get(rationalKey(event.onset)) || 0;
    const x = measureLayout.x + options.leftPadding + spacing * (column + 0.5);
    const dots = Array.from({ length: eventDots(event) }, (_, dotIndex) => ({
      x: x + 9 + dotIndex * 5,
      y: measureLayout.staffBottom + 23
    }));
    const level = event.kind === 'notes' ? beamLevel(event) : 0;
    const durationInQuarters = event.kind === 'notes' ? notationQuarters(event) : 0;
    const hasStem = event.kind === 'notes'
      && durationInQuarters > 0
      && durationInQuarters < 4;
    const record = {
      id: event.id,
      kind: event.kind,
      measureIndex: measureLayout.index,
      systemIndex: measureLayout.systemIndex,
      onset: { ...event.onset },
      duration: { ...event.duration },
      x,
      y: event.kind === 'rest' ? measureLayout.staffTop + options.staffGap * 2.5 : measureLayout.staffBottom,
      notes: event.kind === 'notes' ? (event.notes || []).map((note) => ({
        ...note,
        label: note.dead ? 'x' : String(note.fret ?? ''),
        x,
        y: measureLayout.staffTop + ((note.string || 1) - 1) * options.staffGap
      })) : [],
      dots
    };
    if (event.kind === 'rest') record.label = '𝜽';
    if (event.chordSymbol) record.chordSymbol = event.chordSymbol;
    if (event.noteType) record.noteType = event.noteType;
    if (event.beams?.length > 0) record.beams = event.beams.map((beam) => ({ ...beam }));
    if (event.kind === 'notes') record.beamLevel = level;
    if (hasStem) {
      record.stem = {
        x,
        y1: measureLayout.staffBottom + 7,
        y2: measureLayout.staffBottom + 30
      };
    }
    if (event.fermata) {
      record.fermata = { x, y: measureLayout.staffTop - 18 };
    }
    if (event.tuplet) record.tuplet = { ...event.tuplet };
    return record;
  });
}

function makeHitBoxes(events, staffGap) {
  return events.flatMap((event) => event.notes.map((note, noteIndex) => {
    const width = Math.max(12, note.label.length * 8 + 6);
    const height = Math.min(12, staffGap);
    return {
      id: `${event.id}:note:${noteIndex}`,
      kind: 'fret',
      eventId: event.id,
      noteIndex,
      x: note.x - width / 2,
      y: note.y - height / 2,
      width,
      height
    };
  }));
}

function beamRecords(events, measures) {
  const records = [];
  for (const measure of measures) {
    const measureEvents = events.filter((event) => event.measureIndex === measure.index);
    const maxLevel = Math.max(0, ...measureEvents.map((event) => event.beamLevel || 0));
    for (let level = 1; level <= maxLevel; level += 1) {
      const hasExplicitLevel = measureEvents.some((event) => (
        event.beams || []
      ).some((beam) => beam.number === level));
      if (hasExplicitLevel) {
        records.push(...explicitBeamRecords(measureEvents, measure, level));
      } else {
        records.push(...fallbackBeamRecords(measureEvents, measure, level));
      }
    }
  }
  return records;
}

function beamRecord(measure, level, group, extra = {}) {
  return {
    kind: 'beam',
    measureIndex: measure.index,
    systemIndex: measure.systemIndex,
    level,
    eventIds: group.map((event) => event.id),
    x1: group[0].x,
    x2: group.at(-1).x,
    y: measure.staffBottom + 26 + level * 5,
    ...extra
  };
}

function fallbackBeamRecords(events, measure, level) {
  const records = [];
  let group = [];
  const flush = () => {
    if (group.length >= 2) records.push(beamRecord(measure, level, group));
    group = [];
  };
  for (const event of events) {
    const canFallback = event.kind === 'notes'
      && !event.beams?.length
      && (event.beamLevel || 0) >= level;
    if (canFallback) group.push(event);
    else flush();
  }
  flush();
  return records;
}

function explicitBeamRecords(events, measure, level) {
  const records = [];
  let openGroup = null;
  const flushOpen = () => {
    if (!openGroup) return;
    records.push(beamRecord(measure, level, openGroup.events, {
      ...(openGroup.malformed ? { malformed: openGroup.malformed } : {}),
      open: true
    }));
    openGroup = null;
  };

  for (const event of events) {
    const beam = event.kind === 'notes'
      ? (event.beams || []).find((candidate) => candidate.number === level)
      : null;
    if (!beam) {
      flushOpen();
      continue;
    }

    if (beam.state === 'begin') {
      flushOpen();
      openGroup = { events: [event] };
      continue;
    }
    if (beam.state === 'continue') {
      if (!openGroup) openGroup = { events: [], malformed: 'unmatched-continue' };
      openGroup.events.push(event);
      continue;
    }
    if (beam.state === 'end') {
      if (!openGroup) {
        records.push(beamRecord(measure, level, [event], { malformed: 'unmatched-end' }));
      } else {
        openGroup.events.push(event);
        records.push(beamRecord(measure, level, openGroup.events, {
          ...(openGroup.malformed ? { malformed: openGroup.malformed } : {})
        }));
        openGroup = null;
      }
      continue;
    }
    if (beam.state === 'forward hook' || beam.state === 'backward hook') {
      flushOpen();
      const direction = beam.state.split(' ')[0];
      records.push({
        ...beamRecord(measure, level, [event]),
        kind: 'hook',
        direction
      });
      continue;
    }

    flushOpen();
    records.push(beamRecord(measure, level, [event], { malformed: 'unknown-state' }));
  }
  flushOpen();
  return records;
}

function tupletRecords(events, measures) {
  const records = [];
  for (const measure of measures) {
    const measureEvents = events.filter((event) => event.measureIndex === measure.index);
    let group = [];
    let signature = null;
    const flush = () => {
      if (group.length >= 2) {
        records.push({
          measureIndex: measure.index,
          systemIndex: measure.systemIndex,
          actual: signature.actual,
          normal: signature.normal,
          label: String(signature.actual),
          eventIds: group.map((event) => event.id),
          x1: group[0].x,
          x2: group.at(-1).x,
          y: measure.staffBottom + 44
        });
      }
      group = [];
      signature = null;
    };
    for (const event of measureEvents) {
      const current = event.tuplet ? `${event.tuplet.actual}:${event.tuplet.normal}` : null;
      const previous = signature ? `${signature.actual}:${signature.normal}` : null;
      if (!current || (previous && current !== previous)) flush();
      if (current) {
        if (!signature) signature = event.tuplet;
        group.push(event);
      }
    }
    flush();
  }
  return records;
}

function techniqueLinkRecords(sourceLinks, events, systems) {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const records = [];

  for (const [sourceIndex, link] of (sourceLinks || []).entries()) {
    const start = eventById.get(link.startEventId);
    const end = eventById.get(link.endEventId);
    if (!start || !end) continue;
    const firstSystem = Math.min(start.systemIndex, end.systemIndex);
    const lastSystem = Math.max(start.systemIndex, end.systemIndex);

    for (let systemIndex = firstSystem; systemIndex <= lastSystem; systemIndex += 1) {
      const system = systems[systemIndex];
      const x1 = systemIndex === start.systemIndex ? start.x : 0;
      const x2 = systemIndex === end.systemIndex ? end.x : system.width;
      records.push({
        type: link.type,
        number: link.number,
        startEventId: link.startEventId,
        endEventId: link.endEventId,
        sourceIndex,
        systemIndex,
        x1,
        x2
      });
    }
  }
  return records;
}

function intervalsOverlap(a, b) {
  const margin = a.annotationKind === 'ending' && b.annotationKind === 'ending' ? 0 : 4;
  return a.x1 < b.x2 + margin && b.x1 < a.x2 + margin;
}

function allocateAnnotationLanes(candidates, systemCount) {
  const laneIntervals = Array.from({ length: systemCount }, () => []);
  const ordered = [...candidates].sort((a, b) => (
    a.systemIndex - b.systemIndex
    || a.x1 - b.x1
    || a.x2 - b.x2
    || a.order - b.order
  ));
  for (const candidate of ordered) {
    const lanes = laneIntervals[candidate.systemIndex];
    let lane = 0;
    while ((lanes[lane] || []).some((interval) => intervalsOverlap(candidate, interval))) lane += 1;
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push({
      x1: candidate.x1,
      x2: candidate.x2,
      annotationKind: candidate.annotationKind
    });
    candidate.lane = lane;
  }
  return laneIntervals.map((lanes) => lanes.length);
}

function annotationCandidates(endings, links, events, tuplets) {
  const candidates = [];
  let order = 0;
  const add = (annotationKind, record, systemIndex, x1, x2) => {
    candidates.push({ annotationKind, record, systemIndex, x1, x2, order: order += 1 });
  };
  for (const ending of endings) add('ending', ending, ending.systemIndex, ending.x1, ending.x2);
  for (const link of links) add('technique', link, link.systemIndex, Math.min(link.x1, link.x2), Math.max(link.x1, link.x2));
  for (const event of events) {
    if (event.fermata) add('fermata', event.fermata, event.systemIndex, event.x - 9, event.x + 9);
    if (event.chordSymbol) {
      event.chord = { text: event.chordSymbol, x: event.x };
      add('chord', event.chord, event.systemIndex, event.x - 14, event.x + 14);
    }
  }
  for (const tuplet of tuplets) add('tuplet', tuplet, tuplet.systemIndex, tuplet.x1, tuplet.x2);
  return candidates;
}

function reflowSystems(systems, measures, events, laneCounts, options) {
  let y = 0;
  for (const system of systems) {
    const annotationLaneCount = laneCounts[system.index] || 0;
    const topPadding = Math.max(
      options.systemTopPadding,
      8 + annotationLaneCount * options.techniqueLaneHeight
    );
    system.y = y;
    system.annotationLaneCount = annotationLaneCount;
    system.topPadding = topPadding;
    system.height = topPadding + options.staffGap * 5 + options.systemBottomPadding;
    system.staffTop = y + topPadding;
    system.staffBottom = system.staffTop + options.staffGap * 5;
    system.staffLines = system.staffLines.map((line, stringIndex) => ({
      ...line,
      y: system.staffTop + stringIndex * options.staffGap
    }));
    y += system.height + options.systemGap;
  }

  for (const measure of measures) {
    const system = systems[measure.systemIndex];
    measure.y = system.y;
    measure.height = system.height;
    measure.staffTop = system.staffTop;
    measure.staffBottom = system.staffBottom;
  }
  for (const event of events) {
    const measure = measures[event.measureIndex];
    event.y = event.kind === 'rest' ? measure.staffTop + options.staffGap * 2.5 : measure.staffBottom;
    event.notes = event.notes.map((note) => ({
      ...note,
      y: measure.staffTop + ((note.string || 1) - 1) * options.staffGap
    }));
    event.dots = event.dots.map((dot) => ({ ...dot, y: measure.staffBottom + 23 }));
    if (event.stem) {
      event.stem = { ...event.stem, y1: measure.staffBottom + 7, y2: measure.staffBottom + 30 };
    }
  }
}

function positionAnnotations(candidates, systems, options) {
  return candidates.map((candidate) => {
    const system = systems[candidate.systemIndex];
    const boxY = system.staffTop - 8 - (candidate.lane + 1) * options.techniqueLaneHeight;
    const box = {
      id: `annotation:${candidate.order}`,
      kind: 'annotation',
      annotationKind: candidate.annotationKind,
      systemIndex: candidate.systemIndex,
      x: candidate.x1,
      y: boxY,
      width: Math.max(1, candidate.x2 - candidate.x1),
      height: Math.max(1, options.techniqueLaneHeight - 4)
    };
    candidate.record.lane = candidate.lane;
    candidate.record.y = box.y + box.height / 2;
    candidate.record.box = { ...box };
    return box;
  });
}

export function layoutScore(index, options = {}) {
  const settings = optionsWithDefaults(options);
  const sourceMeasures = index?.measures || [];
  if (sourceMeasures.length === 0) {
    return {
      systems: [], measures: [], events: [], beams: [], tuplets: [], links: [],
      barlines: [], hitBoxes: [], totalHeight: 0
    };
  }

  const widths = measureWidths(sourceMeasures, settings);
  const oversizedMeasure = widths.findIndex((measure) => measure.width > settings.width);
  if (oversizedMeasure !== -1) {
    throw new RangeError(
      `Measure ${sourceMeasures[oversizedMeasure].number ?? oversizedMeasure + 1} `
      + `required ${widths[oversizedMeasure].width}, available ${settings.width}`
    );
  }
  const groups = groupSystems(widths, settings.width);
  const systemHeight = settings.systemTopPadding
    + settings.staffGap * 5
    + settings.systemBottomPadding;
  const systems = groups.map((group, systemIndex) => {
    const y = systemIndex * (systemHeight + settings.systemGap);
    const staffTop = y + settings.systemTopPadding;
    return {
      index: systemIndex,
      x: 0,
      y,
      width: group.width,
      height: systemHeight,
      staffTop,
      staffBottom: staffTop + settings.staffGap * 5,
      measureIndexes: [...group.measureIndexes],
      staffLines: Array.from({ length: 6 }, (_, stringIndex) => ({
        string: stringIndex + 1,
        x1: 0,
        x2: group.width,
        y: staffTop + stringIndex * settings.staffGap
      }))
    };
  });

  const measures = [];
  for (const system of systems) {
    let x = 0;
    for (const measureIndex of system.measureIndexes) {
      const source = sourceMeasures[measureIndex];
      const layout = {
        index: measureIndex,
        number: source.number,
        systemIndex: system.index,
        x,
        y: system.y,
        width: widths[measureIndex].width,
        height: system.height,
        staffTop: system.staffTop,
        staffBottom: system.staffBottom,
        rhythmicColumns: widths[measureIndex].columns,
        endings: []
      };
      measures.push(layout);
      x += layout.width;
    }
  }

  const events = measures.flatMap((measureLayout) => layoutEvents(
    sourceMeasures[measureLayout.index],
    measureLayout,
    settings
  ));
  const endings = endingSegments(sourceMeasures, measures, systems);
  const tuplets = tupletRecords(events, measures);
  const links = techniqueLinkRecords(index?.links, events, systems);
  const annotations = annotationCandidates(endings, links, events, tuplets);
  const laneCounts = allocateAnnotationLanes(annotations, systems.length);
  reflowSystems(systems, measures, events, laneCounts, settings);
  const annotationBoxes = positionAnnotations(annotations, systems, settings);
  const barlines = measures.flatMap((measureLayout) => makeBarlines(
    sourceMeasures[measureLayout.index],
    measureLayout,
    systems[measureLayout.systemIndex].measureIndexes[0] === measureLayout.index
  ));
  const beams = beamRecords(events, measures);
  const hitBoxes = [...makeHitBoxes(events, settings.staffGap), ...annotationBoxes];
  const totalHeight = systems.at(-1).y + systems.at(-1).height;

  return { systems, measures, events, beams, tuplets, links, barlines, hitBoxes, totalHeight };
}
