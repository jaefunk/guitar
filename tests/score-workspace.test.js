// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const css = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');

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
  });
});
