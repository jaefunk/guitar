import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const URL_ = process.env.APP_URL || 'http://127.0.0.1:4173/';
const VIEWPORT = { width: 1440, height: 900 };
const fixture = resolve(ROOT, 'tests/fixtures/basic-tab.musicxml');
let failures = 0;

function check(name, ok, extra) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || extra === undefined ? '' : ` → ${JSON.stringify(extra)}`}`);
  if (!ok) failures += 1;
}

async function waitForReady(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`preview readiness timeout (${url}): ${lastError?.message || 'unknown error'}`);
}

async function startPreview() {
  if (process.env.APP_URL) { await waitForReady(URL_); return null; }
  const vite = resolve(ROOT, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try { await waitForReady(URL_); return child; }
  catch (error) { child.kill(); throw new Error(`${error.message}\n${output.trim()}`); }
}

function emptyMeasure() { return Array.from({ length: 6 }, () => Array(16).fill('')); }
const legacyV2 = (() => {
  const measures = Array.from({ length: 8 }, emptyMeasure);
  measures[0][0][0] = '3'; measures[0][2][4] = '7h'; measures[5][5][15] = '12';
  return { title: '옛 곡', tuning: 'standard', measures, marks: { '0:0': 'G' }, bpm: 100, seen: true, zoom: 'm', theme: 'light' };
})();

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function runLegacySmoke(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.addInitScript((blob) => {
    if (sessionStorage.getItem('legacy-smoke-seeded')) return;
    localStorage.clear();
    localStorage.setItem('gtab-editor-v2', JSON.stringify(blob));
    sessionStorage.setItem('legacy-smoke-seeded', '1');
  }, legacyV2);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.locator('.cell').first().waitFor();
  const cellText = (m, s, i) => page.locator(`.cell[data-m="${m}"][data-s="${s}"][data-i="${i}"]`).textContent();
  const openMenuItem = async (key) => {
    await page.locator('#exportMenu').click();
    await page.locator(`[data-menu-action="${key}"]`).click();
  };

  console.log('1. 기존 빠른 격자 회귀');
  check('v2 제목/BPM 마이그레이션', await page.locator('#title').inputValue() === '옛 곡' && await page.locator('#bpm').inputValue() === '100');
  check('v2 셀/메모 복원', await cellText(0, 0, 0) === '3' && await cellText(5, 5, 15) === '12'
    && await page.locator('.mk[data-m="0"][data-i="0"]').textContent() === 'G');
  check('테마 복원', await page.locator('html').getAttribute('data-theme') === 'light');
  await page.locator('.cell[data-m="1"][data-s="1"][data-i="0"]').click();
  await page.locator('.key[data-digit="1"]').click();
  await page.locator('.key[data-digit="2"]').click();
  await page.locator('.key[data-mod="h"]').click();
  await page.locator('.key[data-digit="5"]').click();
  check('두 자리/기법/자동 이동', await cellText(1, 1, 0) === '12h' && await cellText(1, 1, 1) === '5');
  await page.locator('#del').click();
  await page.locator('#undo').click();
  check('빠른 격자 undo', await cellText(1, 1, 1) === '5');
  await openMenuItem('text-export');
  const textTab = await page.locator('#exportText').inputValue();
  check('텍스트 TAB 내보내기', /^B\|[-]+\|12h5/m.test(textTab));
  await page.locator('#closeModal').click();
  await openMenuItem('text-import');
  await page.locator('#importText').fill(textTab);
  await page.locator('#doImport').click();
  check('텍스트 TAB 왕복', await cellText(1, 1, 0) === '12h' && await cellText(5, 5, 15) === '12');

  console.log('2. 기존 곡 보관함·재생·이미지 회귀');
  await page.locator('#songsBtn').click();
  check('기존 곡 1개', await page.locator('#songList .song[data-id]').count() === 1);
  const firstId = await page.locator('#songList .song[data-id]').getAttribute('data-id');
  await page.locator('#newSong').click();
  await page.locator('#dlgInput').fill('둘째 곡');
  await page.locator('#dlgOk').click();
  await page.locator('#songsModal').waitFor({ state: 'hidden' });
  check('새 곡 생성', await page.locator('#title').inputValue() === '둘째 곡' && await cellText(0, 0, 0) === '');
  await page.locator('.cell[data-m="0"][data-s="3"][data-i="0"]').click();
  await page.locator('.key[data-digit="9"]').click();
  await page.locator('#songsBtn').click();
  check('기존 곡 2개', await page.locator('#songList .song[data-id]').count() === 2);
  const secondId = await page.locator('#songList .song.cur').getAttribute('data-id');
  await page.locator(`#songList .song[data-id="${firstId}"] .song-main`).click();
  check('첫 곡 전환', await page.locator('#title').inputValue() === '옛 곡' && await cellText(1, 1, 0) === '12h');
  await page.locator('#songsBtn').click();
  await page.locator(`#songList .song[data-id="${secondId}"] .song-more`).click();
  await page.locator('[data-menu-action="song-rename"]').click();
  await page.locator('#dlgInput').fill('둘째(개명)');
  await page.locator('#dlgOk').click();
  check('이름 바꾸기', await page.locator(`#songList .song[data-id="${secondId}"] .l`).textContent() === '둘째(개명)');
  await page.locator(`#songList .song[data-id="${firstId}"] .song-more`).click();
  await page.locator('[data-menu-action="song-duplicate"]').click();
  check('곡 복제', await page.locator('#songList .song[data-id]').count() === 3);
  await page.locator(`#songList .song[data-id="${firstId}"] .song-more`).click();
  await page.locator('[data-menu-action="song-delete"]').click();
  await page.locator('#dlgOk').click();
  check('현재 곡 삭제 후 사본 열기', await page.locator('#songList .song[data-id]').count() === 2
    && await page.locator('#title').inputValue() === '옛 곡 사본');
  await page.locator('#closeSongs').click();
  const storedBeforeReload = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('gtab-editor-v4'));
    return { currentId: doc.currentId, title: doc.songs[doc.currentId]?.title };
  });
  check('현재 곡 저장', storedBeforeReload.title === '옛 곡 사본', storedBeforeReload);
  await page.reload({ waitUntil: 'networkidle' });
  const reloaded = { title: await page.locator('#title').inputValue(), fret: await cellText(1, 1, 0) };
  check('새로고침 뒤 곡과 TAB 복원', reloaded.title === '옛 곡 사본' && reloaded.fret === '12h', reloaded);
  await page.locator('#playBtn').click();
  await page.waitForTimeout(600);
  check('빠른 격자 재생', await page.locator('#playBtn').textContent() === '■');
  await page.locator('#playBtn').click();
  await openMenuItem('image-export');
  check('PNG 생성', await page.locator('#imgOut img').evaluate((image) => image.src.startsWith('data:image/png') && image.naturalWidth > 100));
  await page.locator('#closeImg').click();
  check('빠른 격자 콘솔 오류 없음', errors.length === 0, errors);
  await context.close();
}

async function importMusicXml(page, path) {
  await page.locator('#musicXmlFile').setInputFiles(path);
  await page.locator('#musicXmlImportModal').waitFor({ state: 'visible' });
  const parts = page.locator('input[name="musicxml-part"]');
  check('TAB 파트 선택지 표시', await parts.count() === 1);
  await parts.check();
  await page.locator('#confirmMusicXmlImport').click();
  await page.locator('#musicXmlImportModal').waitFor({ state: 'hidden' });
  await page.locator('#scoreWorkspace').waitFor({ state: 'visible' });
}

async function runProfessionalWorkflow(browser, outputDir) {
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.addInitScript(() => localStorage.clear());
  await page.goto(URL_, { waitUntil: 'networkidle' });
  if (await page.locator('#coachModal').isVisible()) await page.locator('#closeCoach').click();

  console.log('3. MusicXML 전문 TAB 왕복');
  await importMusicXml(page, fixture);
  await page.locator('#modeScore').click();
  check('전문 TAB 모드', await page.locator('#modeScore').getAttribute('aria-pressed') === 'true');
  const originalCount = await page.locator('#scoreCanvas [data-event-id]').count();
  check('fixture 이벤트 수', originalCount === 2, originalCount);
  const secondChordNote = () => page.locator('[data-event-id="P1:m0:s0"] .score-fret[data-note-index="1"]');
  await secondChordNote().click();
  const fret = page.locator('#scoreInspector [name="score-fret"]');
  check('7프렛 inspector 선택', await fret.inputValue() === '7');
  await fret.fill('9');
  await fret.press('Tab');
  check('7→9프렛 편집', await secondChordNote().textContent() === '9');
  await page.locator('[data-score-action="undo"]').click();
  check('전문 TAB undo', await secondChordNote().textContent() === '7');
  await page.locator('[data-score-action="redo"]').click();
  check('전문 TAB redo', await secondChordNote().textContent() === '9');

  await page.locator('#exportMenu').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-menu-action="musicxml-export"]').click();
  const download = await downloadPromise;
  const exportedPath = join(outputDir, download.suggestedFilename());
  await download.saveAs(exportedPath);
  const exported = await readFile(exportedPath, 'utf8');
  check('내보낸 XML에 편집값 포함', /<fret>9<\/fret>/.test(exported));
  await importMusicXml(page, exportedPath);
  const reimportedCount = await page.locator('#scoreCanvas [data-event-id]').count();
  check('재가져오기 이벤트 수 보존', reimportedCount === originalCount, { originalCount, reimportedCount });
  check('재가져오기 편집값 보존', await secondChordNote().textContent() === '9');
  await page.locator('#songsBtn').click();
  await page.locator('[data-act="built-in-nell"]').click();
  await page.locator('#scoreWorkspace').waitFor({ state: 'visible' });
  await page.locator('#scoreCanvas .score-measure[data-measure-number="77"]').waitFor();
  const builtInMeasureCount = await page.locator('#scoreCanvas .score-measure[data-measure-number]').count();
  check('내장 1:03 명시 로드', builtInMeasureCount === 77, builtInMeasureCount);
  check('전문 TAB 콘솔 오류 없음', errors.length === 0, errors);
  await context.close();
}

const preview = await startPreview();
const outputDir = await mkdtemp(join(tmpdir(), 'guitar-e2e-'));
const browser = await chromium.launch({ headless: true });
try {
  await runLegacySmoke(browser);
  await runProfessionalWorkflow(browser, outputDir);
} finally {
  await browser.close();
  preview?.kill();
  await rm(outputDir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures}개 실패` : '\n모두 통과');
process.exitCode = failures ? 1 : 0;
