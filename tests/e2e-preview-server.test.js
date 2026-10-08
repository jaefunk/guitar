import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startOwnedPreview } from './e2e/preview-server.mjs';

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
    const candidate = createServer((_request, response) => response.end('wrong server'));
    let occupierOwner = null;
    let root = null;
    let owned = null;
    try {
      try {
        await listen(candidate, 4173);
        occupierOwner = candidate;
      } catch (error) {
        if (error?.code !== 'EADDRINUSE') throw error;
      }

      root = await mkdtemp(join(tmpdir(), 'guitar-preview-test-'));
      await mkdir(join(root, 'dist'));
      await writeFile(join(root, 'dist/index.html'), '<!doctype html><title>owned-preview-marker</title>');

      owned = await startOwnedPreview({ root });
      const response = await fetch(owned.url);

      expect(new URL(owned.url).port).not.toBe('4173');
      expect(await response.text()).toContain('owned-preview-marker');
    } finally {
      await owned?.close();
      if (root) await rm(root, { recursive: true, force: true });
      if (occupierOwner) await close(occupierOwner);
    }
  });

  it('fails fast when Vite preview startup rejects', async () => {
    const previewFactory = async () => { throw new Error('synthetic startup failure'); };

    await expect(startOwnedPreview({ root: '.', previewFactory }))
      .rejects.toThrow(/preview startup failed.*synthetic startup failure/i);
  });
});
