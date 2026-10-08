import { parseMusicXml } from './musicxml.js';
import { buildScoreIndex } from './score-index.js';
import { layoutScore } from './score-layout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
  for (const system of layout.systems) {
    const group = append(svg, 'g', { class: 'score-system', 'data-system-index': system.index });
    for (const line of system.staffLines) {
      append(group, 'line', {
        class: 'score-staff-line', x1: line.x1, x2: line.x2, y1: line.y, y2: line.y
      });
    }
  }
}

function drawMeasures(svg, layout) {
  for (const measure of layout.measures) {
    const group = append(svg, 'g', {
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

function drawBarlines(svg, layout) {
  for (const barline of layout.barlines) {
    const group = append(svg, 'g', {
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

function drawEvents(svg, layout) {
  for (const event of layout.events) {
    const group = append(svg, 'g', {
      class: `score-event score-event-${event.kind}`,
      'data-event-id': event.id,
      'data-measure-index': event.measureIndex,
      tabindex: 0,
      role: 'button'
    });
    if (event.chord) {
      append(group, 'text', { class: 'score-chord', x: event.chord.x, y: event.chord.y }, event.chord.text);
    }
    if (event.kind === 'rest') {
      append(group, 'text', { class: 'score-rest', x: event.x, y: event.y + 4 }, event.label);
    }
    for (const note of event.notes) {
      const width = Math.max(11, String(note.label).length * 7 + 4);
      append(group, 'rect', {
        class: 'score-fret-background', x: note.x - width / 2, y: note.y - 6,
        width, height: 12, rx: 2
      });
      append(group, 'text', { class: 'score-fret', x: note.x, y: note.y + 4 }, note.label);
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
}

function drawRhythm(svg, layout) {
  const byId = new Map(layout.events.map((event) => [event.id, event]));
  for (const beam of layout.beams) {
    let x1 = beam.x1;
    let x2 = beam.x2;
    if (beam.kind === 'hook') {
      const event = byId.get(beam.eventIds[0]);
      x1 = event?.x ?? x1;
      x2 = x1 + (beam.direction === 'backward' ? -12 : 12);
    }
    append(svg, 'line', {
      class: `score-beam${beam.kind === 'hook' ? ' score-beam-hook' : ''}`,
      x1, x2, y1: beam.y, y2: beam.y, 'data-beam-level': beam.level
    });
  }
  for (const tuplet of layout.tuplets) {
    const group = append(svg, 'g', { class: 'score-tuplet' });
    append(group, 'line', { x1: tuplet.x1, x2: tuplet.x2, y1: tuplet.y, y2: tuplet.y });
    append(group, 'text', { x: (tuplet.x1 + tuplet.x2) / 2, y: tuplet.y + 4 }, tuplet.label);
  }
}

function techniqueLabel(type) {
  return ({ 'hammer-on': 'H', 'pull-off': 'P', slide: 'S', tie: 'T' })[type] || type;
}

function drawTechniques(svg, layout) {
  for (const link of layout.links) {
    const group = append(svg, 'g', {
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
    const group = append(svg, 'g', { class: 'score-ending', 'data-ending-number': ending.number });
    append(group, 'line', { x1: ending.x1, x2: ending.x2, y1: ending.y, y2: ending.y });
    if (ending.startCap) append(group, 'line', { x1: ending.x1, x2: ending.x1, y1: ending.y, y2: ending.y + 9 });
    if (ending.stopCap) append(group, 'line', { x1: ending.x2, x2: ending.x2, y1: ending.y, y2: ending.y + 9 });
    if (ending.label) append(group, 'text', { x: ending.x1 + 5, y: ending.y - 3 }, ending.label);
  }
}

export function renderScoreSvg(host, index, options = {}) {
  const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 1120;
  const layout = layoutScore(index, { ...options, width });
  const svg = svgEl('svg', {
    class: 'professional-score', viewBox: `0 0 ${width} ${layout.totalHeight}`,
    width, height: layout.totalHeight, role: 'img', 'aria-label': '전문 기타 TAB 악보'
  });
  drawStaff(svg, layout);
  drawMeasures(svg, layout);
  drawBarlines(svg, layout);
  drawEvents(svg, layout);
  drawRhythm(svg, layout);
  drawTechniques(svg, layout);
  host.replaceChildren(svg);
  return layout;
}

export function renderScoreDiagnostics(host, diagnostics = []) {
  host.replaceChildren();
  host.removeAttribute('role');
  if (diagnostics.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'score-diagnostics-empty';
    empty.textContent = '진단 없음';
    host.appendChild(empty);
    return;
  }
  const list = document.createElement('ul');
  for (const diagnostic of diagnostics) {
    const item = document.createElement('li');
    item.className = `score-diagnostic score-diagnostic-${diagnostic.severity || 'warning'}`;
    item.dataset.measureNumber = String(diagnostic.measureNumber ?? '');
    item.textContent = `${diagnostic.measureNumber ? `${diagnostic.measureNumber}마디 · ` : ''}${diagnostic.message || diagnostic.code || '알 수 없는 진단'}`;
    list.appendChild(item);
  }
  host.appendChild(list);
}

export function renderScoreDocument({ canvas, diagnostics, musicxml, partId, options = {} }) {
  try {
    const doc = parseMusicXml(musicxml);
    const index = buildScoreIndex(doc, partId);
    const layout = renderScoreSvg(canvas, index, options);
    renderScoreDiagnostics(diagnostics, index.diagnostics);
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
