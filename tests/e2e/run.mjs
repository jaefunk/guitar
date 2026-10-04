// 빌드 결과를 vite preview로 띄우고 smoke.mjs를 돌린 뒤 서버를 내린다. `npm run test:e2e`
// - 호스트를 127.0.0.1로 못 박는다: 러너에 따라 localhost가 ::1(IPv6)로만 풀려 접속 확인이 실패할 수 있다.
// - npx를 거치지 않고 vite 실행 파일을 직접 띄우고, 종료는 프로세스 그룹째 보낸다(esbuild 같은 손자 프로세스가 남아
//   파이프를 쥐고 있으면 이 스크립트가 끝나지 않는다).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import net from 'node:net';

const HOST = '127.0.0.1', PORT = 4173;
const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

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
function killTree(p) {
  if (!p || p.exitCode !== null) return;
  try { if (process.platform !== 'win32') process.kill(-p.pid, 'SIGTERM'); else p.kill(); } catch (e) { try { p.kill(); } catch (e2) { /* 이미 끝남 */ } }
}

let log = '';
const preview = spawn(process.execPath, [viteBin, 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
});
preview.stdout.on('data', (d) => { log += d; });
preview.stderr.on('data', (d) => { log += d; });
let code = 1;
try {
  await waitPort(HOST, PORT, 80); // 최대 약 40초
  code = await new Promise((res) => {
    const p = spawn(process.execPath, ['tests/e2e/smoke.mjs'], { stdio: 'inherit', env: Object.assign({}, process.env, { APP_URL: `http://${HOST}:${PORT}/` }) });
    p.on('exit', (c) => res(c || 0));
  });
} catch (e) {
  console.error(String(e.message || e));
  console.error('--- vite preview 출력 ---\n' + log);
  code = 1;
} finally {
  killTree(preview);
}
// 남은 핸들이 있어도 여기서 끝낸다
setTimeout(() => process.exit(code), 300);
