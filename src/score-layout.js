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
  return {
    width: finitePositive(options.width, DEFAULTS.width),
    minMeasureWidth: finitePositive(options.minMeasureWidth, DEFAULTS.minMeasureWidth),
    leftPadding: finitePositive(options.leftPadding, DEFAULTS.leftPadding),
    rightPadding: finitePositive(options.rightPadding, DEFAULTS.rightPadding),
    columnWidth: finitePositive(options.columnWidth, DEFAULTS.columnWidth),
    staffGap: finitePositive(options.staffGap, DEFAULTS.staffGap),
    systemGap: finitePositive(options.systemGap, DEFAULTS.systemGap),
    systemTopPadding: finitePositive(options.systemTopPadding, DEFAULTS.systemTopPadding),
    systemBottomPadding: finitePositive(options.systemBottomPadding, DEFAULTS.systemBottomPadding),
    techniqueLaneHeight: finitePositive(options.techniqueLaneHeight, DEFAULTS.techniqueLaneHeight)
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

function beamLevel(duration) {
  const quarters = rationalNumber(duration);
  if (!(quarters > 0) || quarters > 0.5) return 0;
  return Math.max(1, Math.round(Math.log2(1 / quarters)));
}

function eventDots(event) {
  const count = event.dots ?? Math.max(0, ...(event.notes || []).map((note) => note.dots || 0));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

function endingRecords(measure, layout, options) {
  const endings = measure.endings || [];
  const seen = new Set();
  return endings.flatMap((ending) => {
    const key = `${ending.number}:${ending.type}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      number: String(ending.number),
      type: ending.type,
      x1: layout.x,
      x2: layout.x + layout.width,
      y: layout.staffTop - options.techniqueLaneHeight * 2
    }];
  });
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
    const level = event.kind === 'notes' ? beamLevel(event.duration) : 0;
    const durationInQuarters = rationalNumber(event.duration);
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
      let group = [];
      const flush = () => {
        if (group.length >= 2) {
          records.push({
            measureIndex: measure.index,
            systemIndex: measure.systemIndex,
            level,
            eventIds: group.map((event) => event.id),
            x1: group[0].x,
            x2: group.at(-1).x,
            y: measure.staffBottom + 26 + level * 5
          });
        }
        group = [];
      };
      for (const event of measureEvents) {
        if ((event.beamLevel || 0) >= level) group.push(event);
        else flush();
      }
      flush();
    }
  }
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

function techniqueLinkRecords(sourceLinks, events, systems, options) {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const lanesBySystem = new Map();
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
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      const occupied = lanesBySystem.get(systemIndex) || [];
      let lane = 0;
      while (occupied[lane] !== undefined && left <= occupied[lane] + 8) lane += 1;
      occupied[lane] = right;
      lanesBySystem.set(systemIndex, occupied);
      records.push({
        type: link.type,
        number: link.number,
        startEventId: link.startEventId,
        endEventId: link.endEventId,
        sourceIndex,
        systemIndex,
        lane,
        x1,
        x2,
        y: system.staffTop - options.techniqueLaneHeight * (lane + 1)
      });
    }
  }
  return records;
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
        rhythmicColumns: widths[measureIndex].columns
      };
      layout.endings = endingRecords(source, layout, settings);
      measures.push(layout);
      x += layout.width;
    }
  }

  const events = measures.flatMap((measureLayout) => layoutEvents(
    sourceMeasures[measureLayout.index],
    measureLayout,
    settings
  ));
  const barlines = measures.flatMap((measureLayout) => makeBarlines(
    sourceMeasures[measureLayout.index],
    measureLayout,
    systems[measureLayout.systemIndex].measureIndexes[0] === measureLayout.index
  ));
  const beams = beamRecords(events, measures);
  const tuplets = tupletRecords(events, measures);
  const links = techniqueLinkRecords(index?.links, events, systems, settings);
  const hitBoxes = makeHitBoxes(events, settings.staffGap);
  const totalHeight = systems.at(-1).y + systems.at(-1).height;

  return { systems, measures, events, beams, tuplets, links, barlines, hitBoxes, totalHeight };
}
