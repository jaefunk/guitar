// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const css = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');
const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');

describe('professional score workspace shell', () => {
  it('keeps the legacy grid and adds all stable score regions and mode controls', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    expect(doc.querySelector('#gridWorkspace #sheet')).not.toBeNull();
    expect(doc.querySelector('#modeGrid')).not.toBeNull();
    expect(doc.querySelector('#modeScore')).not.toBeNull();
    expect(doc.querySelector('#scoreWorkspace[hidden]')).not.toBeNull();
    for (const id of ['scoreCanvas', 'measureNav', 'scoreInspector', 'scoreDiagnostics']) {
      expect(doc.querySelector(`#scoreWorkspace #${id}`)).not.toBeNull();
    }
  });

  it('defines a desktop four-region grid and print rules for A4 score output', () => {
    expect(css).toMatch(/@media\s*\(min-width:\s*1024px\)/);
    expect(css).toMatch(/grid-template-areas:[^;]*measure-nav[^;]*score-canvas[^;]*score-inspector[^;]*score-diagnostics/s);
    expect(css).toMatch(/@media\s+print/);
    expect(css).toMatch(/#scoreWorkspace[^}]*width:\s*186mm/);
    expect(css).toMatch(/\.top[^}]*display:\s*none/);
    expect(css).toMatch(/body\.score-mode\s+#padBody[^}]*display:\s*none/);
    expect(css).toMatch(/body\.score-mode\s+\.transport\s+\.seg[^}]*display:\s*none/);
  });

  it('does not run legacy global shortcuts for an already handled score key', () => {
    expect(main).toMatch(/addEventListener\('keydown',[\s\S]*?if\s*\(e\.defaultPrevented\)\s*return/);
  });

  it('provides an explicit MusicXML picker and accessible TAB part confirmation dialog', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('#musicXmlFile')?.getAttribute('accept')).toBe('.musicxml,.xml,.mxl');
    expect(doc.querySelector('#musicXmlImportModal [role="dialog"]')).not.toBeNull();
    expect(doc.querySelector('#musicXmlPartChoices')).not.toBeNull();
    expect(doc.querySelector('#confirmMusicXmlImport')).not.toBeNull();
    expect(main).toContain('createMusicXmlImportController');
    expect(main).toContain("downloadMusicXml('mxl')");
  });

  it('routes transport controls through score playback in score mode and stops on mode changes', () => {
    expect(main).toContain('startScorePlay');
    expect(main).toMatch(/state\.viewMode\s*===\s*'score'[\s\S]*startScorePlay/);
    expect(main).toMatch(/function applyViewMode[\s\S]*stopPlay\(\)/);
    expect(main).toMatch(/applyBpmInput\(this\);\s*if\s*\(pb\.playing\)\s*startCurrentPlayback\(\)/);
    expect(main).toMatch(/metroBtn[\s\S]*state\.metro[\s\S]*if\s*\(pb\.playing\)\s*startCurrentPlayback\(\)/);
    expect(css).toMatch(/\.score-event\.play/);
  });
});
