import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startOwnedPreview } from './preview-server.mjs';
import { E2ELifecycle } from './resource-lifecycle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VIEWPORT = { width: 1440, height: 900 };
const fixture = resolve(ROOT, 'tests/fixtures/basic-tab.musicxml');
let failures = 0;

function check(name, ok, extra) {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok || extra === undefined ? '' : ` → ${JSON.stringify(extra)}`}`);
  if (!ok) failures += 1;
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

async function runLegacySmoke(browser, appUrl, lifecycle) {
  const context = await lifecycle.acquire(
    'context',
    () => browser.newContext({ viewport: VIEWPORT }),
    (value) => value.close()
  );
  try {
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.addInitScript((blob) => {
      if (sessionStorage.getItem('legacy-smoke-seeded')) return;
      localStorage.clear();
      localStorage.setItem('gtab-editor-v2', JSON.stringify(blob));
      sessionStorage.setItem('legacy-smoke-seeded', '1');
    }, legacyV2);
    await page.goto(appUrl, { waitUntil: 'networkidle' });
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
  } finally {
    await lifecycle.release('context');
  }
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

async function runProfessionalWorkflow(browser, outputDir, appUrl, lifecycle) {
  const context = await lifecycle.acquire(
    'context',
    () => browser.newContext({ viewport: VIEWPORT, acceptDownloads: true }),
    (value) => value.close()
  );
  try {
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.addInitScript(() => localStorage.clear());
    await page.goto(appUrl, { waitUntil: 'networkidle' });
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
  } finally {
    await lifecycle.release('context');
  }
}

const lifecycle = new E2ELifecycle();
const signalHandlers = new Map([
  ['SIGINT', () => { void lifecycle.abort(new Error('E2E interrupted by SIGINT')).finally(() => process.exit(130)); }],
  ['SIGTERM', () => { void lifecycle.abort(new Error('E2E interrupted by SIGTERM')).finally(() => process.exit(143)); }]
]);
for (const [signal, handler] of signalHandlers) process.once(signal, handler);

const run = async () => {
  const preview = await lifecycle.acquire(
    'preview',
    () => startOwnedPreview({ root: ROOT }),
    (value) => value.close()
  );
  const markerResponse = await fetch(preview.url);
  const markerHtml = await markerResponse.text();
  if (!markerResponse.ok || !markerHtml.includes('<title>기타 타브 에디터</title>')) {
    throw new Error('Owned E2E preview did not serve the expected application build');
  }
  const outputDir = await lifecycle.acquire(
    'outputDir',
    () => mkdtemp(join(tmpdir(), 'guitar-e2e-')),
    (value) => rm(value, { recursive: true, force: true })
  );
  const browser = await lifecycle.acquire(
    'browser',
    () => chromium.launch({ headless: true }),
    (value) => value.close()
  );
  await runLegacySmoke(browser, preview.url, lifecycle);
  await runProfessionalWorkflow(browser, outputDir, preview.url, lifecycle);
};

let timeoutId;
try {
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      const error = new Error('E2E workflow timed out after 120 seconds');
      await lifecycle.abort(error);
      reject(error);
    }, 120_000);
  });
  await Promise.race([run(), timeout]);
} finally {
  clearTimeout(timeoutId);
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  await lifecycle.cleanup();
}
console.log(failures ? `\n${failures}개 실패` : '\n모두 통과');
process.exitCode = failures ? 1 : 0;
