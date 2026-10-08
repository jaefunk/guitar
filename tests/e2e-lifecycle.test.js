import { describe, expect, it, vi } from 'vitest';
import { E2ELifecycle } from './e2e/resource-lifecycle.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function within(promise, timeoutMs = 250) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('operation did not settle in time')), timeoutMs))
  ]);
}

describe('E2E resource lifecycle', () => {
  it('rescans newly assigned resources and serializes repeated cleanup calls', async () => {
    const lifecycle = new E2ELifecycle();
    const firstDispose = deferred();
    const browser = { close: vi.fn(() => firstDispose.promise) };
    const preview = { close: vi.fn(async () => {}) };

    await lifecycle.acquire('browser', async () => browser, (value) => value.close());
    const firstCleanup = lifecycle.cleanup();
    await lifecycle.acquire('preview', async () => preview, (value) => value.close());
    const secondCleanup = lifecycle.cleanup();

    await Promise.resolve();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(preview.close).not.toHaveBeenCalled();
    firstDispose.resolve();
    await Promise.all([firstCleanup, secondCleanup]);
    expect(preview.close).toHaveBeenCalledOnce();

    await lifecycle.cleanup();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(preview.close).toHaveBeenCalledOnce();
  });

  it('disposes a delayed acquisition that completes after abort', async () => {
    const lifecycle = new E2ELifecycle();
    const pending = deferred();
    const browser = { close: vi.fn(async () => {}) };
    const acquisition = lifecycle.acquire('browser', () => pending.promise, (value) => value.close());

    const aborting = lifecycle.abort(new Error('synthetic timeout'));
    await expect(within(aborting)).resolves.toBeUndefined();
    pending.resolve(browser);

    await expect(acquisition).rejects.toThrow(/synthetic timeout/);
    expect(browser.close).toHaveBeenCalledOnce();
    await lifecycle.cleanup();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('returns from abort while an acquisition never resolves', async () => {
    const lifecycle = new E2ELifecycle();
    void lifecycle.acquire('preview', () => new Promise(() => {}), vi.fn());

    await expect(within(lifecycle.cleanup())).resolves.toBeUndefined();
    await expect(within(lifecycle.abort(new Error('single signal')))).resolves.toBeUndefined();
  });
});
