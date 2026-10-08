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
- 실행법과 파일별 역할은 README.md 참고. 아래 2~4절은 분리 후 구조 기준으로 고쳐 두었다.
- 분리 중 고친 버그: `shiftMarks`가 "마지막 줄 삭제"(4마디) 때 지워진 마디 중 첫 마디의 메모만 버리고 나머지 3마디의 메모를 앞 줄로 밀어 넣던 문제.
- 아티팩트 배포본(참고용): https://claude.ai/artifact/7LiGUkmidiJV2df2Csv9Zk

---

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
  songs: { [id]: { id, title, tuning, bpm, measures, marks, createdAt, updatedAt } },
  order: [id, ...],          // 목록 순서
  currentId: id,
  settings: { zoom, theme, autoAdv, metro, loop, padMode, fretShift, haptic,
              collapsed, seen, instr, volume, reverb, countIn, preview }
}

// 편집 코드가 보는 평평한 작업 상태 (현재 곡 필드 + settings)
state = {
  title: '', tuning: 'standard', bpm: 90,
  measures: [ /* m */ [ /* s=0..5 (e,B,G,D,A,E) */ [ /* i=0..15 */ '' ] ] ],
  marks: { 'm:i': '텍스트' }, // 마디 위 메모(코드명, 가사, 구간)
  zoom: 'm', theme: 'system', autoAdv: true, metro: false, loop: 'none'|'measure'|'line'|'all',
  padMode: 'keys'|'fret', fretShift: 0|12, haptic: true, collapsed: false, seen: false,
  instr: 'acoustic'|'nylon'|'clean'|'drive', volume: 0.8, reverb: 0.25, countIn: false, preview: true
}
ed = { sel: {m,s,i}|null, pending: bool, undoStack: [...], clip: {m, marks}|null }  // 저장 안 함
```

- `save()`는 `flush()`로 state의 곡 필드를 `library.songs[currentId]`에 되돌려 넣은 뒤 문서를 통째로 저장한다. measures/marks를 제자리에서 바꾼 코드는 `touch()`(또는 `pushUndo()`)를 불러야 `updatedAt`이 갱신된다.
- 곡 전환(`switchSong`)은 flush → `activate(id)`. 실행 취소 스택은 곡마다 비운다. 마디 클립보드(`ed.clip`)는 곡 사이에서도 유지된다(다른 곡으로 마디 복사 가능).
- v1/v2 블롭은 `migrateLegacy()`가 첫 곡으로 바꾼다. 옛 키는 지우지 않는다.

- 셀 값은 문자열: `'' | '0'..'24' | '5h' | '12b' | 'x' | 'h'`. `parse(v)` → `{num:'12', mod:'h'}`. 정규식 `^(\d{0,2})(.*)$`.
- 허용 기법 문자 `MODS = h p b / \ ~ x`. `x`는 단독(뮤트), 나머지는 숫자 뒤에 붙음.
- `measures.length`는 항상 4의 배수(`padMeasures()`).
- `sanitizeSong()`/`sanitizeSettings()`가 필드별로 검증하므로 스키마를 바꿀 때 같이 고치고 `tests/state.test.js`에 케이스를 추가.
- 실행 취소: `ed.undoStack`에 `{measures, marks}` JSON 스냅샷(최대 120). `setVal()` 등 모든 변경 전에 `pushUndo()`. 다시 실행(redo)은 없음.

## 4. 코드 구조 (모듈)

| 모듈 | 주요 함수 | 역할 |
|---|---|---|
| `tab.js` | `parse`, `nextDigit`, `applyMod`, `shiftMarks`, `padMeasures`, `nextNoteOnString` | DOM 없는 순수 규칙. 단위 테스트 대상 |
| `state.js` | `load`, `save`, `readDoc`, `migrateLegacy`, `createSong`, `switchSong`, `deleteSong`… | 책장/책상 모델, 검증, 마이그레이션 |
| `render.js` | `render`, `paintCell`, `paintMark`, `setSel`, `setPending`, `updateInfo` | DOM 생성. `dom.cells[m][s][i]`, `dom.marks[m][i]`, `dom.rulers[m]` 캐시 |
| `edit.js` | `inputDigit`, `inputMod`, `del`, `move`, `insertMeasure`, `deleteMeasure`, `copyMeasure`, `pasteMeasure`, `insertChord`, `editMark`, `doUndo` | 편집 동작. 규칙 계산은 `tab.js`에 위임 |
| `fretboard.js` | `buildFretboard`, `updateFretboard`, `fretTap`, `setPadMode`, `setCollapsed` | 지판 입력 UI |
| `audio.js` | `ensureAudio`, `synthSamples`, `playNote`, `getChain`, `scheduleSlot`, `startPlay`, `stopPlay`, `preview` | 아래 5절. `synthSamples`는 AudioContext 없이도 돌아가 피치 테스트에 쓴다 |
| `io.js` | `toText(song)`, `parseText`, `renderImage(song)` | 텍스트 타브(왕복 가능), PNG(canvas). 곡 객체를 인자로 받는다 |
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
- 스케줄러: `tick()`이 0.25초 앞을 보며 `scheduleSlot(pos, time)`, 70ms 간격. 같은 줄의 이전 음은 다음 음 시각에 `stopVoice`. 하이라이트는 `setTimeout`으로 오디오 시각에 맞춤(`scheduleHL`).
- 스트럼: 같은 칸의 여러 음은 낮은 줄부터 4~9ms 간격. 세기 ±6% 랜덤.
- 기법 재생: `b` 반음 벤딩(playbackRate 램프), `~` LFO 비브라토, `/ \` 다음 음까지 playbackRate 램프, `h/p` 어둡고 작은 여기, `x` 짧게 댐핑된 버퍼.
- 미리듣기(`preview`): 입력 시 해당 음/코드를 1초 재생. 재생 중엔 끔.
- 레거시 빠른 격자의 iOS 호환 메모: 첫 사용자 제스처에서 `AudioContext` 생성·resume이 필요하며 무음 스위치에서는 소리가 나지 않는다.

## 6. 텍스트 타브 포맷 (왕복 가능)

```
곡 제목

(BPM 90, 한 칸 = 16분음표)

  Am                      Chorus        ← marks (있을 때만)
  1   2   3   4    1   2   3   4 ...    ← 박 눈금
e|0---------------|----------------|...|
B|1---------------|...
...
```
- 셀 폭 `w = max(2, 가장 긴 셀 문자열 길이)`, 각 셀은 `-`로 오른쪽 패딩. 마디 구분 `|`.
- `parseText`는 `[A-Ga-g][b#]?|` 로 시작하는 6줄 묶음을 찾고, 각 마디 길이가 16의 배수인지 검사. **메모 줄은 복원하지 않음**(개선 포인트). 다른 사이트의 타브는 정렬이 달라 거의 실패함.

## 7. 알려진 문제 / 손볼 곳

- `renderImage`는 Google Font 로딩을 기다리지 않아 첫 호출에 폴백 폰트가 쓰일 수 있음 → `document.fonts.ready` 대기.
- `hlTimers` 배열을 주기적으로 잘라내는 방식이 거칠다. 재생 전용 `requestAnimationFrame` 루프로 바꾸면 깔끔.
- 가로 스크롤 중 재생 자동 스크롤이 사용자 스크롤과 충돌할 수 있음(사용자 스크롤 감지 후 잠시 끄기).
- 메모(`marks`)는 마디 삽입/삭제 때 `shiftMarks`로 밀지만, 마디 복사/붙여넣기 외엔 셀 단위 밀기가 없음.
- `confirm`류는 Promise 기반 `ask()`로 통일했지만 "마지막 줄 삭제"와 "마디 삭제" 흐름이 중복 코드.
- 접근성: 셀이 `tabindex=-1`인 버튼이라 스크린리더 탐색이 약함.
- 전체 문서를 한 키에 통째로 저장(곡이 수십 개가 되면 저장이 무거워질 수 있음 → 곡별 키 분리 고려).
- 곡 목록에서 순서 바꾸기(드래그)는 없음. `library.order`만 바꾸면 되므로 UI만 추가하면 됨.
- 브라우저 테스트는 `npm run test:e2e`로 빌드·preview 준비·Chromium 검증을 재현한다(CI 연결은 아직 없음).

## 8. 레거시 빠른 격자 백로그 (현재 제품 우선순위 아님)

1. ~~**곡 여러 개 관리**~~ — 완료(0절 참고).
2. **쉼표/음 끊기 + 팜뮤트** — 셀 값에 `'-'`(끊기) 추가: `parse`가 인식, `scheduleSlot`에서 해당 줄 `stopVoice`만 수행. 팜뮤트는 마디/구간 플래그 `pm:[start,end]`로 두고 재생 시 `muted` 비슷한 짧은 버퍼 + 로우패스.
3. **반복 기호** — 마디 플래그 `repeatStart`, `repeatEnd{times, endings}`. 재생 전에 플래그를 펼쳐 "재생 순서 배열"을 만들고 `playPos`는 그 배열의 인덱스로. 렌더는 `||:` `:||` 바라인과 1·2번 괄호를 눈금 줄에.
4. **속도 트레이너** — 반복 모드에 `trainer:{start:60, step:5, max:100}`. `loopOn`으로 돌아올 때 `state.bpm` 대신 `effectiveBpm` 갱신. UI는 반복 셀렉트 옆 토글.
5. **박자표** — `SLOTS`를 상수에서 곡 속성 `beats*4`(3/4→12, 6/8→12 but 눈금 2박)로. `render`, `toText`, `parseText`, `renderImage`, `move`, `nextNoteOnString`이 전부 `SLOTS`를 참조하므로 함수 인자/곡 속성으로 치환.
6. **다중 마디 선택** — 선택을 `{m,s,i}`에서 범위 `{from:{m,i}, to:{m,i}}`로 확장(길게 눌러 시작). 복사·삭제·조옮김(±n프렛, 24 초과·0 미만 처리)·칸 밀기.
7. **MIDI 내보내기** — 표준 MIDI 파일 작성기(포맷 0, PPQ 480)는 100줄 내외. 16분 = 120틱, 노트 길이는 같은 줄 다음 음까지. 로컬 환경에선 `<a download>` 사용 가능.
8. **코드 자동 인식/다이어그램** — 눌린 프렛을 피치클래스 집합으로 → 템플릿 매칭(메이저/마이너/7th/sus 등). 다이어그램은 작은 SVG 6×5 격자.
9. **드럼 백킹, 스윙** — 백킹은 노이즈/사인 합성 킥·스네어·하이햇으로 충분. 스윙은 `scheduleSlot`에서 홀수 16분(i%2===1) 시각에 `swing*slotDur` 지연.
10. **샘플 기반 음원** — 로컬 호스팅이면 SoundFont(sf2/sfz) 또는 줄별 open-string 샘플 + 피치시프트. 합성보다 확실히 좋아짐.
11. **Redo**, 가로 모드에서 한 줄 맞춤(`fit` 줌 로직 재사용), PWA(manifest + service worker)로 홈 화면 설치/오프라인.

## 9. 리팩터링 (완료) 와 남은 제안

완료:
- 파일 분리(4절), ES 모듈 + Vite. 단일 파일 배포가 필요하면 `vite-plugin-singlefile`.
- 테스트(vitest, `tests/`):
  - `parseText(toText(song))`이 `song.measures`와 같은지(왕복), 특이값(`12h`, `x`, 단독 `h`, 빈 마디, 두 글자 줄 이름, CRLF), 실패 조건.
  - `synthSamples()` 피치: 0.05~0.3초 자기상관 → 포물선 보간. E2~A5는 ±1센트, E6(주기 33샘플)은 측정 정밀도 한계로 ±2.5센트.
  - `nextDigit` 두 자리 규칙, `applyMod`의 "이전 음에 붙이기", `shiftMarks`, v2→v3 마이그레이션, 곡 관리 연산.

남은 제안:
- `state` 전역 변이 대신 `setState(patch)` + 구독.
- 전역 상수 `SLOTS`, `PER_LINE`을 곡 속성으로 바꿀 준비(박자표 대비).
- 스모크 테스트를 CI(GitHub Actions)에서 돌리기.

## 10. 레거시 빠른 격자 유지보수 프롬프트 예시

```
README.md와 HANDOFF.md를 읽어줘. npm test와 tests/e2e/smoke.mjs가 통과하는지 먼저 확인한 뒤,
로드맵 2번(쉼표/음 끊기 + 팜뮤트)을 구현해줘. 셀 값 '-'를 parse/toText/parseText/renderImage/
scheduleSlot이 모두 알아보게 하고, 왕복 테스트에 케이스를 추가해.
```

레거시 빠른 격자를 수정할 때는 4마디×16칸 데이터 호환성과 기존 저장 데이터 보존을 지킨다. 현재 제품 작업은 데스크톱 전문 TAB과 MusicXML 4.0 정본을 우선한다.
