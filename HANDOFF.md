# 기타 타브 에디터 — 핸드오프 문서

채팅에서 만든 단일 HTML 앱을 코드 세션으로 옮기면서 쓰는 설계 메모입니다.

## 0. 현재 상태 (2026-10)

- 데스크톱 전문 TAB v4 완료: MusicXML 4.0 DOM이 유일한 저장 정본이며, `ScoreIndex`는 렌더링·편집·재생용 메모리 투영이다.
- `.musicxml`/`.xml`/`.mxl` 가져오기·내보내기, 파트 선택, SVG TAB, 명령 기반 Undo/Redo, 반복·엔딩 재생과 진단 패널을 제공한다.
- 내장 `1:03` Gt.1은 사용자가 곡 목록에서 명시적으로 열며 실제 77마디·BPM 84·카포 1이다.
- 빠른 격자는 단순 4/4·16분음표 입력 보조 모드다. 무손실 투영할 수 없는 MusicXML에서는 읽기 전용이다.
- 모바일은 현재 제품 범위 밖이다. 범용 PDF→MusicXML OMR, 오선보 편집도 제공하지 않는다.
- 9절의 리팩터링 완료: ES 모듈로 분리, Vite 빌드, vitest 테스트(`npm test`), Playwright 스모크 테스트(`tests/e2e/smoke.mjs`).
- 현재 저장 키는 `gtab-editor-v4`다. `gtab-editor-v3`는 삭제하지 않는 마이그레이션 원본이며, 기존 v1/v2 데이터도 첫 곡으로 자동 변환한다.
- 분리 전 원본은 `legacy/guitar-tab-editor.html`에 참고용으로 남겨 둠(더 이상 수정하지 않음).
- 분리 중 고친 버그: `shiftMarks`가 "마지막 줄 삭제"(4마디) 때 지워진 마디 중 첫 마디의 메모만 버리고 나머지 3마디의 메모를 앞 줄로 밀어 넣던 문제.
- 아티팩트 배포본(참고용, 옛 버전): https://claude.ai/artifact/7LiGUkmidiJV2df2Csv9Zk

---

## 0b. 빠른 격자 확장 (2026-10, PR #2 병합)

격자 모드에 로드맵 2~11이 들어왔다. 설계 요점만 적는다. 상세 함수 위치는 README의 표와 각 모듈 머리말 참고.

- 곡 필드 `meter`, `pm`, `rep`가 `SONG_FIELDS`에 추가됐다. v4 곡은 MusicXML이 정본이므로 `v3-musicxml.js`가 이 필드를 MusicXML로 쓰고 읽는다:
  `meter` → 첫 `<attributes><time>`과 마디당 16분음표 칸 수, `pm['m:i']` → `<direction><other-direction>gtab-pm`, 끊기 셀 `'.'` → `other-direction gtab-stop:<줄 번호>`,
  `rep[m] = {s, e, v}` → `<barline location="left|right">`의 `<repeat>`·`<ending>`. 전문 TAB 쪽(`score-index.js`)은 같은 barline을 읽어 반복·엔딩 재생에 쓴다.
- `slotsOf(song)`/`beatOf(song)`(tab.js)이 박자표에서 칸 수와 한 박 칸 수를 준다. `SLOTS` 상수는 기본값·테스트용이며 격자 코드는 전부 이 헬퍼를 쓴다.
- 편집 세션 `ed`에 `redoStack`, `range`({from,to} 마디 범위)가 있다. 범위 연산·반복 기호·박자표 변경은 모두 `canEditCurrentSong()` 가드를 지난다(읽기 전용 MusicXML 곡에서는 동작하지 않음).
- 격자 재생기(`audio.js`의 `startPlay`)는 `expandRepeats`로 마디 순서를 펼치고, 트레이너(`pb.bpm`)·드럼(`drumHits`)·스윙(`swingDelay`)·샘플 악기(`samples.js`)를 적용한다. 전문 TAB 재생(`startScorePlay`)은 별도라 이 설정의 영향을 받지 않는다.
- 설정에 `trainer`, `drums`, `swing`, `landscapeFit`가 추가됐다(모두 `SETTING_FIELDS`, `sanitizeSettings`에서 검증).
- 텍스트 타브 포맷: 헤더 `(BPM 90, 4/4, 한 칸 = 16분음표)`, 눈금 줄 위에 `R`(반복)·`PM`(팜뮤트)·메모 줄. `parseText`는 `{measures, marks, pm, rep, meter, bpm, title}`을 돌려준다.
- MIDI(`midi.js`)는 격자 데이터 기준(포맷 0, PPQ 480, 줄마다 채널). 코드 인식(`chords.js`)은 피치클래스 템플릿 매칭.
- PWA: `public/manifest.webmanifest`, `public/sw.js`(캐시 이름 `gtab-v1`), 아이콘. 빌드본에서만 서비스 워커를 등록한다.
- 0.4: 범위 선택이 칸 단위(`ed.range = {from:{m,i}, to:{m,i}}`, `tab.js` `colRange`)가 됐다. 마디 경계에 맞는 범위는 마디 삭제·반복 기호 복사까지, 아니면 칸만 다룬다. 범위 막대의 "▶ 구간"은 `startPlay(undefined, {range:true})`.
  괄호 번호는 숫자 또는 배열(`v: [1,2]`, `voltaList`). 곡 순서 `moveSong`, 백업 `toDoc()` JSON ↔ `importBackup`(곡만 추가, id 충돌 시 새 id).
  드럼·스윙은 `rhythm.js`로 분리돼 전문 TAB 재생 계획(`buildPlaybackPlan`의 `drums`·`swing`)에도 들어가고, 트레이너는 컨트롤러의 `onLoop`가 새 plan으로 바꿔 끼우는 방식이다. 샘플 악기는 voice adapter가 줄 번호를 넘겨 쓴다.
- 알려진 한계: MIDI 슬라이드는 ±2반음, 샘플은 사용자가 직접 올림. 헤드리스 Chromium은 한글 파일명 다운로드를 `download`로 보고한다. GitHub Pages 배포는 저장소 설정에서 Source를 GitHub Actions로 바꿔야 켜진다.

## 1. 현재 제품 요구사항

- 제품 방향은 **데스크톱 MusicXML 4.0 전문 TAB 편집기**다.
- MusicXML 문서가 유일한 저장 정본이며, 선택한 TAB 파트를 SVG로 편집·재생하고 전체 문서를 XML/MXL로 왕복한다.
- 데스크톱 악보 조판, 진단, 명령 기반 Undo/Redo, 반복·엔딩 재생을 우선한다.
- 모바일 UI는 현재 범위 밖이다.
- 외부 서버 없이 동작하며 저장은 브라우저 localStorage를 사용한다.

### 레거시 빠른 격자 호환성만을 위한 요구사항

- 한 줄 4마디, 한 마디 16분음표 16칸 구조는 기존 데이터와 빠른 입력 흐름을 위해 유지한다.
- 숫자판·프렛보드 입력, 텍스트 TAB, PNG 공유 기능은 레거시 빠른 격자에서 계속 지원한다.
- tuplet·32분음표 등 무손실 투영이 불가능한 MusicXML은 빠른 격자에서 읽기 전용이다.

## 2. 기술 스택과 제약

- 개발·검증 필수 환경은 **Node.js 20+**와 npm이다. Playwright Chromium은 로컬에서 `npx playwright install chromium`, CI/Linux에서 `npx playwright install --with-deps chromium`으로 설치한다.
- Vanilla JS, ES 모듈(`src/*.js`), 빌드는 Vite(`base:'./'`라 하위 경로 배포 가능). MXL ZIP 처리를 위해 `fflate`를 사용한다.
- 외부 리소스는 Google Fonts(`Red Hat Mono`)뿐. 아티팩트 환경 CSP 때문에 외부 스크립트·이미지·fetch를 쓰지 않았음. 자체 호스팅이면 이 제약은 없다(샘플 로딩, 파일 다운로드 등 가능).
- 이미지는 아직 "길게 눌러 저장" 방식. 자체 호스팅에서는 `<a download>`로 바꿔도 됨.
- 모달/확인창은 `confirm()`/`prompt()` 대신 자체 구현(`ask()`, `openMenu()`). iframe sandbox 때문.
- 테마: `:root` 토큰 + `prefers-color-scheme` + `data-theme` 속성. 크기: `data-zoom` (s/m/l/fit).

## 3. 데이터 모델

현재 저장 문서는 `gtab-editor-v4`이며 곡별 `musicxml`, `selectedPartId`, `editorMode`를 저장한다. MusicXML이 음악 정보의 정본이고 기존 `measures`/`marks`는 빠른 격자 투영이다.

### 레거시 v3 마이그레이션 참고 구조

`gtab-editor-v3`는 삭제하지 않는 마이그레이션 원본이다. 다음 구조는 현재 저장 형식이 아니라 레거시 빠른 격자 구현을 이해하기 위한 참고다.

```js
// 저장되는 문서 (src/state.js: toDoc / sanitizeDoc)
doc = {
  v: 3,
  songs: { [id]: { id, title, tuning, bpm, meter, measures, marks, pm, rep, createdAt, updatedAt } },
  order: [id, ...],          // 목록 순서
  currentId: id,
  settings: { zoom, theme, autoAdv, metro, loop, padMode, fretShift, haptic, collapsed, seen,
              instr, volume, reverb, countIn, preview, trainer:{on,start,step,max}, drums, swing, landscapeFit }
}

// 편집 코드가 보는 평평한 작업 상태 (현재 곡 필드 + settings)
state = {
  title: '', tuning: 'standard', bpm: 90, meter: '4/4',       // METERS 키
  measures: [ /* m */ [ /* s=0..5 (e,B,G,D,A,E) */ [ /* i=0..slots-1 */ '' ] ] ],
  marks: { 'm:i': '텍스트' },   // 마디 위 메모(코드명, 가사, 구간)
  pm: { 'm:i': 1 },             // 팜뮤트 칸(세로 한 줄 전체)
  rep: { m: { s:1, e:횟수, v:괄호번호 } },  // 반복 시작/끝/괄호
  ...settings
}
ed = { sel: {m,s,i}|null, range: {from,to}|null, pending, undoStack, redoStack, clip: {measures, marks, pm, rep} }  // 저장 안 함
```

- 셀 값: `'' | '0'..'24' | '5h' | '12b' | 'x'(뮤트) | '.'(끊기) | 'h'`. 끊기는 재생 때 그 줄의 울리던 음을 멈춘다.
- `slotsOf(song)`/`beatOf(song)`이 박자표에서 칸 수와 한 박의 칸 수를 준다. `SLOTS` 상수는 기본값·테스트용.

- `save()`는 `flush()`로 state의 곡 필드를 `library.songs[currentId]`에 되돌려 넣은 뒤 문서를 통째로 저장한다. measures/marks를 제자리에서 바꾼 코드는 `touch()`(또는 `pushUndo()`)를 불러야 `updatedAt`이 갱신된다.
- 곡 전환(`switchSong`)은 flush → `activate(id)`. 실행 취소 스택은 곡마다 비운다. 마디 클립보드(`ed.clip`)는 곡 사이에서도 유지된다(다른 곡으로 마디 복사 가능).
- v1/v2 블롭은 `migrateLegacy()`가 첫 곡으로 바꾼다. 옛 키는 지우지 않는다.

- `parse(v)` → `{num:'12', mod:'h'}`. 정규식 `^(\d{0,2})(.*)$`.
- 허용 기법 문자 `MODS = h p b / \ ~ x .`. `x`(뮤트)와 `.`(끊기)은 단독, 나머지는 숫자 뒤에 붙음.
- `measures.length`는 항상 4의 배수(`padMeasures()`).
- `sanitizeSong()`/`sanitizeSettings()`가 필드별로 검증하므로 스키마를 바꿀 때 같이 고치고 `tests/state.test.js`에 케이스를 추가.
- 실행 취소: `ed.undoStack`에 `{measures, marks}` JSON 스냅샷(최대 120). `setVal()` 등 모든 변경 전에 `pushUndo()`. 다시 실행(redo)은 없음.

## 4. 코드 구조 (모듈)

| 모듈 | 주요 함수 | 역할 |
|---|---|---|
| `tab.js` | `parse`, `nextDigit`, `applyMod`, `shiftMarks`, `resizeMeasures`, 범위 연산(`sliceRange`, `pasteRange`, `transposeMeasures`, `shiftCells`, `togglePm`), `expandRepeats` | DOM 없는 순수 규칙. 단위 테스트 대상 |
| `state.js` | `load`, `save`, `readDoc`, `migrateLegacy`, `createSong`, `switchSong`, `deleteSong`… | 책장/책상 모델, 검증, 마이그레이션 |
| `render.js` | `render`, `paintCell`, `paintMark`, `setSel`, `setPending`, `updateInfo` | DOM 생성. `dom.cells[m][s][i]`, `dom.marks[m][i]`, `dom.rulers[m]` 캐시 |
| `edit.js` | `inputDigit`, `inputMod`, `del`, `move`, `insertMeasure`, `deleteMeasure`, `copyMeasure`, `pasteMeasure`, `insertChord`, `editMark`, `doUndo` | 편집 동작. 규칙 계산은 `tab.js`에 위임 |
| `fretboard.js` | `buildFretboard`, `updateFretboard`, `fretTap`, `setPadMode`, `setCollapsed` | 지판 입력 UI |
| `audio.js` | `ensureAudio`, `synthSamples`, `playNote`, `getChain`, `scheduleSlot`, `startPlay`, `stopPlay`, `preview`, `drumHits`, `swingDelay` | 아래 5절. `synthSamples`·`drumHits`는 AudioContext 없이도 돌아가 테스트에 쓴다 |
| `samples.js` | `loadAll`, `putSample`, `pick` | 사용자 샘플(IndexedDB) → 줄별 버퍼, 가장 가까운 줄 선택 + playbackRate |
| `chords.js` | `detectChord`, `detectColumn`, `chordDiagramSVG` | 피치클래스 템플릿 매칭(슬래시 코드 포함), SVG 다이어그램 |
| `io.js` | `toText(song)`, `parseText`, `renderImage(song)` | 텍스트 타브(왕복 가능), PNG(canvas). 곡 객체를 인자로 받는다 |
| `midi.js` | `toMidi(song)`, `inspectMidi` | 표준 MIDI 포맷 0, PPQ 480, 줄마다 채널. 되읽기 파서는 테스트용 |
| `songs.js` | `openSongs`, `refreshSongUI`, `bindSongs` | 곡 목록 시트 |
| `ui.js` | `openMenu`, `ask`, `toast`, `applyZoom`, `applyTheme`, `updatePadH` | 시트/대화상자/토스트. `#menuModal`/`#dlg`는 다른 시트 위에서 열리므로 z-index가 더 높다 |
| `main.js` | `bind`, `boot` | 키보드 단축키, 패드·툴바 바인딩, 초기화 |

모듈 사이에 순환 import가 있다(render↔audio, edit↔fretboard 등). 모두 함수 호출 시점에만 서로를 쓰므로 문제없지만, 모듈 최상위에서 다른 모듈의 함수를 호출하지 말 것.

입력 규칙 요약:
- 숫자: 셀 값이 `1`/`2`이고 `pending`이면 두 자리로 합침(≤24). 그 외엔 교체. 자동 이동은 두 자리 가능성이 없을 때만.
- 기법: 현재 셀에 숫자가 있으면 붙임 → 없고 비어 있으면 **왼쪽 이전 음**에 붙임(자동 이동 뒤에 h를 누르는 흐름) → 그것도 없으면 단독 저장.
- Backspace: 현재 셀이 비어 있으면 왼쪽으로 가서 지움.
- 코드 넣기: 운지 문자열은 `EADGBe` 순(낮은 줄부터), 셀 배열은 `e..E`(높은 줄부터)라 `fing[5-s]`.

## 5. 소리 엔진

- 확장 Karplus-Strong을 오프라인으로 계산해 `AudioBuffer`로 캐시(`bufCache[instr+vel+midi]`).
  - 분수 지연(선형 보간) + 2탭 손실 필터(`S`) + 피킹 위치 콤 필터(`pick`) + 여기 노이즈 로우패스(`bright`). 손실 필터가 주는 `S`샘플 지연을 빼서 보정 → 전 음역 0.1센트 이내(테스트 완료).
  - `INSTR` 파라미터: `g`(주기당 감쇠), `S`(0.5가 최대 댐핑), `bright`, `pick`, `len`.
- 악기 체인(`getChain`): 바디 공명 피킹 필터 / 나일론 로우패스 / 일렉 픽업 EQ / 드라이브(WaveShaper tanh + 캐비닛 로우패스). 공통: 리버브 버스(합성 IR 컨볼버) → 마스터 게인 → 컴프레서.
- 스케줄러: `tick()`이 0.25초 앞을 보며 `scheduleSlot(pos, time)`, 70ms 간격. 재생 위치 `pos`는 `order`(반복 기호를 펼친 마디 순서) 위의 칸 번호. 같은 줄의 이전 음은 다음 음 시각에 `stopVoice`. 하이라이트는 `setTimeout`으로 오디오 시각에 맞춤(`scheduleHL`).
- 스윙은 홀수 칸의 소리 시각만 늦추고 격자(`nextTime`)는 유지. 트레이너는 `pb.bpm`을 바꾸고 `slotDur()`이 재생 중엔 그것을 쓴다. 드럼은 `drumHits()`가 박자표의 박 수로 자리를 계산.
- 샘플 악기(`instr==='sample'`)는 `samples.pick()`이 돌려준 버퍼를 `playbackRate`로 조옮김. 뮤트/팜뮤트는 게인 길이로 흉내.
- 스트럼: 같은 칸의 여러 음은 낮은 줄부터 4~9ms 간격. 세기 ±6% 랜덤.
- 기법 재생: `b` 반음 벤딩(playbackRate 램프), `~` LFO 비브라토, `/ \` 다음 음까지 playbackRate 램프, `h/p` 어둡고 작은 여기, `x` 짧게 댐핑된 버퍼.
- 미리듣기(`preview`): 입력 시 해당 음/코드를 1초 재생. 재생 중엔 끔.
- 레거시 빠른 격자의 iOS 호환 메모: 첫 사용자 제스처에서 `AudioContext` 생성·resume이 필요하며 무음 스위치에서는 소리가 나지 않는다.

## 6. 텍스트 타브 포맷 (왕복 가능)

```
곡 제목

(BPM 90, 4/4, 한 칸 = 16분음표)

R |:              2.      x3:|          ← 반복 기호 줄 (있을 때만): |: 시작, :| 끝(앞에 x횟수), n. 괄호
PM______                                ← 팜뮤트 줄 (있을 때만): _ 가 있는 열이 팜뮤트 칸
  Am                      Chorus        ← 메모 줄 (있을 때만). 겹치면 두 칸 띄우고 이어 씀
  1   2   3   4    1   2   3   4 ...    ← 박 눈금
e|0---------------|----------------|...|
B|1---------------|...
...
```
- 셀 폭 `w = max(2, 가장 긴 셀 문자열 길이)`, 각 셀은 `-`로 오른쪽 패딩. 마디 구분 `|`.
- `parseText`는 헤더에서 BPM·박자표를 읽고(없으면 4/4), `[A-Ga-g][b#]?|` 로 시작하는 6줄 묶음을 찾아 마디 길이가 칸 수의 배수인지 검사한다. 눈금 줄 위의 메모/PM/R 줄을 열 위치로 복원한다. 돌려주는 값은 `{measures, marks, pm, rep, meter, bpm, title}`.
- 한계: 앞 메모와 겹쳐 밀린 메모는 밀린 자리의 칸으로 복원된다. 다른 사이트의 타브는 정렬이 달라 거의 실패함.

## 7. 알려진 문제 / 손볼 곳

- `renderImage`는 Google Font 로딩을 기다리지 않아 첫 호출에 폴백 폰트가 쓰일 수 있음 → `document.fonts.ready` 대기.
- `hlTimers` 배열을 주기적으로 잘라내는 방식이 거칠다. 재생 전용 `requestAnimationFrame` 루프로 바꾸면 깔끔.
- 가로 스크롤 중 재생 자동 스크롤이 사용자 스크롤과 충돌할 수 있음(사용자 스크롤 감지 후 잠시 끄기).
- `confirm`류는 Promise 기반 `ask()`로 통일했지만 "마지막 줄 삭제"와 "마디 삭제" 흐름이 중복 코드.
- 접근성: 셀이 `tabindex=-1`인 버튼이라 스크린리더 탐색이 약함.
- 전체 문서를 한 키에 통째로 저장(곡이 수십 개가 되면 저장이 무거워질 수 있음 → 곡별 키 분리 고려).
- 곡 목록에서 순서 바꾸기(드래그)는 없음. `library.order`만 바꾸면 되므로 UI만 추가하면 됨.
- 브라우저 테스트는 `npm run test:e2e`로 빌드·preview 준비·Chromium 검증을 재현한다(CI 연결은 아직 없음).

## 8. 레거시 빠른 격자 백로그 (현재 제품 우선순위 아님)

1. 곡 여러 개 관리 — `state.js`(library/activate/flush), `songs.js`.
2. 쉼표/음 끊기 `'.'` + 팜뮤트 `song.pm` — `tab.js`(applyMod/togglePm), `audio.js`(scheduleSlot의 끊기·pm 버퍼), `io.js`(PM 줄).
3. 반복 기호 `song.rep` — `tab.js` `expandRepeats`, `edit.js` `repeatMenuItems`, `render.js`(rs/re/volta 클래스), `io.js`(R 줄).
4. 속도 트레이너 `settings.trainer` — `audio.js`(pb.bpm, tick의 loop wrap), 트랜스포트 ⏱ 시트.
5. 박자표 `song.meter` — `constants.js` METERS, `tab.js` slotsOf/beatOf/resizeMeasures, `edit.js` setMeter.
6. 다중 마디 선택 `ed.range` — `edit.js`(setRange…togglePmRange), `main.js`(길게 누르기), 범위 막대 `#rangeBar`.
7. MIDI — `midi.js`. 8. 코드 인식/다이어그램 — `chords.js`. 9. 드럼/스윙 — `audio.js` drumHits/swingDelay.
10. 샘플 음원 — `samples.js` + 설정 "샘플 악기". 11. Redo(`ed.redoStack`), 가로 맞춤(`ui.js` landscapeFitActive), PWA(`public/`).

## 8b. 다음에 할 만한 것 (0.4에서 칸 단위 범위·구간 재생·곡 순서·백업·복수 괄호는 완료)

- 칸 단위 범위 선택과 "선택 구간만 재생".
- SoundFont(sf2) 로더 또는 기본 샘플 세트 동봉(라이선스 확인 필요).
- 곡 목록 순서 바꾸기, 곡별 저장 키 분리, 내보내기/가져오기(JSON 백업).
- 복수 괄호(1,2번), 다 카포/세뇨.
- 재생 중 사용자 스크롤 감지, `requestAnimationFrame` 하이라이트.

## 9. 리팩터링 (완료) 와 남은 제안

완료:
- 파일 분리(4절), ES 모듈 + Vite. 단일 파일 배포가 필요하면 `vite-plugin-singlefile`.
- 테스트(vitest, `tests/`):
  - `parseText(toText(song))` 왕복(메모·PM·반복·박자표 7종), 특이값(`12h`, `x`, `.`, 단독 `h`, 빈 마디, 두 글자 줄 이름, CRLF), 실패 조건.
  - `synthSamples()` 피치: 0.05~0.3초 자기상관 → 포물선 보간, 3회 중앙값. E2~E5 ±1, A5 ±1.5, E6 ±3센트(측정 정밀도 한계).
  - `nextDigit`, `applyMod`, `shiftMarks`, 범위 연산, `expandRepeats`, 마이그레이션·곡 관리, MIDI 바이트 되읽기, 코드 인식, 드럼 패턴.
  - 브라우저 스모크(`tests/e2e/smoke.mjs`): 마이그레이션, 입력 규칙, 왕복, 곡 관리, 범위·팜뮤트, 반복, 코드 칩, 재생·트레이너·드럼, 다운로드, PWA, 샘플 업로드.

남은 제안:
- `state` 전역 변이 대신 `setState(patch)` + 구독.
- `PER_LINE`(한 줄 4마디)은 아직 상수. 가로 모드에서 8마디/줄 같은 선택지를 주려면 곡 속성 또는 설정으로.

## 10. 레거시 빠른 격자 유지보수 프롬프트 예시

```
README.md와 HANDOFF.md를 읽어줘. npm test와 npm run test:e2e가 통과하는지 먼저 확인한 뒤,
HANDOFF 8b절에서 남은 항목(SoundFont 로더 또는 기본 샘플 세트, 다 카포/세뇨, 재생 중 사용자 스크롤 감지)을
하나 골라 구현해줘. 격자와 전문 TAB 두 모드에서 모두 동작하는지 확인하고, 스모크 테스트에 케이스를 추가해.
```

레거시 빠른 격자를 수정할 때는 4마디×16칸 데이터 호환성과 기존 저장 데이터 보존을 지킨다. 현재 제품 작업은 데스크톱 전문 TAB과 MusicXML 4.0 정본을 우선한다.
