# 전문 TAB 및 MusicXML 4.0 설계

작성일: 2026-10-08

## 1. 목표

기타 타브 에디터를 데스크톱용 전문 TAB 편집기로 확장한다. 사용자는 MusicXML 4.0 악보를 가져오고 편집하고 재생한 뒤 다시 MusicXML로 내보낼 수 있어야 한다. 제공된 `넬(Nell) - 1:03` PDF의 Gt1 파트 75마디를 음악적으로 동일하게 표현하고 재생하는 것을 첫 번째 완성 기준으로 삼는다.

전문 TAB에는 다음 표현을 포함한다.

- 4분·8분·16분·32분음표와 점음표
- 쉼표와 음 끊기
- 빔, 셋잇단음표, 붙임줄과 슬러
- 해머온, 풀오프, 슬라이드, 벤드, 비브라토
- 뮤트와 고스트 노트
- 코드와 단음 멜로디
- 반복선, 반복 횟수, 1·2번 엔딩
- 마디번호, 코드 기호, BPM, 박자표, 카포와 튜닝
- 페르마타

## 2. 범위

### 포함

- 데스크톱 레이아웃
- MusicXML 4.0 `.musicxml` 및 `.xml` 가져오기·내보내기
- 압축 MusicXML `.mxl` 가져오기·내보내기
- 선택한 기타 파트의 전문 SVG TAB 조판
- TAB 이벤트 편집과 명령 기반 Undo/Redo
- 반복과 엔딩을 반영한 재생
- 기존 v3 저장 데이터의 MusicXML 기반 저장 구조 마이그레이션
- 기존 16칸 편집기의 빠른 입력 모드 유지
- `1:03` Gt1 75마디 MusicXML 전사와 검증

### 제외

- 모바일 레이아웃
- 오선보 렌더링 및 편집
- 보컬과 Gt2를 동시에 화면에 표시하는 다중 트랙 UI
- 임의 PDF를 자동 인식하는 OMR 기능
- 원본 PDF와 동일한 페이지 여백 및 줄바꿈 복제

PDF→MusicXML 범용 변환은 별도 프로젝트로 취급한다. 이 프로젝트는 MusicXML 입력 이후의 편집·조판·재생만 책임진다.

## 3. 핵심 결정

### 3.1 MusicXML이 유일한 저장 정본이다

별도 `ScoreDocument v4` 영구 포맷은 만들지 않는다. 각 곡은 MusicXML 4.0 문서와 앱 전용 설정으로 저장한다. 가져온 문서에서 지원하지 않는 요소도 삭제하지 않으며, 내보낼 때 원문 구조에 유지한다.

MusicXML은 교환과 보존에 적합하지만 화면 조판과 재생 질의에는 비효율적이다. 따라서 메모리 전용 `ScoreIndex`를 생성한다. `ScoreIndex`는 저장하지 않으며 언제든 MusicXML에서 다시 만들 수 있다.

```text
MusicXML 4.0 문서 (저장 정본)
        ↓ parse/index
ScoreIndex (메모리 전용)
        ├─ SVG TAB 조판
        ├─ 이벤트 편집 선택
        └─ 반복 전개 및 재생
        ↑
편집 명령 → MusicXML DOM 수정 → 영향받은 마디 재인덱싱
```

### 3.2 선택 파트만 표시하고 전체 문서를 보존한다

가져오기 시 `part-list`, clef, staff details, part name을 분석한다. TAB clef가 있거나 이름이 기타 파트인 항목을 후보로 제시하고 사용자가 Gt1을 선택한다. 화면과 재생은 선택 파트만 사용하지만 다른 파트는 MusicXML 원문에 그대로 남긴다.

### 3.3 화면 좌표는 저장하지 않는다

음악적 시간, 음가, 현·프렛과 표기 정보만 저장한다. SVG 좌표, 시스템 줄바꿈과 페이지 배치는 렌더러가 계산한다. 화면에서는 창 너비에 맞추고 인쇄에서는 A4 폭을 기준으로 조판한다.

## 4. 구성 요소

### `musicxml.js`

- XML 문자열을 안전하게 파싱한다.
- MusicXML 버전, 파트, measure, note, backup/forward, attributes, barline을 읽는다.
- fret, string, tuning, capo와 기타 기술 표기를 읽고 쓴다.
- DOM 수정 헬퍼와 XML 직렬화를 제공한다.
- 파서가 이해하지 못하는 노드와 속성을 보존한다.

### `mxl.js`

- `.mxl` ZIP 컨테이너를 열어 `META-INF/container.xml`의 루트 MusicXML을 찾는다.
- MusicXML과 컨테이너를 압축해 `.mxl`로 내보낸다.
- 브라우저에서 ZIP을 처리하기 위해 `fflate`를 유일한 신규 런타임 의존성으로 사용한다.

### `score-index.js`

- 각 measure의 실제 시간축을 계산한다.
- chord note를 같은 이벤트로 묶는다.
- divisions가 다른 마디도 유리수 시간으로 정규화한다.
- tie, slur, hammer-on, pull-off, slide, bend의 시작과 끝을 연결한다.
- 반복선과 엔딩을 실제 재생 순서 배열로 전개한다.
- 진단 정보를 생성한다.

### `score-render.js`

- 6선 TAB, fret 숫자와 리듬 stem/beam을 SVG로 생성한다.
- 음가 밀도에 따라 마디 폭을 계산한다.
- 셋잇단 괄호, 점, 붙임줄, 주법선, 벤드 화살표를 충돌 없이 배치한다.
- 반복선, 엔딩 괄호, 마디번호, 코드 기호를 렌더링한다.
- MusicXML이나 앱 상태를 변경하지 않는다.

### `score-edit.js`

- 선택, 삽입, 삭제, 이동, 음가 변경과 기술 표기 연결을 명령으로 캡슐화한다.
- 각 명령은 `apply()`와 `revert()`를 제공한다.
- 명령은 MusicXML DOM을 수정한 뒤 영향받은 measure만 재인덱싱한다.
- Undo와 Redo 스택은 곡 전환 시 초기화한다.

### `score-audio.js`

- `ScoreIndex`의 시간축과 반복 전개 결과를 기존 Web Audio 합성기에 공급한다.
- 동일 현의 다음 음, tie와 명시적 rest를 고려해 gate를 계산한다.
- bend, slide, hammer-on, pull-off, mute와 vibrato를 현재 합성 파라미터에 매핑한다.

## 5. 저장과 마이그레이션

저장 문서는 기존 곡 라이브러리 구조를 유지하되 각 곡이 다음 내용을 갖는다.

```js
song = {
  id,
  title,
  musicxml,
  selectedPartId,
  createdAt,
  updatedAt
}
```

테마, 오디오와 편집기 설정은 기존 전역 settings에 둔다. MusicXML 문서 내부의 제목, BPM, 카포와 튜닝이 음악 정보의 정본이다.

v3 곡은 첫 로드 때 다음 규칙으로 MusicXML 4.0 문서로 변환한다.

- 한 칸은 16분음표 위치로 변환한다.
- 같은 칸의 여러 현은 chord note로 변환한다.
- 기존 `h`, `p`, `b`, `/`, `\\`, `~`, `x` 표기를 MusicXML technical/notations 요소로 변환한다.
- marks는 harmony 또는 direction words로 변환한다.
- 원래 v3 blob은 즉시 삭제하지 않는다.

## 6. 데스크톱 UI

### 상단 도구막대

- MusicXML/MXL 열기 및 저장
- 곡 제목, BPM, 카포, 튜닝
- 전문 TAB과 빠른 입력 모드 전환
- Undo와 Redo

### 왼쪽 탐색기

- 마디 목록과 현재 재생 위치
- 반복과 엔딩 구간
- 진단 오류·경고가 있는 마디

### 중앙 악보

- 시스템 단위 SVG TAB
- 음 또는 빈 리듬 위치 선택
- 재생 위치와 선택 이벤트 강조

### 오른쪽 속성 패널

- 음가, 점, tuplet
- 현, 프렛, rest, dead note, ghost note
- hammer-on, pull-off, slide, bend, tie, slur, vibrato
- 마디 반복과 엔딩 속성

### 하단 재생 바

- 재생·정지, 위치, BPM 배율, 반복 범위와 메트로놈

기존 16칸 UI는 빠른 입력 모드로 유지한다. 4/4의 16분음표 격자로 표현 가능한 마디만 양쪽 모드에서 편집한다. 셋잇단이나 32분음표가 있는 마디는 빠른 입력 모드에서 읽기 전용으로 표시하고 전문 TAB 모드로 이동하는 안내를 제공한다.

## 7. MusicXML 왕복

- `.musicxml`과 `.xml`은 `DOMParser`와 `XMLSerializer`를 사용한다.
- `.mxl`은 컨테이너의 rootfile 경로를 따라 MusicXML을 읽는다.
- 가져온 전체 문서를 보존하고 선택 파트만 수정한다.
- 새로 생성한 문서는 MusicXML 4.0 partwise 형식을 사용한다.
- 앱 전용 stable ID가 필요하면 MusicXML의 `id` 속성을 우선 사용하고, 없으면 메모리에서 경로 기반 ID를 생성한다. 경로 기반 ID는 내보내지 않는다.
- 들여쓰기나 속성 순서는 달라질 수 있으나 음악적 의미와 미지원 요소는 유지한다.

## 8. 오류 처리

가져오기 실패는 기존 곡을 변경하지 않는다. 성공적으로 파싱하고 최소 구조 검증을 통과한 뒤 새 곡으로 추가한다.

진단 항목은 다음과 같다.

- XML 문법 또는 MXL 컨테이너 오류
- 지원하지 않는 MusicXML 버전
- TAB 후보 파트 부재
- 마디 길이와 박자표 불일치
- 존재하지 않는 현 또는 음수 프렛
- 시작 또는 끝이 없는 연결 주법
- 잘못된 반복과 엔딩 구조
- 렌더링하지 못하는 표기

오류는 가져오기를 막고, 경고는 문서를 열되 탐색기에 표시한다. 자동 저장 전에 마지막 정상 MusicXML을 복구본으로 보존한다.

## 9. `1:03` Gt1 전사

제공된 7페이지 PDF에서 Gt1만 수작업으로 MusicXML 4.0에 전사한다. 보컬과 Gt2는 전사하지 않는다. 결과는 샘플 MusicXML로 저장하고 앱에서 기본 제공 곡으로 불러올 수 있게 한다.

검증 체크포인트:

- 총 75마디
- 4/4, BPM 84, 카포 1
- 도입부 코드와 5마디 이후 단음 프레이즈
- 21마디 부근의 hammer-on과 dead note
- 25마디 반복 시작
- 33마디 이후 1번 엔딩
- 49마디 이후 2번 엔딩, 반음 bend, pull-off, slide와 tuplet
- 71마디 반복 구간과 1번 엔딩
- 75마디 2번 엔딩과 fermata 종지

마디별로 PDF 이미지, MusicXML 이벤트 목록과 앱 SVG를 대조한다.

## 10. 테스트와 승인 기준

### 단위 테스트

- MusicXML parse/serialize
- divisions와 유리수 시간 계산
- chord, rest, backup/forward 처리
- technique 연결
- 반복 및 엔딩 재생 순서
- v3 마이그레이션
- MXL container 읽기와 쓰기

### 왕복 테스트

MusicXML을 가져오고 내보낸 뒤 다시 가져와 다음 의미가 동일한지 비교한다.

- measure와 event 수
- onset과 duration
- string, fret, pitch
- 기술 표기 연결
- 반복과 엔딩
- tempo, tuning과 capo

### 렌더링 테스트

- 순수 layout 함수의 좌표와 충돌 규칙
- 대표 SVG fixture 스냅샷
- 화면 폭과 A4 인쇄 폭의 줄바꿈

### 브라우저 스모크 테스트

- XML 및 MXL 가져오기
- 파트 선택
- note 편집과 Undo/Redo
- 전문 TAB 재생
- 내보내기 후 재가져오기

### 완료 조건

- 기존 단위 테스트 전체 통과
- 신규 단위·왕복 테스트 전체 통과
- 프로덕션 빌드 성공
- 브라우저 스모크 테스트 통과
- `1:03` Gt1 75마디 체크리스트 통과
- 반복을 펼친 재생 순서가 원본 악보와 일치
- 주요 TAB 표기가 겹치지 않고 읽을 수 있음

## 11. 참고 표준

- [MusicXML 4.0](https://www.w3.org/2021/06/musicxml40/)
- [MusicXML 4.0 Tablature](https://www.w3.org/2021/06/musicxml40/tutorial/tablature/)
