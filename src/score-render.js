import { parseMusicXml } from './musicxml.js';
import { buildScoreIndex } from './score-index.js';
import { layoutScore } from './score-layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const PRINT_LAYOUT_WIDTH = 703;
const scoreInteraction = new WeakMap();

function svgEl(name, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function append(parent, name, attributes, text) {
  const element = svgEl(name, attributes, text);
  parent.appendChild(element);
  return element;
}

function drawStaff(svg, layout) {
  const groups = new Map();
  for (const system of layout.systems) {
    const group = append(svg, 'g', { class: 'score-system', 'data-system-index': system.index });
    groups.set(system.index, group);
    for (const line of system.staffLines) {
      append(group, 'line', {
        class: 'score-staff-line', x1: line.x1, x2: line.x2, y1: line.y, y2: line.y
      });
    }
  }
  return groups;
}

function drawMeasures(groups, layout) {
  for (const measure of layout.measures) {
    const group = append(groups.get(measure.systemIndex), 'g', {
      class: 'score-measure', 'data-measure-number': measure.number,
      'data-measure-index': measure.index
    });
    append(group, 'rect', {
      class: 'score-measure-target', x: measure.x, y: measure.y,
      width: measure.width, height: measure.height, fill: 'transparent'
    });
    append(group, 'text', {
      class: 'score-measure-number', x: measure.x + 5, y: measure.staffTop - 7
    }, measure.number);
  }
}

function drawBarlineStroke(group, barline, x, width = 1.25) {
  append(group, 'line', {
    class: 'score-barline-stroke', x1: x, x2: x,
    y1: barline.y1, y2: barline.y2, 'stroke-width': width
  });
}

function drawBarlines(groups, layout) {
  for (const barline of layout.barlines) {
    const group = append(groups.get(barline.systemIndex), 'g', {
      class: 'score-barline', 'data-measure-index': barline.measureIndex,
      'data-location': barline.location
    });
    if (barline.style === 'light-heavy') {
      drawBarlineStroke(group, barline, barline.x - 4);
      drawBarlineStroke(group, barline, barline.x, 3.5);
    } else if (barline.style === 'heavy-light') {
      drawBarlineStroke(group, barline, barline.x, 3.5);
      drawBarlineStroke(group, barline, barline.x + 4);
    } else if (barline.style !== 'none') {
      drawBarlineStroke(group, barline, barline.x);
    }
    if (barline.repeat) {
      const dotX = barline.location === 'left' ? barline.x + 9 : barline.x - 9;
      const middle = (barline.y1 + barline.y2) / 2;
      append(group, 'circle', { class: 'score-repeat-dot', cx: dotX, cy: middle - 6, r: 2.1 });
      append(group, 'circle', { class: 'score-repeat-dot', cx: dotX, cy: middle + 6, r: 2.1 });
    }
  }
}

function eventAriaLabel(event, measureNumber) {
  const prefix = `${measureNumber}마디`;
  if (event.kind === 'rest') return `${prefix} 쉼표`;
  const notes = event.notes.map((note) => `${note.string}번 현 ${note.label}프렛`).join(', ');
  return `${prefix} ${notes || '음표'}`;
}

function drawEvents(groups, layout, selectedEventId, selectedNoteIndex = 0) {
  const eventInfo = new Map();
  for (const event of layout.events) {
    const measureNumber = layout.measures[event.measureIndex]?.number ?? event.measureIndex + 1;
    const selected = event.id === selectedEventId;
    const group = append(groups.get(event.systemIndex), 'g', {
      class: `score-event score-event-${event.kind}${selected ? ' selected' : ''}`,
      'data-event-id': event.id,
      'data-measure-index': event.measureIndex,
      tabindex: selected ? 0 : -1,
      role: 'button',
      'aria-pressed': String(selected),
      'aria-label': eventAriaLabel(event, measureNumber)
    });
    eventInfo.set(event.id, { ...event, measureNumber, ariaLabel: eventAriaLabel(event, measureNumber) });
    if (event.chord) {
      append(group, 'text', { class: 'score-chord', x: event.chord.x, y: event.chord.y }, event.chord.text);
    }
    if (event.kind === 'rest') {
      append(group, 'rect', {
        class: 'score-event-rest-target', x: event.x - 10, y: event.y - 10,
        width: 20, height: 20, rx: 4
      });
      append(group, 'text', { class: 'score-rest', x: event.x, y: event.y + 4 }, event.label);
    }
    for (const [noteIndex, note] of event.notes.entries()) {
      const width = Math.max(11, String(note.label).length * 7 + 4);
      append(group, 'rect', {
        class: `score-fret-background${selected && noteIndex === selectedNoteIndex ? ' selected-note' : ''}`,
        'data-note-index': noteIndex, x: note.x - width / 2, y: note.y - 6,
        width, height: 12, rx: 2
      });
      append(group, 'text', {
        class: `score-fret${selected && noteIndex === selectedNoteIndex ? ' selected-note' : ''}`,
        'data-note-index': noteIndex, x: note.x, y: note.y + 4
      }, note.label);
      if (note.bend) {
        const bend = append(group, 'g', { class: 'score-bend' });
        const top = note.y - 25;
        append(bend, 'path', {
          d: `M ${note.x + 5} ${note.y - 7} Q ${note.x + 12} ${note.y - 17} ${note.x + 8} ${top}`
        });
        append(bend, 'path', {
          class: 'score-bend-arrow',
          d: `M ${note.x + 8} ${top} l -3 5 M ${note.x + 8} ${top} l 5 1`
        });
        const label = note.bend.n === 1 && note.bend.d === 2
          ? '½'
          : `${note.bend.n}/${note.bend.d}`;
        append(bend, 'text', { x: note.x + 15, y: top + 3 }, label);
      }
    }
    if (event.stem) {
      append(group, 'line', {
        class: 'score-stem', x1: event.stem.x, x2: event.stem.x,
        y1: event.stem.y1, y2: event.stem.y2
      });
    }
    for (const dot of event.dots) {
      append(group, 'circle', { class: 'score-dot', cx: dot.x, cy: dot.y, r: 1.8 });
    }
    if (event.fermata) {
      append(group, 'path', {
        class: 'score-fermata',
        d: `M ${event.fermata.x - 8} ${event.fermata.y + 4} Q ${event.fermata.x} ${event.fermata.y - 5} ${event.fermata.x + 8} ${event.fermata.y + 4}`
      });
      append(group, 'circle', { class: 'score-fermata-dot', cx: event.fermata.x, cy: event.fermata.y + 2, r: 1.7 });
    }
  }
  return eventInfo;
}

function drawRhythm(groups, layout) {
  const byId = new Map(layout.events.map((event) => [event.id, event]));
  for (const beam of layout.beams) {
    let x1 = beam.x1;
    let x2 = beam.x2;
    if (beam.kind === 'hook') {
      const event = byId.get(beam.eventIds[0]);
      x1 = event?.x ?? x1;
      x2 = x1 + (beam.direction === 'backward' ? -12 : 12);
    }
    append(groups.get(beam.systemIndex), 'line', {
      class: `score-beam${beam.kind === 'hook' ? ' score-beam-hook' : ''}`,
      x1, x2, y1: beam.y, y2: beam.y, 'data-beam-level': beam.level
    });
  }
  for (const tuplet of layout.tuplets) {
    const group = append(groups.get(tuplet.systemIndex), 'g', { class: 'score-tuplet' });
    append(group, 'line', { x1: tuplet.x1, x2: tuplet.x2, y1: tuplet.y, y2: tuplet.y });
    append(group, 'text', { x: (tuplet.x1 + tuplet.x2) / 2, y: tuplet.y + 4 }, tuplet.label);
  }
}

function techniqueLabel(type) {
  return ({ 'hammer-on': 'H', 'pull-off': 'P', slide: 'S', tie: 'T' })[type] || type;
}

function drawTechniques(groups, layout) {
  for (const link of layout.links) {
    const group = append(groups.get(link.systemIndex), 'g', {
      class: `score-technique score-technique-${link.type}`,
      'data-start-event-id': link.startEventId,
      'data-end-event-id': link.endEventId
    });
    const x1 = Math.min(link.x1, link.x2);
    const x2 = Math.max(link.x1, link.x2);
    append(group, 'path', {
      d: `M ${x1} ${link.y + 4} Q ${(x1 + x2) / 2} ${link.y - 4} ${x2} ${link.y + 4}`
    });
    append(group, 'text', { x: (x1 + x2) / 2, y: link.y }, techniqueLabel(link.type));
  }

  for (const ending of layout.measures.flatMap((measure) => measure.endings || [])) {
    const group = append(groups.get(ending.systemIndex), 'g', { class: 'score-ending', 'data-ending-number': ending.number });
    append(group, 'line', { x1: ending.x1, x2: ending.x2, y1: ending.y, y2: ending.y });
    if (ending.startCap) append(group, 'line', { x1: ending.x1, x2: ending.x1, y1: ending.y, y2: ending.y + 9 });
    if (ending.stopCap) append(group, 'line', { x1: ending.x2, x2: ending.x2, y1: ending.y, y2: ending.y + 9 });
    if (ending.label) append(group, 'text', { x: ending.x1 + 5, y: ending.y - 3 }, ending.label);
  }
}

function selectRenderedEvent(svg, eventId, eventInfo, onSelect, focus = false, noteIndex = 0) {
  const groups = [...svg.querySelectorAll('[data-event-id]')];
  const target = groups.find((group) => group.dataset.eventId === eventId);
  if (!target) return null;
  for (const group of groups) {
    const selected = group === target;
    group.classList.toggle('selected', selected);
    group.setAttribute('aria-pressed', String(selected));
    group.setAttribute('tabindex', selected ? '0' : '-1');
  }
  for (const note of svg.querySelectorAll('[data-note-index]')) note.classList.remove('selected-note');
  target.querySelectorAll(`[data-note-index="${noteIndex}"]`).forEach((note) => note.classList.add('selected-note'));
  if (focus) target.focus();
  const selected = eventInfo.get(eventId);
  const payload = selected ? { ...selected, noteIndex } : null;
  if (payload) onSelect?.(payload);
  return payload;
}

function bindEventSelection(svg, eventInfo, onSelect) {
  scoreInteraction.set(svg, { eventInfo, onSelect });
  svg.addEventListener('click', (domEvent) => {
    const group = domEvent.target.closest?.('[data-event-id]');
    const noteIndex = Number(domEvent.target.closest?.('[data-note-index]')?.dataset.noteIndex || 0);
    const interaction = scoreInteraction.get(svg);
    if (group && svg.contains(group)) {
      selectRenderedEvent(svg, group.dataset.eventId, interaction.eventInfo, interaction.onSelect, false, noteIndex);
    }
  });
  svg.addEventListener('keydown', (domEvent) => {
    const group = domEvent.target.closest?.('[data-event-id]');
    if (!group || !svg.contains(group)) return;
    if (domEvent.key === 'Enter' || domEvent.key === ' ') {
      domEvent.preventDefault();
      domEvent.stopPropagation();
      const interaction = scoreInteraction.get(svg);
      selectRenderedEvent(svg, group.dataset.eventId, interaction.eventInfo, interaction.onSelect);
      return;
    }
    const direction = ({ ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 })[domEvent.key];
    if (!direction) return;
    domEvent.preventDefault();
    domEvent.stopPropagation();
    const groups = [...svg.querySelectorAll('[data-event-id]')];
    const current = groups.indexOf(group);
    const next = Math.max(0, Math.min(groups.length - 1, current + direction));
    const interaction = scoreInteraction.get(svg);
    selectRenderedEvent(svg, groups[next].dataset.eventId, interaction.eventInfo, interaction.onSelect, true);
  });
}

function buildScoreSvg(index, options = {}) {
  const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 1120;
  const layout = layoutScore(index, { ...options, width });
  const selectedEventId = layout.events.some((event) => event.id === options.selectedEventId)
    ? options.selectedEventId
    : layout.events[0]?.id;
  const svg = svgEl('svg', {
    class: 'professional-score', viewBox: `0 0 ${width} ${layout.totalHeight}`,
    width, height: layout.totalHeight, role: 'group', 'aria-label': '전문 기타 TAB 악보'
  });
  const groups = drawStaff(svg, layout);
  drawMeasures(groups, layout);
  drawBarlines(groups, layout);
  const eventInfo = drawEvents(groups, layout, selectedEventId, options.selectedNoteIndex || 0);
  drawRhythm(groups, layout);
  drawTechniques(groups, layout);
  bindEventSelection(svg, eventInfo, options.onSelect);
  return { svg, layout, eventInfo };
}

export function renderScoreSvg(host, index, options = {}) {
  const { svg, layout } = buildScoreSvg(index, options);
  host.replaceChildren(svg);
  return layout;
}

export function renderScoreDiagnostics(host, diagnostics = [], { onMeasure } = {}) {
  host.replaceChildren();
  host.removeAttribute('role');
  if (diagnostics.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'score-diagnostics-empty';
    empty.textContent = '진단 없음';
    host.appendChild(empty);
    return;
  }
  const grouped = new Map();
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
      diagnostic.measureNumber ?? null, diagnostic.code || '', diagnostic.message || ''
    ]);
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      if (diagnostic.severity === 'error') current.severity = 'error';
    } else grouped.set(key, { ...diagnostic, count: 1 });
  }
  const list = document.createElement('ul');
  for (const diagnostic of grouped.values()) {
    const item = document.createElement('li');
    item.className = `score-diagnostic score-diagnostic-${diagnostic.severity || 'warning'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.measureNumber = String(diagnostic.measureNumber ?? '');
    button.textContent = `${diagnostic.measureNumber ? `${diagnostic.measureNumber}마디 · ` : ''}${diagnostic.message || diagnostic.code || '알 수 없는 진단'}${diagnostic.count > 1 ? ` (${diagnostic.count}건)` : ''}`;
    if (diagnostic.measureNumber !== undefined && diagnostic.measureNumber !== null) {
      button.addEventListener('click', () => { onMeasure?.(String(diagnostic.measureNumber)); });
    } else {
      button.disabled = true;
    }
    item.appendChild(button);
    list.appendChild(item);
  }
  host.appendChild(list);
}

export function renderScoreInspector(host, event) {
  host.replaceChildren();
  const title = document.createElement('h2');
  title.textContent = '속성';
  host.appendChild(title);
  const body = document.createElement('p');
  if (!event) {
    body.textContent = '음표를 선택하면 세부 속성을 확인할 수 있습니다.';
  } else {
    body.textContent = `${event.ariaLabel} · ${event.id}`;
    body.dataset.eventId = event.id;
  }
  host.appendChild(body);
}

function renderEmptyScore(canvas) {
  const message = document.createElement('p');
  message.className = 'score-empty';
  message.textContent = '표시할 마디가 없습니다.';
  canvas.replaceChildren(message);
}

function renderIndexedScore({ canvas, diagnostics, index, options = {}, onMeasure }) {
  let layout;
  if (index.measures.length === 0) {
    renderEmptyScore(canvas);
    layout = layoutScore(index, options);
  } else {
    layout = renderScoreSvg(canvas, index, options);
  }
  renderScoreDiagnostics(diagnostics, index.diagnostics, { onMeasure });
  return layout;
}

function systemsForMeasures(layout, measureIndices) {
  const systems = new Set();
  for (const measureIndex of measureIndices || []) {
    const systemIndex = layout?.measures?.[measureIndex]?.systemIndex;
    if (systemIndex !== undefined) systems.add(systemIndex);
  }
  return systems;
}

function patchScoreSvg(liveSvg, stagedSvg, previousLayout, nextLayout, affectedMeasures) {
  const focusedEventId = liveSvg.contains(document.activeElement)
    ? document.activeElement.closest?.('[data-event-id]')?.dataset.eventId
    : null;
  const forcedSystems = systemsForMeasures(previousLayout, affectedMeasures);
  for (const systemIndex of systemsForMeasures(nextLayout, affectedMeasures)) forcedSystems.add(systemIndex);
  const liveGroups = new Map([...liveSvg.querySelectorAll(':scope > [data-system-index]')]
    .map((group) => [Number(group.dataset.systemIndex), group]));
  const stagedGroups = new Map([...stagedSvg.querySelectorAll(':scope > [data-system-index]')]
    .map((group) => [Number(group.dataset.systemIndex), group]));
  const count = Math.max(liveGroups.size, stagedGroups.size);

  for (let systemIndex = 0; systemIndex < count; systemIndex += 1) {
    const current = liveGroups.get(systemIndex);
    const replacement = stagedGroups.get(systemIndex);
    if (!replacement) {
      current?.remove();
    } else if (!current) {
      liveSvg.appendChild(replacement);
    } else if (forcedSystems.has(systemIndex) || current.outerHTML !== replacement.outerHTML) {
      current.replaceWith(replacement);
    }
  }
  for (const attribute of [...liveSvg.attributes]) liveSvg.removeAttribute(attribute.name);
  for (const attribute of [...stagedSvg.attributes]) liveSvg.setAttribute(attribute.name, attribute.value);
  const interaction = scoreInteraction.get(stagedSvg);
  if (interaction) scoreInteraction.set(liveSvg, interaction);
  if (focusedEventId) {
    [...liveSvg.querySelectorAll('[data-event-id]')]
      .find((event) => event.dataset.eventId === focusedEventId)
      ?.focus();
  }
}

export function renderScoreDocument({ canvas, diagnostics, musicxml, partId, options = {} }) {
  try {
    const doc = parseMusicXml(musicxml);
    const index = buildScoreIndex(doc, partId);
    const layout = renderIndexedScore({ canvas, diagnostics, index, options });
    return { doc, index, layout };
  } catch (error) {
    canvas.replaceChildren();
    diagnostics.replaceChildren();
    diagnostics.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.className = 'score-diagnostic score-diagnostic-error';
    message.textContent = `MusicXML 악보를 표시하지 못했습니다: ${error?.message || '알 수 없는 오류'}`;
    diagnostics.appendChild(message);
    return null;
  }
}

export function createScoreWorkspaceController({
  canvas,
  diagnostics,
  inspector,
  getSong,
  getScreenWidth,
  onMeasure,
  onRendered,
  renderInspector = renderScoreInspector,
  parse = parseMusicXml,
  buildIndex = buildScoreIndex,
  requestFrame = (callback) => window.requestAnimationFrame(callback),
  cancelFrame = (id) => window.cancelAnimationFrame(id),
  windowTarget = window
}) {
  let cachedKey = null;
  let cachedDoc = null;
  let cachedIndex = null;
  let renderedKey = null;
  let renderedWidth = null;
  let selectedEventId = null;
  let selectedNoteIndex = 0;
  let frameId = null;
  let printing = false;
  let lastResult = null;

  const readIndex = () => {
    const song = getSong();
    if (!song || typeof song.musicxml !== 'string') throw new Error('현재 MusicXML 곡이 없습니다');
    const key = `${song.id || ''}\u0000${song.selectedPartId || ''}\u0000${song.musicxml}`;
    if (key !== cachedKey) {
      cachedDoc = parse(song.musicxml);
      cachedIndex = buildIndex(cachedDoc, song.selectedPartId);
      cachedKey = key;
      renderedKey = null;
      if (!cachedIndex.measures.some((measure) => measure.events.some((event) => event.id === selectedEventId))) {
        selectedEventId = null;
        selectedNoteIndex = 0;
      }
    }
    return { doc: cachedDoc, index: cachedIndex, key };
  };

  const showError = (error) => {
    canvas.replaceChildren();
    diagnostics.replaceChildren();
    diagnostics.setAttribute('role', 'alert');
    const message = document.createElement('p');
    message.className = 'score-diagnostic score-diagnostic-error';
    message.textContent = `MusicXML 악보를 표시하지 못했습니다: ${error?.message || '알 수 없는 오류'}`;
    diagnostics.appendChild(message);
    renderInspector(inspector, null);
    lastResult = null;
    onRendered?.({ result: null, error });
    return null;
  };

  const renderAt = (width, force = false, preserveOnError = false, affectedMeasures = null) => {
    try {
      const { doc, index, key } = readIndex();
      if (!force && key === renderedKey && width === renderedWidth) return lastResult;
      let selectedEvent = null;
      const stagedCanvas = document.createElement('div');
      const stagedDiagnostics = document.createElement('div');
      const layout = renderIndexedScore({
        canvas: stagedCanvas,
        diagnostics: stagedDiagnostics,
        index,
        onMeasure,
        options: {
          width,
          selectedEventId,
          selectedNoteIndex,
          onSelect: (event) => {
            selectedEventId = event.id;
            selectedNoteIndex = event.noteIndex || 0;
            renderInspector(inspector, event);
          }
        }
      });
      if (!selectedEventId && layout.events.length > 0) selectedEventId = layout.events[0].id;
      if (selectedEventId) {
        const layoutEvent = layout.events.find((event) => event.id === selectedEventId);
        if (layoutEvent) {
          const measureNumber = layout.measures[layoutEvent.measureIndex]?.number ?? layoutEvent.measureIndex + 1;
          selectedEvent = {
            ...layoutEvent,
            noteIndex: selectedNoteIndex,
            measureNumber,
            ariaLabel: eventAriaLabel(layoutEvent, measureNumber)
          };
        }
      }
      const liveSvg = canvas.querySelector(':scope > svg.professional-score');
      const stagedSvg = stagedCanvas.querySelector(':scope > svg.professional-score');
      const canPatch = Array.isArray(affectedMeasures)
        && liveSvg && stagedSvg && renderedWidth === width && lastResult?.layout;
      if (canPatch) {
        patchScoreSvg(liveSvg, stagedSvg, lastResult.layout, layout, affectedMeasures);
      } else {
        canvas.replaceChildren(...stagedCanvas.childNodes);
      }
      diagnostics.replaceChildren(...stagedDiagnostics.childNodes);
      diagnostics.removeAttribute('role');
      renderInspector(inspector, selectedEvent);
      renderedKey = key;
      renderedWidth = width;
      lastResult = { doc, index, layout };
      onRendered?.({ width, ...lastResult });
      return lastResult;
    } catch (error) {
      if (preserveOnError) return lastResult;
      return showError(error);
    }
  };

  const renderScreen = (force = false) => renderAt(getScreenWidth(), force);
  const renderMeasures = (measureIndices, eventId = selectedEventId, noteIndex = selectedNoteIndex) => {
    if (printing) return lastResult;
    selectedEventId = eventId || selectedEventId;
    selectedNoteIndex = Number.isInteger(noteIndex) ? noteIndex : selectedNoteIndex;
    return renderAt(getScreenWidth(), true, false, measureIndices);
  };
  const scheduleScreenRender = () => {
    if (printing || frameId !== null) return;
    frameId = requestFrame(() => {
      frameId = null;
      if (!printing) renderScreen();
    });
  };
  const beforePrint = () => {
    printing = true;
    if (frameId !== null) {
      cancelFrame(frameId);
      frameId = null;
    }
    renderAt(PRINT_LAYOUT_WIDTH, true, true);
  };
  const afterPrint = () => {
    printing = false;
    renderScreen(true);
  };
  const destroy = () => {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
    windowTarget.removeEventListener('beforeprint', beforePrint);
    windowTarget.removeEventListener('afterprint', afterPrint);
  };

  windowTarget.addEventListener('beforeprint', beforePrint);
  windowTarget.addEventListener('afterprint', afterPrint);

  const setSelectedEventId = (eventId, noteIndex = 0) => {
    selectedEventId = eventId || null;
    selectedNoteIndex = Number.isInteger(noteIndex) ? noteIndex : 0;
  };
  const getSelectedEventId = () => selectedEventId;
  const getSelectedNoteIndex = () => selectedNoteIndex;
  const getLastResult = () => lastResult;
  return {
    renderScreen, scheduleScreenRender, beforePrint, afterPrint, destroy,
    renderMeasures, setSelectedEventId, getSelectedEventId, getSelectedNoteIndex, getLastResult
  };
}

export function setScoreViewMode(mode, { settings, song, persist, elements }) {
  const next = mode === 'score' ? 'score' : 'grid';
  settings.viewMode = next;
  elements.gridWorkspace.hidden = next === 'score';
  elements.scoreWorkspace.hidden = next !== 'score';
  if (elements.pad) elements.pad.hidden = next === 'score';
  elements.modeGrid?.setAttribute('aria-pressed', String(next === 'grid'));
  elements.modeScore?.setAttribute('aria-pressed', String(next === 'score'));
  elements.modeGrid?.classList.toggle('on', next === 'grid');
  elements.modeScore?.classList.toggle('on', next === 'score');
  persist?.();
  return { mode: next, editorMode: song?.editorMode };
}
