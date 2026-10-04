# 기타 타브 에디터 — 핸드오프 문서

채팅에서 만든 단일 HTML 앱을 코드 세션으로 옮기면서 쓰는 설계 메모입니다.

## 0. 현재 상태 (2026-10)

- 9절의 리팩터링과 8절 로드맵 1~11번이 모두 구현됨. 실행법·파일별 역할은 README.md.
- 테스트: vitest 91개(`npm test`), Chromium 스모크 약 90개 항목(`npm run test:e2e`), GitHub Actions CI.
- localStorage 키는 `gtab-editor-v3`(곡 여러 개). 기존 v1/v2 데이터는 첫 곡으로 자동 마이그레이션. 샘플 악기는 IndexedDB `gtab-samples`.
- 분리 전 원본은 `legacy/guitar-tab-editor.html`에 참고용으로 남겨 둠(더 이상 수정하지 않음).
- 분리 중 고친 버그: `shiftMarks`가 "마지막 줄 삭제"(4마디) 때 지워진 마디 중 첫 마디의 메모만 버리고 나머지 3마디의 메모를 앞 줄로 밀어 넣던 문제.
- 아티팩트 배포본(참고용, 옛 버전): https://claude.ai/artifact/7LiGUkmidiJV2df2Csv9Zk

---

## 1. 제품 요구사항 (사용자가 정한 것)

- 한 줄에 **4마디**, 한 마디는 **16분음표 칸** 고정 그리드. 칸 수는 박자표가 정한다(4/4=16, 3/4=12, 6/8=12 …). 4마디/줄 틀은 유지.
- 폰에서 입력·재생·공유까지 되는 "쓸모 있는" 타브 에디터. Songsterr(재생·반복), Guitar Pro(프렛보드 입력·코드 라이브러리·속도 트레이너), Ultimate Guitar(텍스트 타브)를 참고 모델로 삼음.
- 외부 서버 없이 동작. 저장은 브라우저 localStorage.

## 2. 기술 스택과 제약

- Vanilla JS, ES 모듈(`src/*.js`), 빌드는 Vite(`base:'./'`라 하위 경로 배포 가능). 런타임 라이브러리 없음.
- 외부 리소스는 Google Fonts(`Red Hat Mono`)뿐. 아티팩트 환경 CSP 때문에 외부 스크립트·이미지·fetch를 쓰지 않았음. 자체 호스팅이면 이 제약은 없다(샘플 로딩, 파일 다운로드 등 가능).
- 이미지는 아직 "길게 눌러 저장" 방식. 자체 호스팅에서는 `<a download>`로 바꿔도 됨.
- 모달/확인창은 `confirm()`/`prompt()` 대신 자체 구현(`ask()`, `openMenu()`). iframe sandbox 때문.
- 테마: `:root` 토큰 + `prefers-color-scheme` + `data-theme` 속성. 크기: `data-zoom` (s/m/l/fit).

## 3. 데이터 모델

저장 문서(v3, `gtab-editor-v3`)는 "책장"이고, 편집 코드가 보는 `state`는 "책상 위에 펼친 책 한 권 + 설정"이다.

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
- iOS: 첫 사용자 제스처에서 `AudioContext` 생성·resume 필요(현재 ▶, 숫자판 탭에서 처리). 무음 스위치면 소리 안 남.

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
- 다중 선택은 마디 단위. 칸 단위 범위(`{from:{m,i}, to:{m,i}}`)는 아직 없음.
- 반복 괄호는 마디당 번호 하나(1·2·3). "1,2번" 같은 복수 괄호는 지원하지 않음.
- MIDI의 슬라이드는 피치벤드 범위(±2반음)를 넘으면 2반음까지만 휜다.
- 샘플 악기는 사용자가 직접 올려야 한다(저장소에 샘플을 포함하지 않음). 줄별 샘플이 없으면 가장 가까운 줄의 샘플을 당겨 쓰므로 멀리 떨어진 음은 음색이 변한다.
- 서비스 워커 캐시 이름이 `gtab-v1` 고정. 자산은 해시가 바뀌므로 문제없지만, `sw.js` 자체를 크게 바꾸면 이름을 올릴 것.
- 헤드리스 Chromium은 한글 파일명 다운로드를 `download`로 보고하므로 스모크 테스트는 내용으로 확인한다(실제 브라우저는 정상).

## 8. 로드맵 — 1~11번 모두 완료. 구현 위치 메모

1. 곡 여러 개 관리 — `state.js`(library/activate/flush), `songs.js`.
2. 쉼표/음 끊기 `'.'` + 팜뮤트 `song.pm` — `tab.js`(applyMod/togglePm), `audio.js`(scheduleSlot의 끊기·pm 버퍼), `io.js`(PM 줄).
3. 반복 기호 `song.rep` — `tab.js` `expandRepeats`, `edit.js` `repeatMenuItems`, `render.js`(rs/re/volta 클래스), `io.js`(R 줄).
4. 속도 트레이너 `settings.trainer` — `audio.js`(pb.bpm, tick의 loop wrap), 트랜스포트 ⏱ 시트.
5. 박자표 `song.meter` — `constants.js` METERS, `tab.js` slotsOf/beatOf/resizeMeasures, `edit.js` setMeter.
6. 다중 마디 선택 `ed.range` — `edit.js`(setRange…togglePmRange), `main.js`(길게 누르기), 범위 막대 `#rangeBar`.
7. MIDI — `midi.js`. 8. 코드 인식/다이어그램 — `chords.js`. 9. 드럼/스윙 — `audio.js` drumHits/swingDelay.
10. 샘플 음원 — `samples.js` + 설정 "샘플 악기". 11. Redo(`ed.redoStack`), 가로 맞춤(`ui.js` landscapeFitActive), PWA(`public/`).

## 8b. 다음에 할 만한 것

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

## 10. 다음 작업 프롬프트 예시

```
README.md와 HANDOFF.md를 읽어줘. npm test와 npm run test:e2e가 통과하는지 먼저 확인한 뒤,
HANDOFF 8b절의 "칸 단위 범위 선택과 선택 구간만 재생"을 구현해줘. ed.range를 {from:{m,i}, to:{m,i}}로
넓히되 기존 마디 단위 동작(복사/삭제/조옮김/밀기/팜뮤트)은 그대로 유지하고, 스모크 테스트에 케이스를 추가해.
```

작업 중 지킬 것: 4마디×16칸 그리드 유지, 폰 세로 화면 우선, 외부 의존성 최소, 기존 저장 데이터 깨지지 않게.
