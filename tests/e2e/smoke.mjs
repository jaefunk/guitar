// 브라우저 스모크 테스트. 실행: npm run build && npx vite preview --port 4173 & node tests/e2e/smoke.mjs
// playwright 패키지가 필요하다(전역 설치여도 됨: PW_MODULE 환경변수로 경로 지정).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const URL_ = process.env.APP_URL || 'http://localhost:4173/';

function emptyMeasure() { return Array.from({ length: 6 }, () => Array(16).fill('')); }
const v2 = (() => {
  const ms = Array.from({ length: 8 }, emptyMeasure);
  ms[0][0][0] = '3'; ms[0][2][4] = '7h'; ms[5][5][15] = '12';
  return { title: '옛 곡', tuning: 'standard', measures: ms, marks: { '0:0': 'G' }, bpm: 100, seen: true, zoom: 'm', theme: 'light' };
})();

let failures = 0;
function check(name, ok, extra) { console.log((ok ? '  ok  ' : '  FAIL') + ' ' + name + (ok || extra === undefined ? '' : ' → ' + JSON.stringify(extra))); if (!ok) failures++; }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// 외부 폰트(Google Fonts) 로딩 실패는 네트워크 환경 문제라 제외한다.
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.addInitScript((blob) => { if (!localStorage.getItem('gtab-editor-v3')) localStorage.setItem('gtab-editor-v2', JSON.stringify(blob)); }, v2);
await page.goto(URL_);
await page.waitForSelector('.cell');

const cellText = (m, s, i) => page.$eval(`.cell[data-m="${m}"][data-s="${s}"][data-i="${i}"]`, (el) => el.textContent);
const openMenuItem = async (btnId, label) => { await page.click('#' + btnId); await page.click(`#menuList .menu-item:has-text("${label}")`); };

console.log('1. v2 마이그레이션');
check('제목 복원', await page.inputValue('#title') === '옛 곡');
check('BPM 복원', await page.inputValue('#bpm') === '100');
check('셀 값 복원 (0,0,0)=3', await cellText(0, 0, 0) === '3');
check('셀 값 복원 (5,5,15)=12', await cellText(5, 5, 15) === '12');
check('메모 복원', await page.$eval('.mk[data-m="0"][data-i="0"]', (el) => el.textContent) === 'G');
check('첫 안내 숨김(seen)', await page.$eval('#coachModal', (el) => el.hidden));
check('테마 light 적용', await page.$eval('html', (el) => el.dataset.theme) === 'light');
const v3 = await page.evaluate(() => JSON.parse(localStorage.getItem('gtab-editor-v3')));
check('v3 키 생성', v3 && v3.v === 3 && v3.order.length === 1 && v3.songs[v3.currentId].title === '옛 곡');

console.log('2. 입력 규칙');
await page.click('.cell[data-m="1"][data-s="1"][data-i="0"]');
await page.click('.key[data-digit="1"]');
check('1 입력 후 대기(pending)', await page.$eval('.cell[data-m="1"][data-s="1"][data-i="0"]', (el) => el.classList.contains('pending')));
await page.click('.key[data-digit="2"]');
check('두 자리 12', await cellText(1, 1, 0) === '12');
check('자동 이동', await page.$eval('.cell[data-m="1"][data-s="1"][data-i="1"]', (el) => el.classList.contains('sel')));
await page.click('.key[data-mod="h"]');
check('빈 칸에서 h → 이전 음에 붙음', await cellText(1, 1, 0) === '12h');
await page.click('.key[data-digit="5"]');
check('5 입력 후 자동 이동', await cellText(1, 1, 1) === '5' && await page.$eval('.cell[data-m="1"][data-s="1"][data-i="2"]', (el) => el.classList.contains('sel')));
await page.click('#del');
check('Backspace: 빈 칸이면 왼쪽을 지움', await cellText(1, 1, 1) === '');
await page.click('#undo');
check('실행 취소', await cellText(1, 1, 1) === '5');
await page.click('.cell[data-m="1"][data-s="1"][data-i="3"]');
await page.click('.key[data-mod="."]');
check('끊기(·) 입력', await page.$eval('.cell[data-m="1"][data-s="1"][data-i="3"] .rest', (el) => el.textContent) === '·');
await page.keyboard.press('Escape');
await page.click('.cell[data-m="1"][data-s="1"][data-i="3"]');
await page.keyboard.press('Backspace');
check('끊기 지움', await cellText(1, 1, 3) === '');

console.log('3. 텍스트 내보내기 왕복');
await openMenuItem('exportMenu', '텍스트 타브');
const txt = await page.inputValue('#exportText');
check('텍스트에 12h5 포함', /^B\|[-]+\|12h5/m.test(txt), txt.split('\n').slice(0, 12));
await page.click('#closeModal');
await openMenuItem('exportMenu', '텍스트 불러오기');
await page.fill('#importText', txt);
await page.click('#doImport');
await page.waitForSelector('#importModal', { state: 'hidden' });
check('불러온 뒤 셀 동일', await cellText(1, 1, 0) === '12h' && await cellText(5, 5, 15) === '12' && await cellText(0, 2, 4) === '7h');
await openMenuItem('exportMenu', '텍스트 타브');
const txt2 = await page.inputValue('#exportText');
check('내보내기 결과 동일(메모 제외)', txt2.split('\n').filter((l) => /\|/.test(l)).join('\n') === txt.split('\n').filter((l) => /\|/.test(l)).join('\n'));
await page.click('#closeModal');

console.log('4. 곡 여러 개');
await page.click('#songsBtn');
check('목록에 1곡', await page.$$eval('#songList .song', (els) => els.length) === 1);
await page.click('#newSong');
await page.fill('#dlgInput', '둘째 곡');
await page.click('#dlgOk');
await page.waitForSelector('#songsModal', { state: 'hidden' });
check('새 곡 제목', await page.inputValue('#title') === '둘째 곡');
check('새 곡은 비어 있음', await cellText(0, 0, 0) === '' && await page.$$eval('.cell', (els) => els.length) === 8 * 6 * 16);
await page.click('.cell[data-m="0"][data-s="3"][data-i="0"]');
await page.click('.key[data-digit="9"]');
check('새 곡에 입력', await cellText(0, 3, 0) === '9');
await page.click('#songsBtn');
check('목록에 2곡', await page.$$eval('#songList .song', (els) => els.length) === 2);
check('현재 곡 표시', await page.$eval('#songList .song.cur .l', (el) => el.textContent) === '둘째 곡');
await page.click('#songList .song:nth-child(1) .song-main');
await page.waitForSelector('#songsModal', { state: 'hidden' });
check('첫 곡으로 전환', await page.inputValue('#title') === '옛 곡' && await cellText(1, 1, 0) === '12h');
// 이름 바꾸기
await page.click('#songsBtn');
await page.click('#songList .song:nth-child(2) .song-more');
await page.click('#menuList .menu-item:has-text("이름 바꾸기")');
await page.fill('#dlgInput', '둘째(개명)');
await page.click('#dlgOk');
check('이름 바꾸기 반영', await page.$eval('#songList .song:nth-child(2) .l', (el) => el.textContent) === '둘째(개명)');
// 복제
await page.click('#songList .song:nth-child(1) .song-more');
await page.click('#menuList .menu-item:has-text("복제")');
check('복제 → 3곡, 사본 이름', await page.$$eval('#songList .song .l', (els) => els.map((e) => e.textContent)).then((a) => a.length === 3 && a[1] === '옛 곡 사본'));
// 현재 곡 삭제
await page.click('#songList .song.cur .song-more');
await page.click('#menuList .menu-item:has-text("삭제")');
await page.click('#dlgOk');
check('삭제 후 2곡, 이웃 곡 열림', await page.$$eval('#songList .song', (els) => els.length) === 2 && await page.inputValue('#title') === '옛 곡 사본');
await page.click('#closeSongs');

console.log('4b. 다중 마디 선택 · 팜뮤트 · 조옮김');
{
  const r1 = await page.$('.ruler .measure[data-m="1"]');
  await r1.scrollIntoViewIfNeeded();
  const box = await r1.boundingBox();
  // 왼쪽 끝은 고정된 줄 이름 칸에 가릴 수 있으니 마디 가운데를 누른다
  await page.mouse.move(box.x + box.width / 2, box.y + 6);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  check('길게 눌러 범위 시작', !(await page.$eval('#rangeBar', (el) => el.hidden)));
  await page.click('.ruler .measure[data-m="2"]');
  check('범위 2~3 확장', (await page.textContent('#rangeLabel')).indexOf('마디 2~3') === 0);
  check('범위 표시', await page.$$eval('.ruler .measure.range', (els) => els.length) === 2);
  await page.click('#rangeBar [data-act="pm"]');
  check('팜뮤트 켬', await page.$$eval('.mk.pm', (els) => els.length) === 32 && await page.$$eval('.mk.pm-start', (els) => els.length) === 1);
  await page.click('#rangeBar [data-act="transpose"]');
  await page.fill('#dlgInput', '2');
  await page.click('#dlgOk');
  check('조옮김 +2 (12h→14h)', await cellText(1, 1, 0) === '14h');
  await page.click('#rangeBar [data-act="right"]');
  check('오른쪽 밀기', await cellText(1, 1, 1) === '14h' && await cellText(1, 1, 0) === '');
  await openMenuItem('exportMenu', '텍스트 타브');
  const t3 = await page.inputValue('#exportText');
  check('텍스트에 PM 줄', /^PM/m.test(t3));
  await page.click('#closeModal');
  check('밀기 후 팜뮤트도 한 칸 밀림', await page.$$eval('.mk.pm', (els) => els.length) === 31);
  await page.click('#rangeBar [data-act="pm"]'); // 일부만 켜져 있으면 전부 켠다
  check('팜뮤트 전부 켬', await page.$$eval('.mk.pm', (els) => els.length) === 32);
  await page.click('#rangeBar [data-act="pm"]');
  check('팜뮤트 끔', await page.$$eval('.mk.pm', (els) => els.length) === 0);
  await page.click('#rangeBar [data-act="copy"]');
  await page.click('.ruler .measure[data-m="4"]'); // 범위 중엔 확장이므로 먼저 해제
  await page.click('#rangeBar [data-act="close"]');
  check('범위 해제', await page.$eval('#rangeBar', (el) => el.hidden));
  await page.click('.cell[data-m="5"][data-s="0"][data-i="0"]');
  await openMenuItem('measureMenu', '붙여넣기');
  check('두 마디 붙여넣기', await cellText(5, 1, 1) === '14h');
  // 팜뮤트 켬, 조옮김, 밀기, 팜뮤트 켬, 팜뮤트 끔, 붙여넣기 = 6번
  for (let u = 0; u < 6; u++) await page.click('#undo');
  check('되돌리기 6번 후 원상복구', await cellText(1, 1, 0) === '12h' && await cellText(5, 1, 1) === '' && await page.$$eval('.mk.pm', (els) => els.length) === 0);
}

console.log('4b2. 코드 인식 칩');
{
  await page.click('.cell[data-m="6"][data-s="0"][data-i="0"]');
  await page.click('#chordBtn');
  check('코드 라이브러리에 다이어그램', await page.$$eval('#chordGrid .chord svg', (els) => els.length) === 30);
  await page.click('#closeChord');
  // 직접 E 코드를 쌓는다 (e:0, B:0, G:1, D:2 → E B G# E, 베이스 E) → E
  for (const [s, d] of [[0, '0'], [1, '0'], [2, '1'], [3, '2']]) { await page.click(`.cell[data-m="6"][data-s="${s}"][data-i="0"]`); await page.click(`.key[data-digit="${d}"]`); }
  await page.click('.cell[data-m="6"][data-s="0"][data-i="0"]');
  check('E 인식', !(await page.$eval('#chordHint', (el) => el.hidden)) && await page.textContent('#chordHint') === 'E', await page.textContent('#chordHint'));
  await page.click('.cell[data-m="6"][data-s="1"][data-i="4"]');
  check('음 없는 칸은 칩 숨김', await page.$eval('#chordHint', (el) => el.hidden));
  await page.click('.cell[data-m="6"][data-s="0"][data-i="0"]');
  await page.click('#chordHint');
  check('칩 탭 → 메모', await page.$eval('.mk[data-m="6"][data-i="0"]', (el) => el.textContent) === 'E');
  for (let u = 0; u < 5; u++) await page.click('#undo');
  check('되돌림', await cellText(6, 0, 0) === '' && await page.$eval('.mk[data-m="6"][data-i="0"]', (el) => el.textContent) === '');
}

console.log('4c. 반복 기호');
{
  await page.click('.cell[data-m="1"][data-s="0"][data-i="0"]');
  await openMenuItem('measureMenu', '반복 기호');
  await page.click('#menuList .menu-item:has-text("반복 끝 표시")');
  check('반복 끝 표시', await page.$$eval('.srow .measure.re', (els) => els.length) === 6);
  await openMenuItem('measureMenu', '반복 기호');
  await page.click('#menuList .menu-item:has-text("1번 괄호")');
  check('1번 괄호', await page.$eval('.ruler .measure[data-m="1"] .vlab', (el) => el.textContent) === '1.');
  await openMenuItem('exportMenu', '텍스트 타브');
  const t4 = await page.inputValue('#exportText');
  check('텍스트에 반복 기호 줄', /^R /m.test(t4) && t4.indexOf('1.') > 0 && t4.indexOf(':|') > 0);
  await page.click('#closeModal');
  await page.click('#undo'); await page.click('#undo');
  check('반복 기호 되돌림', await page.$$eval('.srow .measure.re', (els) => els.length) === 0);
}

console.log('5. 새로고침 후 복원');
await page.reload();
await page.waitForSelector('.cell');
check('현재 곡 유지', await page.inputValue('#title') === '옛 곡 사본' && await cellText(1, 1, 0) === '12h');
await page.click('#songsBtn');
const titles = await page.$$eval('#songList .song .l', (els) => els.map((e) => e.textContent));
check('목록 유지', JSON.stringify(titles) === JSON.stringify(['옛 곡 사본', '둘째(개명)']), titles);
await page.click('#closeSongs');

console.log('6. 재생/이미지가 예외 없이 동작');
await page.click('#playBtn');
await page.waitForTimeout(600);
check('재생 중 표시', await page.$eval('#playBtn', (el) => el.textContent) === '■');
await page.click('#playBtn');
// 속도 트레이너: 한 마디 반복 + 시작 200, +40 → 두 번째 바퀴부터 240
await page.click('#trainerBtn');
await page.waitForTimeout(250); // 시트 애니메이션
await page.$eval('#trOn', (el) => el.click()); // 스위치 input은 투명해서 좌표 클릭이 불안정
await page.fill('#trStart', '200'); await page.dispatchEvent('#trStart', 'change');
await page.fill('#trStep', '40'); await page.dispatchEvent('#trStep', 'change');
await page.fill('#trMax', '240'); await page.dispatchEvent('#trMax', 'change');
await page.click('#closeTrainer');
await page.selectOption('#loop', 'measure');
await page.click('.cell[data-m="0"][data-s="0"][data-i="0"]');
await page.click('#playBtn');
await page.waitForTimeout(400);
const info1 = await page.textContent('#selInfo');
await page.waitForTimeout(1800); // 200 BPM에서 한 마디 = 1.2초
const info2 = await page.textContent('#selInfo');
check('트레이너 속도 상승 표시', /200 BPM/.test(info1) && /240 BPM/.test(info2), [info1, info2]);
await page.click('#playBtn');
await page.click('#trainerBtn'); await page.waitForTimeout(250); await page.$eval('#trOn', (el) => el.click()); await page.click('#closeTrainer');
await page.selectOption('#loop', 'none');
check('트레이너 끔', !(await page.$eval('#trainerBtn', (el) => el.classList.contains('on'))));
// 드럼 + 스윙을 켜고 재생해도 오류가 없어야 한다
await page.click('#settingsBtn');
await page.selectOption('#drums', 'pop');
await page.$eval('#swing', (el) => { el.value = 60; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#closeSettings');
await page.click('#playBtn');
await page.waitForTimeout(900);
check('드럼·스윙 재생 중', await page.$eval('#playBtn', (el) => el.textContent) === '■');
await page.click('#playBtn');
await page.reload(); await page.waitForSelector('.cell');
check('드럼·스윙 설정 저장', await page.$eval('#drums', (el) => el.value) === 'pop' && await page.$eval('#swing', (el) => el.value) === '60');
await openMenuItem('exportMenu', '이미지로 저장');
check('PNG 생성', await page.$eval('#imgOut img', (img) => img.src.startsWith('data:image/png') && img.naturalWidth > 100));
{
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlImg')]);
  const buf = (await import('node:fs')).readFileSync(await dl.path());
  // 헤드리스 크로미움은 한글 파일명을 'download'로 보고하므로 내용(PNG 시그니처)으로 확인한다
  check('PNG 다운로드', buf.slice(1, 4).toString() === 'PNG' && (/\.png$/.test(dl.suggestedFilename()) || dl.suggestedFilename() === 'download'), dl.suggestedFilename());
}
await page.keyboard.press('Escape');
{
  const [dl] = await Promise.all([page.waitForEvent('download'), openMenuItem('exportMenu', 'MIDI 파일')]);
  const path = await dl.path();
  const buf = (await import('node:fs')).readFileSync(path);
  check('MIDI 다운로드: MThd 헤더', buf.slice(0, 4).toString() === 'MThd' && buf.length > 30 && (dl.suggestedFilename().endsWith('.mid') || dl.suggestedFilename() === 'download'), [dl.suggestedFilename(), buf.length]);
}

check('콘솔/페이지 오류 없음', errors.length === 0, errors);
if (process.env.SHOT) { await page.click('#songsBtn'); await page.screenshot({ path: process.env.SHOT + '/songs.png' }); await page.click('#closeSongs'); await page.screenshot({ path: process.env.SHOT + '/editor.png' }); }
await browser.close();
console.log(failures ? `\n${failures}개 실패` : '\n모두 통과');
process.exit(failures ? 1 : 0);
