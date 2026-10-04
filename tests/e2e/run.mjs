// 빌드 결과를 vite preview로 띄우고 smoke.mjs를 돌린 뒤 서버를 내린다. `npm run test:e2e`
import { spawn } from 'node:child_process';
import net from 'node:net';

const PORT = 4173;
function waitPort(port, tries) {
  return new Promise((res, rej) => {
    const tryOnce = (n) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.end(); res(); });
      s.once('error', () => { if (n <= 0) rej(new Error('preview가 뜨지 않았어요')); else setTimeout(() => tryOnce(n - 1), 300); });
    };
    tryOnce(tries);
  });
}
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' });
try {
  await waitPort(PORT, 60);
  const code = await new Promise((res) => {
    const p = spawn(process.execPath, ['tests/e2e/smoke.mjs'], { stdio: 'inherit', env: Object.assign({}, process.env, { APP_URL: `http://localhost:${PORT}/` }) });
    p.on('exit', res);
  });
  process.exitCode = code || 0;
} finally {
  preview.kill();
}
