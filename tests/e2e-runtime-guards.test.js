import { describe, expect, it, vi } from 'vitest';
import { E2ELifecycle } from './e2e/resource-lifecycle.mjs';
import { createAbortTimeout, createSignalAbortHandler } from './e2e/runtime-guards.mjs';

function within(promise, timeoutMs = 250) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('guard did not settle in time')), timeoutMs))
  ]);
}

describe('E2E timeout and signal guards', () => {
  it('rejects on timeout even when an acquisition never resolves', async () => {
    const lifecycle = new E2ELifecycle();
    void lifecycle.acquire('browser', () => new Promise(() => {}), vi.fn());
    const timeout = createAbortTimeout(lifecycle, 1);

    await expect(within(timeout.promise)).rejects.toThrow(/timed out/);
    timeout.cancel();
  });

  it('exits after a single signal even when an acquisition never resolves', async () => {
    const lifecycle = new E2ELifecycle();
    void lifecycle.acquire('preview', () => new Promise(() => {}), vi.fn());
    const exit = vi.fn();
    const handler = createSignalAbortHandler(lifecycle, {
      signal: 'SIGTERM',
      exitCode: 143,
      exit
    });

    handler();
    await within(vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143)));
    expect(exit).toHaveBeenCalledOnce();
  });
});
