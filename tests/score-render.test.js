// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import {
  PRINT_LAYOUT_WIDTH,
  createScoreWorkspaceController,
  renderScoreDiagnostics,
  renderScoreDocument,
  renderScoreSvg,
  setScoreViewMode
} from '../src/score-render.js';

const moduleUrl = import.meta.url;
const techniquesXml = readFileSync(new URL('./fixtures/techniques.musicxml', moduleUrl), 'utf8');

function hosts() {
  document.body.innerHTML = `
    <main id="gridWorkspace"></main>
    <section id="scoreWorkspace" hidden></section>
    <div id="scoreCanvas"></div>
    <nav id="measureNav"></nav>
    <aside id="scoreInspector"></aside>
    <aside id="scoreDiagnostics"></aside>
    <div id="pad"></div>
    <button id="modeGrid"></button>
    <button id="modeScore"></button>`;
  return {
    gridWorkspace: document.querySelector('#gridWorkspace'),
    scoreWorkspace: document.querySelector('#scoreWorkspace'),
    canvas: document.querySelector('#scoreCanvas'),
    diagnostics: document.querySelector('#scoreDiagnostics'),
    inspector: document.querySelector('#scoreInspector'),
    pad: document.querySelector('#pad'),
    modeGrid: document.querySelector('#modeGrid'),
    modeScore: document.querySelector('#modeScore')
  };
}

describe('professional score SVG renderer', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('renders namespaced, selectable notation records with stable data attributes', () => {
    const host = document.createElement('div');
    const index = buildScoreIndex(parseMusicXml(techniquesXml), 'P1');

    const onSelect = vi.fn();
    const layout = renderScoreSvg(host, index, { width: 720, onSelect });
    const svg = host.firstElementChild;

    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('role')).toBe('group');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 720 ${layout.totalHeight}`);
    expect(svg.querySelectorAll('.score-staff-line').length).toBe(layout.systems.length * 6);
    expect(svg.querySelectorAll('[data-measure-number]').length).toBe(index.measures.length);
    expect(svg.querySelectorAll('[data-event-id]').length).toBe(index.measures.flatMap((m) => m.events).length);
    expect(svg.querySelector('.score-fret')).not.toBeNull();
    expect(svg.querySelector('.score-stem')).not.toBeNull();
    expect(svg.querySelector('.score-beam')).not.toBeNull();
    expect(svg.querySelector('.score-dot')).not.toBeNull();
    expect(svg.querySelector('.score-tuplet')).not.toBeNull();
    expect(svg.querySelector('.score-technique')).not.toBeNull();
    expect(svg.querySelector('.score-bend')).not.toBeNull();
    expect(svg.querySelector('.score-ending')).not.toBeNull();
    expect(svg.querySelector('.score-fermata')).not.toBeNull();
    expect(svg.querySelector('.score-repeat-dot')).not.toBeNull();

    const events = [...svg.querySelectorAll('[data-event-id]')];
    expect(events.filter((event) => event.tabIndex === 0)).toHaveLength(1);
    expect(events.slice(1).every((event) => event.tabIndex === -1)).toBe(true);
    expect(events[0].getAttribute('aria-label')).toMatch(/1마디.*현.*프렛/);

    events[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(events[1].classList.contains('selected')).toBe(true);
    expect(events[1].getAttribute('aria-pressed')).toBe('true');
    expect(events[1].tabIndex).toBe(0);
    expect(events[0].tabIndex).toBe(-1);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: events[1].dataset.eventId }));

    events[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    events[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(3);
    events[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(events[2].classList.contains('selected')).toBe(true);
    expect(events[2].tabIndex).toBe(0);
  });

  it('gives rest events a useful accessible name', () => {
    const host = document.createElement('div');
    const index = {
      partId: 'P1', links: [], diagnostics: [], playbackMeasures: [0],
      measures: [{ number: '7', events: [{ id: 'rest-7', kind: 'rest', onset: { n: 0, d: 1 }, duration: { n: 4, d: 1 } }] }]
    };

    renderScoreSvg(host, index, { width: 400 });

    expect(host.querySelector('[data-event-id]').getAttribute('aria-label')).toMatch(/7마디.*쉼표/);
  });

  it('writes score labels as text instead of parsing markup', () => {
    const host = document.createElement('div');
    const index = {
      partId: 'P1', links: [], diagnostics: [], playbackMeasures: [0],
      measures: [{
        number: '<img src=x onerror=alert(1)>', divisions: 4, beats: 4, beatType: 4,
        events: [{
          id: 'unsafe" onclick="alert(1)', kind: 'notes', onset: { n: 0, d: 1 },
          duration: { n: 1, d: 1 }, chordSymbol: '<script>alert(1)</script>',
          notes: [{ string: 1, fret: '<b>7</b>' }]
        }]
      }]
    };

    renderScoreSvg(host, index, { width: 400 });

    expect(host.querySelector('img, script, b')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
    expect(host.querySelector('[data-event-id]')?.getAttribute('data-event-id')).toBe('unsafe" onclick="alert(1)');
  });

  it('persists score view independently from the song editor ownership mode', () => {
    const elements = hosts();
    const settings = { viewMode: 'grid' };
    const song = { editorMode: 'musicxml-readonly' };
    const persist = vi.fn();

    setScoreViewMode('score', { settings, song, persist, elements });

    expect(settings.viewMode).toBe('score');
    expect(song.editorMode).toBe('musicxml-readonly');
    expect(elements.gridWorkspace.hidden).toBe(true);
    expect(elements.scoreWorkspace.hidden).toBe(false);
    expect(elements.pad.hidden).toBe(true);
    expect(elements.modeScore.getAttribute('aria-pressed')).toBe('true');
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('shows parse failures in diagnostics without leaving stale notation', () => {
    const { canvas, diagnostics } = hosts();
    canvas.appendChild(document.createElement('span'));

    const result = renderScoreDocument({
      canvas,
      diagnostics,
      musicxml: '<score-partwise>',
      partId: 'P1',
      options: { width: 720 }
    });

    expect(result).toBeNull();
    expect(canvas.childElementCount).toBe(0);
    expect(diagnostics.getAttribute('role')).toBe('alert');
    expect(diagnostics.textContent).toMatch(/MusicXML/);
  });

  it('renders empty scores as an explicit canvas message separate from diagnostics', () => {
    const { canvas, diagnostics } = hosts();
    const result = renderScoreDocument({
      canvas, diagnostics,
      musicxml: '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list><part id="P1"/></score-partwise>',
      partId: 'P1', options: { width: 720 }
    });

    expect(result).not.toBeNull();
    expect(canvas.querySelector('.score-empty')?.textContent).toMatch(/마디가 없습니다/);
    expect(canvas.querySelector('svg')).toBeNull();
    expect(diagnostics.textContent).toBe('진단 없음');
  });

  it('renders diagnostics as keyboard-native measure navigation buttons', () => {
    const host = document.createElement('aside');
    const onMeasure = vi.fn();
    renderScoreDiagnostics(host, [{
      severity: 'warning', code: 'TEST', measureNumber: '12', message: '확인 필요'
    }], { onMeasure });

    const button = host.querySelector('button[data-measure-number="12"]');
    expect(button).not.toBeNull();
    button.click();
    expect(onMeasure).toHaveBeenCalledWith('12');
  });

  it('reuses one parsed index while relayouting for print and restoring the screen layout', () => {
    const { canvas, diagnostics, inspector } = hosts();
    let parseCount = 0;
    let buildCount = 0;
    let screenWidth = 1120;
    let queuedFrame = null;
    const rendered = [];
    const song = { musicxml: techniquesXml, selectedPartId: 'P1' };
    const printIndex = {
      partId: 'P1', links: [], diagnostics: [], playbackMeasures: [0, 1, 2, 3],
      measures: [1, 2, 3, 4].map((number) => ({
        number: String(number), divisions: 4, beats: 4, beatType: 4,
        events: [{ id: `rest-${number}`, kind: 'rest', onset: { n: 0, d: 1 }, duration: { n: 4, d: 1 } }]
      }))
    };
    const controller = createScoreWorkspaceController({
      canvas, diagnostics, inspector,
      getSong: () => song,
      getScreenWidth: () => screenWidth,
      parse: () => { parseCount += 1; return {}; },
      buildIndex: () => { buildCount += 1; return printIndex; },
      requestFrame: (callback) => { queuedFrame = callback; return 1; },
      cancelFrame: () => { queuedFrame = null; },
      onRendered: ({ width, layout }) => { rendered.push({ width, systems: layout.systems.length }); }
    });

    controller.renderScreen();
    const screenSystems = canvas.querySelectorAll('.score-system').length;
    expect(canvas.querySelector('svg').getAttribute('viewBox')).toMatch(/^0 0 1120 /);

    window.dispatchEvent(new Event('beforeprint'));
    const printSystems = canvas.querySelectorAll('.score-system').length;
    expect(canvas.querySelector('svg').getAttribute('viewBox')).toMatch(new RegExp(`^0 0 ${PRINT_LAYOUT_WIDTH} `));
    expect(printSystems).toBeGreaterThan(screenSystems);

    screenWidth = 900;
    controller.scheduleScreenRender();
    controller.scheduleScreenRender();
    expect(queuedFrame).toBeNull();
    expect(canvas.querySelector('svg').getAttribute('viewBox')).toMatch(new RegExp(`^0 0 ${PRINT_LAYOUT_WIDTH} `));

    window.dispatchEvent(new Event('afterprint'));
    expect(canvas.querySelector('svg').getAttribute('viewBox')).toMatch(/^0 0 900 /);
    expect(parseCount).toBe(1);
    expect(buildCount).toBe(1);
    expect(rendered.map((item) => item.width)).toEqual([1120, PRINT_LAYOUT_WIDTH, 900]);
    controller.destroy();
  });

  it('preserves event selection and updates the inspector across relayouts', () => {
    const { canvas, diagnostics, inspector } = hosts();
    let screenWidth = 1120;
    const controller = createScoreWorkspaceController({
      canvas, diagnostics, inspector,
      getSong: () => ({ musicxml: techniquesXml, selectedPartId: 'P1' }),
      getScreenWidth: () => screenWidth
    });
    controller.renderScreen();
    const initialId = canvas.querySelector('[data-event-id]').dataset.eventId;
    expect(inspector.textContent).toContain(initialId);
    const event = canvas.querySelectorAll('[data-event-id]')[1];
    event.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const selectedId = event.dataset.eventId;

    expect(inspector.textContent).toContain(selectedId);
    screenWidth = 900;
    controller.renderScreen();

    const restored = canvas.querySelector(`[data-event-id="${selectedId}"]`);
    expect(restored.classList.contains('selected')).toBe(true);
    expect(restored.tabIndex).toBe(0);
    controller.destroy();
  });

  it('debounces resize work and skips relayout when the target width is unchanged', () => {
    const { canvas, diagnostics, inspector } = hosts();
    let screenWidth = 1120;
    let queuedFrame = null;
    let scheduledFrames = 0;
    const renderedWidths = [];
    const controller = createScoreWorkspaceController({
      canvas, diagnostics, inspector,
      getSong: () => ({ musicxml: techniquesXml, selectedPartId: 'P1' }),
      getScreenWidth: () => screenWidth,
      requestFrame: (callback) => { scheduledFrames += 1; queuedFrame = callback; return scheduledFrames; },
      cancelFrame: () => {},
      onRendered: ({ width }) => { renderedWidths.push(width); }
    });
    controller.renderScreen();
    screenWidth = 900;

    controller.scheduleScreenRender();
    controller.scheduleScreenRender();
    controller.scheduleScreenRender();
    expect(scheduledFrames).toBe(1);
    queuedFrame();
    expect(renderedWidths).toEqual([1120, 900]);

    queuedFrame = null;
    controller.scheduleScreenRender();
    queuedFrame();
    expect(renderedWidths).toEqual([1120, 900]);
    controller.destroy();
  });
});
