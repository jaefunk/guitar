import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startOwnedPreview } from './e2e/preview-server.mjs';

const cleanups = [];
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('owned Vite preview', () => {
  it('uses its own dynamic port even while conventional port 4173 is occupied', async () => {
    const occupied = createServer((_request, response) => response.end('wrong server'));
    await listen(occupied, 4173);
    cleanups.push(() => close(occupied));

    const root = await mkdtemp(join(tmpdir(), 'guitar-preview-test-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>owned-preview-marker</title>');

    const owned = await startOwnedPreview({ root });
    cleanups.push(() => owned.close());
    const response = await fetch(owned.url);

    expect(new URL(owned.url).port).not.toBe('4173');
    expect(await response.text()).toContain('owned-preview-marker');
  });

  it('fails fast when Vite preview startup rejects', async () => {
    const previewFactory = async () => { throw new Error('synthetic startup failure'); };

    await expect(startOwnedPreview({ root: '.', previewFactory }))
      .rejects.toThrow(/preview startup failed.*synthetic startup failure/i);
  });
});
