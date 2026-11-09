// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openMenu } from '../src/ui.js';

describe('menu locator contract', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="menuModal" hidden>
        <h2 id="menuTitle"></h2>
        <div id="menuList"></div>
      </div>`;
  });

  it('exposes a stable action key for browser workflows', () => {
    const action = vi.fn();
    openMenu('내보내기', [{ key: 'musicxml-export', label: 'MusicXML 내보내기', action }]);

    const button = document.querySelector('[data-menu-action="musicxml-export"]');
    expect(button).not.toBeNull();
    button.click();
    expect(action).toHaveBeenCalledOnce();
  });
});
