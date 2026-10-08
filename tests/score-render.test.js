// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import { renderScoreDocument, renderScoreSvg, setScoreViewMode } from '../src/score-render.js';

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

    const layout = renderScoreSvg(host, index, { width: 720 });
    const svg = host.firstElementChild;

    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
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
});
