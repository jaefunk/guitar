import { preview as vitePreview } from 'vite';

export async function startOwnedPreview({ root, previewFactory = vitePreview } = {}) {
  let server;
  try {
    server = await previewFactory({
      root,
      logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 0, strictPort: true }
    });
    const address = server.httpServer?.address?.();
    if (!address || typeof address === 'string' || !Number.isInteger(address.port)) {
      throw new Error('Vite preview did not expose a listening TCP port');
    }
    return {
      url: `http://127.0.0.1:${address.port}/`,
      close: async () => { await server.close(); }
    };
  } catch (error) {
    if (server) await server.close().catch(() => {});
    throw new Error(`E2E preview startup failed: ${error?.message || 'unknown error'}`, { cause: error });
  }
}
