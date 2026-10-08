# Guitar/TAB MusicXML 4.0 종합 Fixture 설계

작성일: 2026-10-08

## 1. 목표

MusicXML 4.0의 기타 및 TAB 관련 기능을 한 번에 가져오기, 렌더링, 재생, 편집, 내보내기 시험할 수 있는 단일 `score-partwise` fixture를 만든다. 파일은 실제 곡의 완성도보다 기능 격리와 실패 원인 추적을 우선한다.

결과 파일은 `tests/fixtures/guitar-tab-all-specs.musicxml`이며 MusicXML 4.0 XSD를 통과해야 한다.

## 2. 범위 정의

여기서 "모든 스펙"은 MusicXML 4.0 전체 480개 요소가 아니라 기타와 TAB 악보에 유효하고 이 프로젝트가 가져오기, 보존, 표시 또는 재생할 가치가 있는 기능 전체를 뜻한다.

다음 항목은 단일 기타/TAB 문서의 범위에서 제외한다.

- `score-timewise`, `opus`, `container`, `sounds`처럼 별도 루트 또는 별도 스키마가 필요한 문서
- 타악기 전용 표기와 오케스트라 악기 전용 기법
- 실제 기타 악보에서 의미가 없는 하프 페달, 오르간 디비전 같은 악기별 지시
- 같은 속성의 모든 숫자, 색상, 글꼴, 위치 조합을 전수 조합한 경우

현재는 지원하지 않는 요소의 보존을 브라우저 DOM 파싱과 XML 직렬화 왕복으로 확인한다. 애플리케이션 가져오기/내보내기의 보존 보장은 해당 모듈 구현 이후 별도로 검증한다.

## 3. 문서 구조

- MusicXML 4.0 `score-partwise`
- 한 개의 기타 파트 `P1`
- 표준 오선 스태프와 6선 TAB 스태프를 포함하는 다중 스태프 구성
- 표준 튜닝 E2-A2-D3-G3-B3-E4, 카포, 튜닝 변경 예제
- 각 기능군을 독립된 마디 또는 짧은 연속 마디에 배치
- 각 구간 첫머리에 `META-*`, `RHYTHM-*`, `TECH-*` 형식의 rehearsal mark 배치
- `identification/miscellaneous`에 fixture 목적과 범위 기록

한 마디에 여러 기능을 무리하게 겹치지 않는다. 연결 요소는 시작과 끝을 인접한 두 마디에 두고 동일한 `number`로 연결한다.

## 4. 기능 구간

### 메타데이터와 조판

- 작품명, 악장명, 작곡자, 편곡자, 저작권, encoding 정보
- page/system/staff layout, scaling, appearance, 글꼴과 색상 속성
- part name/abbreviation, score-instrument, MIDI device/instrument
- print/new-system/new-page와 마디 번호

### 기타 및 TAB 설정

- treble-8 및 TAB clef
- 6현 `staff-details`, 각 `staff-tuning`, `staff-lines`, capo
- standard tuning과 drop-D/scordatura 변경
- `string`, `fret`, 왼손 fingering, 오른손 pluck
- fretboard `frame`, barre, open/muted string 표시

### 음과 리듬

- 일반음, 코드, 쉼표, 마디 쉼표, cue, grace, slash grace
- whole부터 32nd까지의 주요 음가, 점음표와 겹점음표
- beam 시작/계속/종료와 hook
- 3:2, 5:4 tuplet 및 `time-modification`
- tie와 tied, 다중 voice, backup, forward, cross-staff
- accidentals, enharmonic spelling, stem, notehead, notehead-text

### 기타 주법

- hammer-on, pull-off
- slide와 glissando
- bend: pre-bend, release, with-bar, bend-alter
- natural/artificial harmonic, base/touching/sounding pitch
- open-string, stopped, thumb-position
- tap, heel, toe, fingernails
- up/down stroke, arpeggiate, non-arpeggiate
- vibrato 성격의 wavy-line, tremolo
- dead note, ghost note, mute 및 let-ring 텍스트 지시

### 일반 기보와 표현

- slur, phrase 관계, fermata
- accent, strong-accent, staccato, tenuto, detached-legato
- dynamics, crescendo/diminuendo wedge
- metronome와 tempo 변경, rehearsal, words
- octave-shift, bracket, dashes
- ornaments와 accidental-mark
- lyric의 syllabic, elision, extend

### 화성과 진행

- major/minor/dominant/seventh/suspended 계열 harmony
- root, bass, degree add/alter/subtract
- offset과 inversion
- chord frame과 barre
- segno, coda, fine, D.C., D.S., To Coda

### 마디와 반복

- forward/backward repeat와 repeat times
- 1번 및 2번 ending
- double/final barline
- measure repeat, beat repeat, slash, multiple rest
- pickup/implicit measure와 박자 변경
- key, time, divisions 변경

## 5. 실패 추적 방식

각 기능 구간은 사람이 읽을 수 있는 rehearsal mark를 갖는다. 예를 들어 bend 구간은 `TECH-BEND`, 반복 구간은 `FLOW-REPEAT`로 표시한다. XML 주석은 테스트 식별의 정본으로 사용하지 않으며, MusicXML 요소 자체에 들어 있는 rehearsal text를 사용한다.

마디 번호는 순차 정수로 유지한다. pickup만 `implicit="yes"`를 사용하되 번호는 중복하지 않는다.

## 6. 검증

### 구조 검증

- 공식 MusicXML 4.0 XSD로 schema validation
- XML 문법 및 ID/IDREF 참조 검증
- 모든 시작/끝 표기의 번호 짝 확인
- 각 마디의 voice별 duration과 박자 길이 확인

### 프로젝트 검증

현재 자동 검증 범위는 테스트 환경의 DOMParser/XMLSerializer와 fixture 자체의 구조·기보 의미다. 애플리케이션 MusicXML 파서, ScoreIndex, MusicXML 가져오기/내보내기 모듈은 아직 없으며 이 작업에서 구현하지 않는다.

- DOM 파싱으로 TAB 파트, 튜닝, 기능 구간과 핵심 요소/속성 값을 확인
- 연결 기호의 시작·끝 순서와 식별자, tie의 음높이 대응을 확인
- 활성 divisions/박자에 따라 note/chord/backup/forward 및 voice의 시간 진행을 검사하고, cross-staff를 같은 voice로 추적
- pickup은 양수이면서 온마디보다 짧게, 나머지 마디는 각 활성 voice가 박자 길이를 채우는지 확인
- DOM 직렬화 후 재파싱해 미지원 요소·레이아웃 노드의 보존을 확인

향후 해당 애플리케이션 모듈이 구현되면 다음 검증을 추가한다.

- 애플리케이션 MusicXML 파서의 TAB 파트 탐지
- ScoreIndex의 chord/rest/backup/forward/tuplet 해석과 기능 인덱싱
- 애플리케이션 MusicXML 가져오기 → 내보내기 → 재가져오기 왕복과 미지원 요소 보존

현재 DOM 왕복 테스트 통과는 위 애플리케이션 통합 검증의 통과를 의미하지 않는다.

### 수동 호환성 확인

가능하면 MuseScore 같은 독립 MusicXML 리더에서 파일을 열어 파싱 오류와 명백한 조판 붕괴가 없는지 확인한다. 독립 앱이 없으면 XSD와 프로젝트 테스트 결과만 완료 근거로 사용하고 그 제한을 기록한다.

## 7. 완료 조건

- `tests/fixtures/guitar-tab-all-specs.musicxml` 파일 하나가 생성된다.
- 파일이 MusicXML 4.0 XSD 검증을 통과한다.
- 기타/TAB 기능 구간이 rehearsal mark로 구분된다.
- 시작/끝 관계와 마디 duration 검사가 통과한다.
- 저장소의 기존 테스트와 빌드가 통과한다.
- fixture 자동 테스트가 DOM 파싱, TAB 파트 탐지, 핵심 기능 값·연결·시간 진행과 DOM 직렬화 왕복 보존을 검증한다. 아직 없는 애플리케이션 파서/ScoreIndex/import-export의 통합 검증은 완료 조건에 포함하지 않는다.
