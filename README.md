# 기타 타브 에디터

폰에서 입력·재생·공유까지 되는 기타 타브 에디터. 한 줄에 4마디, 한 마디는 16분음표 16칸 고정 그리드.
외부 서버 없이 동작하고, 곡은 브라우저 localStorage에 여러 개 저장된다.

## 실행

```bash
npm install
npm run dev        # 개발 서버 (http://localhost:5173)
npm run build      # dist/ 에 정적 빌드
npm run preview    # 빌드 결과 미리보기 (http://localhost:4173)
npm test           # vitest 단위 테스트
```

브라우저 스모크 테스트(Playwright 필요):

```bash
npm run build && npx vite preview --port 4173 &
node tests/e2e/smoke.mjs            # 전역 설치면 PW_MODULE=<playwright 경로>
```

## 구조

| 파일 | 역할 |
|---|---|
| `index.html`, `styles.css` | 마크업과 스타일. 테마는 `:root` 토큰 + `data-theme`, 크기는 `data-zoom` |
| `src/constants.js` | 그리드 상수, 튜닝, 코드 라이브러리, 악기 파라미터 |
| `src/tab.js` | 타브 데이터 순수 함수: `parse`, 두 자리 입력 규칙 `nextDigit`, 기법 붙이기 `applyMod`, `shiftMarks` |
| `src/state.js` | 곡 라이브러리(여러 곡)와 설정, 저장/복원, v1·v2 → v3 마이그레이션 |
| `src/render.js` | 악보 DOM 생성, 선택 표시. 값 변경은 `paintCell`로 부분 갱신 |
| `src/edit.js` | 편집 동작(입력, 삭제, 마디 연산, 코드 넣기, 메모, 실행 취소) |
| `src/fretboard.js` | 프렛보드 입력 패드 |
| `src/audio.js` | Karplus-Strong 합성, 악기 체인, 재생 스케줄러, 미리듣기 |
| `src/io.js` | 텍스트 타브(왕복 가능) `toText`/`parseText`, PNG `renderImage` |
| `src/songs.js` | 곡 목록 시트(새 곡/열기/이름 바꾸기/복제/삭제) |
| `src/ui.js` | 시트/대화상자/토스트, 테마·크기 적용 |
| `src/main.js` | 이벤트 바인딩과 초기화 |
| `legacy/guitar-tab-editor.html` | 분리 전 단일 파일 원본(참고용) |

자세한 설계 메모와 로드맵은 [HANDOFF.md](HANDOFF.md).
