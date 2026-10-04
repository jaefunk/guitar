# 기타 타브 에디터

폰에서 입력·재생·공유까지 되는 기타 타브 에디터. 한 줄에 4마디, 한 마디는 16분음표 칸(박자표에 따라 8~24칸) 고정 그리드.
외부 서버 없이 동작하고, 곡은 브라우저 localStorage에 여러 개 저장된다. 홈 화면에 설치(PWA)하면 오프라인에서도 열린다.

## 기능

- 입력: 숫자판 / 프렛보드, 두 자리 프렛, 기법(h p b / \ ~), 뮤트 x, 끊기 ·, 코드 라이브러리(다이어그램), 코드 자동 인식(Am7, G/B …)
- 편집: 실행 취소·다시 실행, 마디 삽입/삭제/복사/붙여넣기, 여러 마디 선택(길게 누르기) → 복사·삭제·조옮김·한 칸 밀기·팜뮤트
- 악보: 메모(코드명·가사·구간), 팜뮤트(P.M.), 반복 기호(||: :|| 횟수, 1·2·3번 괄호), 박자표(4/4 3/4 2/4 5/4 6/8 7/8 12/8), 튜닝 6종
- 재생: Karplus-Strong 합성 악기 4종 + 내 샘플 악기, 벤딩·비브라토·슬라이드·해머온, 메트로놈, 카운트 인, 반복(마디/줄/전체), 속도 트레이너, 드럼 백킹(록/팝/발라드), 스윙
- 내보내기: 텍스트 타브(왕복 가능, 메모·PM·반복 포함), PNG, MIDI(.mid), .txt 파일. 불러오기: 텍스트 타브
- 곡 여러 개: 새 곡/열기/이름 바꾸기/복제/삭제. 옛 저장 데이터(v1/v2)는 첫 곡으로 자동 마이그레이션

## 실행

```bash
npm install
npm run dev        # 개발 서버 (http://localhost:5173)
npm run build      # dist/ 에 정적 빌드
npm run preview    # 빌드 결과 미리보기 (http://localhost:4173)
npm test           # vitest 단위 테스트
npm run test:e2e   # 빌드 → preview → Chromium 스모크 테스트 (Playwright)
```

Playwright 브라우저가 없으면 `npx playwright install chromium` 한 번. CI(GitHub Actions)가 push/PR마다 단위·빌드·스모크를 돌린다.

## 구조

| 파일 | 역할 |
|---|---|
| `index.html`, `styles.css` | 마크업과 스타일. 테마는 `:root` 토큰 + `data-theme`, 크기는 `data-zoom` |
| `public/` | PWA manifest, 아이콘, 서비스 워커(`sw.js`) |
| `src/constants.js` | 그리드 상수, 박자표(METERS), 튜닝, 코드 라이브러리, 악기 파라미터 |
| `src/tab.js` | 타브 데이터 순수 함수: `parse`, 입력 규칙, `shiftMarks`, 범위 연산, 반복 기호 전개 `expandRepeats` |
| `src/state.js` | 곡 라이브러리(여러 곡)와 설정, 저장/복원, v1·v2 → v3 마이그레이션 |
| `src/render.js` | 악보 DOM 생성, 선택·범위 표시, 코드 인식 칩 |
| `src/edit.js` | 편집 동작(입력, 삭제, 마디·범위 연산, 반복 기호, 메모, 실행 취소/다시 실행) |
| `src/fretboard.js` | 프렛보드 입력 패드 |
| `src/audio.js` | Karplus-Strong 합성, 악기 체인, 재생 스케줄러(반복·트레이너·스윙·드럼), 미리듣기 |
| `src/samples.js` | 사용자 샘플(IndexedDB) 저장·선택 |
| `src/chords.js` | 코드 자동 인식(템플릿 매칭), 코드 다이어그램 SVG |
| `src/io.js` | 텍스트 타브(왕복 가능) `toText`/`parseText`, PNG `renderImage` |
| `src/midi.js` | 표준 MIDI 파일 작성기 `toMidi`, 검증용 `inspectMidi` |
| `src/songs.js` | 곡 목록 시트 |
| `src/ui.js` | 시트/대화상자/토스트, 테마·크기 적용, 파일 다운로드 |
| `src/main.js` | 이벤트 바인딩과 초기화, 서비스 워커 등록 |
| `tests/*.test.js` | vitest 단위 테스트 |
| `tests/e2e/smoke.mjs` | 실제 Chromium에서 도는 스모크 테스트 (`run.mjs`가 서버를 띄움) |
| `legacy/guitar-tab-editor.html` | 분리 전 단일 파일 원본(참고용) |

자세한 설계 메모는 [HANDOFF.md](HANDOFF.md).
