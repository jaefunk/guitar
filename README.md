# 기타 TAB 에디터

MusicXML 4.0을 저장 정본으로 사용하는 데스크톱 전문 기타 TAB 편집기입니다. 브라우저에서 MusicXML을 열고, 선택한 TAB 파트를 SVG 악보로 편집·재생한 뒤 전체 문서를 MusicXML 또는 압축 MusicXML로 내보냅니다.

## 실행과 검증

```bash
npm install
npm run dev       # 개발 서버: http://localhost:5173
npm test          # Vitest 단위·통합 테스트
npm run build     # dist/ 프로덕션 빌드
npm run preview   # 빌드 미리보기: http://localhost:4173
npm run test:e2e  # 빌드 + preview 준비 + Chromium 스모크 테스트
```

처음 E2E를 실행하는 환경에서는 `npx playwright install chromium`으로 브라우저를 한 번 설치합니다. `test:e2e`는 기본적으로 4173 포트에서 preview를 직접 시작하고 준비 완료를 기다립니다. 이미 실행 중인 서버는 `APP_URL` 환경 변수로 지정할 수 있습니다.

## 데스크톱 작업 흐름

1. **내보내기 → MusicXML 불러오기**에서 `.musicxml`, `.xml` 또는 `.mxl` 파일을 선택합니다.
2. TAB 후보 파트를 고른 뒤 **불러오기**를 누릅니다. 확인 전에는 보관함이 바뀌지 않습니다.
3. **전문 TAB**에서 음표를 선택하고 오른쪽 속성 패널로 현·프렛·리듬·주법·반복·엔딩을 편집합니다.
4. 속성 패널의 **실행 취소/다시 실행**으로 전문 악보 편집을 되돌립니다.
5. **MusicXML 내보내기** 또는 **압축 MusicXML 내보내기**로 저장합니다. 선택하지 않은 파트와 앱이 해석하지 않는 원본 요소도 보존됩니다.

가져오기 오류는 반입을 차단합니다. 경고가 있는 문서는 열리며 오른쪽 진단 패널에서 해당 마디로 이동할 수 있습니다. 지원 범위 밖 표기는 MusicXML에 남아 있지만 화면이나 재생에 모두 반영되지 않을 수 있습니다.

## 지원 범위

- 6현 TAB, 코드와 쉼표, 4분·8분·16분·32분음표, 점음표, 빔, 3:2 tuplet
- tie, hammer-on, pull-off, slide, bend, dead/ghost note, fermata
- 반복선, 1·2번 엔딩과 이를 펼친 재생 순서
- BPM, 박자표, 튜닝, 카포, 코드 기호
- Web Audio 기반 재생과 선택 이벤트부터의 재생
- MusicXML 4.0 `.musicxml`/`.xml`, 압축 MusicXML `.mxl` 왕복

모바일 전문 UI, 범용 PDF 악보 인식(OMR), 오선보 편집, 다중 트랙 동시 표시는 범위 밖입니다.

## 내장 악보

곡 목록의 **1:03 — Gt.1 전문 TAB 열기**를 명시적으로 누르면 내장 MusicXML을 추가합니다. 악보는 실제 **77마디**, 4/4, BPM 84, 카포 1이며 이후에는 저장된 기존 곡을 다시 엽니다. 모든 새 문서에 자동 복사하지 않습니다.

## 빠른 격자

기존 4마디×16칸 격자는 단순 4/4·16분음표 입력을 위한 보조 모드입니다. v1/v2/v3 데이터는 v4 MusicXML 저장 구조로 마이그레이션됩니다. 임의 MusicXML이나 tuplet·32분음표 등 격자로 무손실 투영할 수 없는 악보에서는 빠른 격자가 읽기 전용이며 전문 TAB에서 편집해야 합니다.

## 아키텍처

```text
MusicXML 4.0 DOM (유일한 영구 저장 정본)
        ↓ parse/index
ScoreIndex (메모리 전용 시간축·주법·반복 투영)
        ├─ SVG TAB 조판
        ├─ 속성 편집 / Undo / Redo
        └─ 반복 전개 / Web Audio 재생
```

| 경로 | 역할 |
|---|---|
| `src/musicxml.js`, `src/mxl.js` | MusicXML 파싱·직렬화, MXL 컨테이너 |
| `src/score-index.js` | 유리수 시간축, chord/rest, 주법 링크, 진단, 반복 전개 |
| `src/score-layout.js`, `src/score-render.js` | 순수 조판과 SVG/인쇄 렌더링 |
| `src/score-edit.js`, `src/score-ui.js` | MusicXML DOM 명령 편집과 Undo/Redo |
| `src/score-audio.js` | ScoreIndex 재생 계획 |
| `src/state.js` | v4 곡 보관함, v3 마이그레이션, localStorage |
| `src/file-workflow.js` | `.xml`/`.musicxml`/`.mxl` 가져오기·내보내기 |
| `songs/nell-1-03-gt1.musicxml` | 내장 1:03 Gt.1 77마디 악보 |

상세 설계와 유지보수 메모는 [HANDOFF.md](HANDOFF.md)를 참고하세요.
