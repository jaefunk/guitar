// 빌드 결과를 vite preview로 띄우고 smoke.mjs를 돌린 뒤 서버를 내린다. `npm run test:e2e`
// 호스트를 127.0.0.1로 못 박는다: 러너에 따라 localhost가 ::1(IPv6)로만 풀려 접속 확인이 실패할 수 있다.
import { spawn } from 'node:child_process';
import net from 'node:net';

const HOST = '127.0.0.1', PORT = 4173;
function waitPort(host, port, tries) {
  return new Promise((res, rej) => {
    const tryOnce = (n) => {
      const s = net.connect(port, host);
      s.once('connect', () => { s.end(); res(); });
      s.once('error', () => { if (n <= 0) rej(new Error('preview가 뜨지 않았어요')); else setTimeout(() => tryOnce(n - 1), 500); });
    };
    tryOnce(tries);
  });
}
let log = '';
const preview = spawn('npx', ['vite', 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
preview.stdout.on('data', (d) => { log += d; });
preview.stderr.on('data', (d) => { log += d; });
try {
  await waitPort(HOST, PORT, 80); // 최대 약 40초
  const code = await new Promise((res) => {
    const p = spawn(process.execPath, ['tests/e2e/smoke.mjs'], { stdio: 'inherit', env: Object.assign({}, process.env, { APP_URL: `http://${HOST}:${PORT}/` }) });
    p.on('exit', res);
  });
  process.exitCode = code || 0;
} catch (e) {
  console.error(String(e.message || e));
  console.error('--- vite preview 출력 ---\n' + log);
  process.exitCode = 1;
} finally {
  preview.kill();
}
