# Guitar/TAB MusicXML 4.0 Comprehensive Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기타와 TAB에 의미 있는 MusicXML 4.0 기능을 기능별 마디로 격리한 단일 종합 fixture와 자동 검증을 추가한다.

**Architecture:** `guitar-tab-all-specs.musicxml`은 한 개의 다중 스태프 기타 파트로 구성하고 rehearsal mark를 기능 식별자이자 테스트 계약으로 사용한다. Vitest는 구조, 기능 존재, 연결 번호와 XML 왕복 보존을 검사하고 PowerShell 검증기는 공식 MusicXML 4.0 XSD를 내려받아 schema validation을 수행한다.

**Tech Stack:** MusicXML 4.0, XML, Vitest 3, jsdom, PowerShell/.NET `System.Xml.Schema`

---

## File map

### Create

- `tests/fixtures/guitar-tab-all-specs.musicxml` — 기타/TAB 종합 MusicXML 4.0 fixture
- `tests/guitar-tab-fixture.test.js` — fixture 구조, 기능군, 연결 관계, 왕복 보존 테스트
- `tests/validate-musicxml-schema.ps1` — 공식 MusicXML 4.0 XSD 검증기

### Modify

- `package.json` / `package-lock.json` — Vitest XML DOM 환경을 위한 `jsdom` 개발 의존성

## Task 1: Fixture 계약을 테스트로 고정

**Files:**
- Create: `tests/guitar-tab-fixture.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/guitar-tab-fixture.test.js`

- [ ] **Step 1: jsdom 테스트 환경을 설치한다**

Run:

```powershell
npm install -D jsdom
```

Expected: `package.json`의 `devDependencies`에 `jsdom`이 추가되고 lockfile이 갱신된다.

- [ ] **Step 2: 존재하지 않는 fixture를 읽는 테스트를 먼저 작성한다**

Create `tests/guitar-tab-fixture.test.js`:

```js
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const fixtureUrl = new URL('./fixtures/guitar-tab-all-specs.musicxml', import.meta.url);
const expectedRehearsals = [
  'META-LAYOUT', 'TAB-STANDARD', 'RHYTHM-DURATIONS', 'RHYTHM-GRACE-CUE',
  'RHYTHM-BEAMS', 'RHYTHM-TUPLETS', 'RHYTHM-VOICES', 'TECH-LEGATO',
  'TECH-SLIDES', 'TECH-BENDS', 'TECH-HARMONICS', 'TECH-HANDS',
  'TECH-ATTACKS', 'TECH-TREMOLO', 'EXPR-ARTICULATIONS', 'EXPR-DYNAMICS',
  'EXPR-DIRECTIONS', 'EXPR-ORNAMENTS', 'TEXT-LYRICS', 'HARMONY-CHORDS',
  'FLOW-REPEAT', 'FLOW-NAVIGATION', 'MEASURE-STYLES', 'TAB-DROP-D', 'FINAL'
];

function parseFixture() {
  const xml = readFileSync(fixtureUrl, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return { xml, doc };
}

function texts(doc, selector) {
  return [...doc.querySelectorAll(selector)].map((node) => node.textContent.trim());
}

describe('Guitar/TAB MusicXML 4.0 comprehensive fixture', () => {
  it('is a partwise 4.0 score with one two-staff guitar part', () => {
    const { doc } = parseFixture();
    expect(doc.documentElement.localName).toBe('score-partwise');
    expect(doc.documentElement.getAttribute('version')).toBe('4.0');
    expect(doc.querySelectorAll('part-list > score-part')).toHaveLength(1);
    expect(doc.querySelector('part[id="P1"]')).not.toBeNull();
    expect(texts(doc, 'attributes > staves')).toContain('2');
    expect(texts(doc, 'clef > sign')).toEqual(expect.arrayContaining(['G', 'TAB']));
    expect(doc.querySelectorAll('staff-details[number="2"] staff-tuning')).toHaveLength(6);
  });

  it('exposes every feature section through stable rehearsal labels', () => {
    const { doc } = parseFixture();
    expect(texts(doc, 'direction-type > rehearsal')).toEqual(expectedRehearsals);
  });

  it('contains the required guitar, rhythm, expression, harmony, and flow nodes', () => {
    const { doc } = parseFixture();
    const selectors = [
      'technical > string', 'technical > fret', 'technical > hammer-on',
      'technical > pull-off', 'notations > slide', 'technical > bend',
      'technical > harmonic', 'technical > tap', 'technical > heel',
      'technical > toe', 'technical > fingernails', 'notations > tied',
      'notations > slur', 'notations > tuplet', 'time-modification',
      'note > beam', 'note > grace', 'note > cue', 'note > chord',
      'articulations > accent', 'ornaments > tremolo', 'ornaments > wavy-line',
      'direction-type > dynamics', 'direction-type > wedge',
      'direction-type > metronome', 'direction-type > octave-shift',
      'harmony > root', 'harmony > frame', 'barline > repeat',
      'barline > ending', 'measure-style > measure-repeat',
      'measure-style > beat-repeat', 'measure-style > slash',
      'measure-style > multiple-rest', 'sound[segno]', 'sound[coda]',
      'sound[dacapo]', 'sound[dalsegno]', 'sound[tocoda]', 'sound[fine]'
    ];
    for (const selector of selectors) {
      expect(doc.querySelector(selector), selector).not.toBeNull();
    }
  });

  it('pairs numbered start and stop relationships', () => {
    const { doc } = parseFixture();
    const pairs = [
      ['hammer-on[type="start"]', 'hammer-on[type="stop"]'],
      ['pull-off[type="start"]', 'pull-off[type="stop"]'],
      ['slide[type="start"]', 'slide[type="stop"]'],
      ['slur[type="start"]', 'slur[type="stop"]'],
      ['tuplet[type="start"]', 'tuplet[type="stop"]'],
      ['wavy-line[type="start"]', 'wavy-line[type="stop"]']
    ];
    for (const [startSelector, stopSelector] of pairs) {
      const starts = [...doc.querySelectorAll(startSelector)].map((node) => node.getAttribute('number') || '1');
      const stops = [...doc.querySelectorAll(stopSelector)].map((node) => node.getAttribute('number') || '1');
      expect(stops, `${startSelector} / ${stopSelector}`).toEqual(starts);
    }
  });

  it('preserves representative unsupported and layout nodes across XML serialization', () => {
    const { doc } = parseFixture();
    const serialized = new XMLSerializer().serializeToString(doc);
    const reparsed = new DOMParser().parseFromString(serialized, 'application/xml');
    expect(reparsed.querySelector('defaults > appearance')).not.toBeNull();
    expect(reparsed.querySelector('notehead-text')).not.toBeNull();
    expect(reparsed.querySelector('grouping')).not.toBeNull();
    expect(reparsed.querySelector('bookmark')).not.toBeNull();
  });
});
```

- [ ] **Step 3: focused test를 실행해 올바르게 실패하는지 확인한다**

Run:

```powershell
npx vitest run tests/guitar-tab-fixture.test.js
```

Expected: `ENOENT`로 FAIL하며 누락된 경로가 `tests/fixtures/guitar-tab-all-specs.musicxml`이다.

- [ ] **Step 4: 계약 테스트와 의존성만 커밋한다**

```powershell
git add package.json package-lock.json tests/guitar-tab-fixture.test.js
git commit -m "기타 TAB MusicXML fixture 계약 테스트 추가"
```

## Task 2: 종합 MusicXML fixture 작성

**Files:**
- Create: `tests/fixtures/guitar-tab-all-specs.musicxml`
- Test: `tests/guitar-tab-fixture.test.js`

- [ ] **Step 1: 문서 헤더와 공통 기타 파트를 작성한다**

파일은 아래 순서를 지킨다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-number>Fixture 1</work-number><work-title>Guitar TAB MusicXML 4.0 Comprehensive Fixture</work-title></work>
  <movement-number>1</movement-number>
  <movement-title>Feature Isolation Score</movement-title>
  <identification>
    <creator type="composer">OpenAI Test Fixture</creator>
    <creator type="arranger">Guitar TAB Editor</creator>
    <rights>CC0 test data</rights>
    <encoding><software>Guitar TAB Editor</software><supports element="accidental" type="yes"/></encoding>
    <miscellaneous><miscellaneous-field name="scope">Guitar and TAB relevant MusicXML 4.0 features</miscellaneous-field></miscellaneous>
  </identification>
  <defaults>
    <scaling><millimeters>7.0</millimeters><tenths>40</tenths></scaling>
    <page-layout><page-height>1683</page-height><page-width>1190</page-width></page-layout>
    <appearance><line-width type="staff">1</line-width><note-size type="grace">60</note-size></appearance>
    <music-font font-family="Bravura" font-size="20"/>
    <word-font font-family="serif" font-size="10"/>
  </defaults>
  <credit page="1"><credit-words justify="center" valign="top">Guitar/TAB MusicXML 4.0 Comprehensive Fixture</credit-words></credit>
  <part-list>
    <score-part id="P1">
      <part-name>Guitar</part-name><part-abbreviation>Gtr.</part-abbreviation>
      <score-instrument id="P1-I1"><instrument-name>Acoustic Guitar (nylon)</instrument-name></score-instrument>
      <midi-device id="P1-I1" port="1">Default</midi-device>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>25</midi-program><volume>80</volume><pan>0</pan></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <!-- Measures from the feature map below are inserted here. -->
  </part>
</score-partwise>
```

첫 마디의 `attributes`는 `divisions=8`, C key, 4/4, `staves=2`, staff 1 `G` clef with `clef-octave-change=-1`, staff 2 `TAB` clef, staff 2 `staff-lines=6`, standard tuning 여섯 개와 capo 2를 포함한다. 각 마디는 voice별 합계가 32 divisions가 되도록 음표 또는 `forward`로 채운다.

- [ ] **Step 2: rehearsal 순서와 기능 배치를 정확히 구현한다**

아래 표의 순서대로 최소 25개 구간을 작성한다. 각 구간의 첫 마디는 `<direction><direction-type><rehearsal>LABEL</rehearsal></direction-type></direction>`을 가진다.

| Label | Required MusicXML |
|---|---|
| `META-LAYOUT` | `print`, `system-layout`, `staff-layout`, `grouping`, `bookmark` |
| `TAB-STANDARD` | 2 staves, standard tuning, capo, string/fret |
| `RHYTHM-DURATIONS` | whole, half, quarter, eighth, 16th, 32nd, dot, double-dot, rest |
| `RHYTHM-GRACE-CUE` | grace, slash grace, cue |
| `RHYTHM-BEAMS` | begin/continue/end and forward/backward hook |
| `RHYTHM-TUPLETS` | paired 3:2 and 5:4 `time-modification` / `tuplet` |
| `RHYTHM-VOICES` | chord, backup, forward, voices 1/2, staffs 1/2 |
| `TECH-LEGATO` | paired tie/tied, slur, hammer-on, pull-off |
| `TECH-SLIDES` | paired slide and glissando |
| `TECH-BENDS` | bend-alter, pre-bend, release, with-bar |
| `TECH-HARMONICS` | natural, artificial, base-pitch, touching-pitch, sounding-pitch |
| `TECH-HANDS` | fingering, pluck, string, fret, tap, heel, toe, fingernails |
| `TECH-ATTACKS` | up-bow, down-bow, open-string, stopped, snap-pizzicato, arpeggiate, non-arpeggiate |
| `TECH-TREMOLO` | single/start/stop tremolo, paired wavy-line |
| `EXPR-ARTICULATIONS` | accent, strong-accent, staccato, tenuto, detached-legato, fermata |
| `EXPR-DYNAMICS` | `p`, `mf`, `ff`, crescendo and diminuendo wedge |
| `EXPR-DIRECTIONS` | metronome, words, octave-shift, bracket, dashes |
| `EXPR-ORNAMENTS` | trill-mark, turn, mordent, accidental-mark |
| `TEXT-LYRICS` | begin/middle/end/single syllabic, elision, extend |
| `HARMONY-CHORDS` | root/bass/kind/inversion/degree/frame/barre |
| `FLOW-REPEAT` | forward/backward repeat, times, endings 1 and 2 |
| `FLOW-NAVIGATION` | segno, coda, fine, dacapo, dalsegno, tocoda sound attributes |
| `MEASURE-STYLES` | measure-repeat, beat-repeat, slash, multiple-rest |
| `TAB-DROP-D` | staff 2 tuning change with line 1 changed from E2 to D2 |
| `FINAL` | final barline and fermata |

일반 TAB 음표는 다음 형태를 기준으로 pitch와 duration만 구간에 맞게 바꾼다.

```xml
<note>
  <pitch><step>E</step><octave>4</octave></pitch>
  <duration>8</duration><voice>1</voice><type>quarter</type><staff>2</staff>
  <notations><technical><string>1</string><fret>0</fret></technical></notations>
</note>
```

연결 요소는 동일 `number`의 start가 stop보다 먼저 나오게 한다. 한 연결 유형에 여러 쌍을 쓰지 않아 테스트의 배열 비교가 결정적이게 한다.

- [ ] **Step 3: 계약 테스트를 실행하고 XML 순서 및 누락을 고친다**

Run:

```powershell
npx vitest run tests/guitar-tab-fixture.test.js
```

Expected: 5 tests PASS. 실패한 selector가 있으면 해당 rehearsal 구간에 요소를 추가하고, `parsererror`이면 XSD content model 순서에 맞게 자식 순서를 수정한다.

- [ ] **Step 4: fixture 구현을 커밋한다**

```powershell
git add tests/fixtures/guitar-tab-all-specs.musicxml
git commit -m "기타 TAB MusicXML 종합 fixture 추가"
```

## Task 3: 공식 MusicXML 4.0 XSD 검증 추가

**Files:**
- Create: `tests/validate-musicxml-schema.ps1`
- Test: `tests/fixtures/guitar-tab-all-specs.musicxml`

- [ ] **Step 1: 공식 schema를 사용하는 검증 스크립트를 작성한다**

Create `tests/validate-musicxml-schema.ps1`:

```powershell
param(
  [string]$Fixture = (Join-Path $PSScriptRoot 'fixtures\guitar-tab-all-specs.musicxml')
)

$ErrorActionPreference = 'Stop'
$schemaDir = Join-Path ([System.IO.Path]::GetTempPath()) 'musicxml-4.0-schema'
[System.IO.Directory]::CreateDirectory($schemaDir) | Out-Null
$base = 'https://raw.githubusercontent.com/w3c/musicxml/v4.0/schema'

foreach ($name in @('musicxml.xsd', 'xlink.xsd', 'xml.xsd')) {
  Invoke-WebRequest -Uri "$base/$name" -OutFile (Join-Path $schemaDir $name) -UseBasicParsing
}

$musicXmlSchema = Join-Path $schemaDir 'musicxml.xsd'
$schemaText = [System.IO.File]::ReadAllText($musicXmlSchema)
$schemaText = $schemaText.Replace('http://www.musicxml.org/xsd/xml.xsd', 'xml.xsd')
$schemaText = $schemaText.Replace('http://www.musicxml.org/xsd/xlink.xsd', 'xlink.xsd')
[System.IO.File]::WriteAllText($musicXmlSchema, $schemaText)

$errors = [System.Collections.Generic.List[string]]::new()
$schemas = [System.Xml.Schema.XmlSchemaSet]::new()
$schemas.XmlResolver = [System.Xml.XmlUrlResolver]::new()
$schemas.Add($null, $musicXmlSchema) | Out-Null
$schemas.Compile()

$settings = [System.Xml.XmlReaderSettings]::new()
$settings.Schemas = $schemas
$settings.ValidationType = [System.Xml.ValidationType]::Schema
$settings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
$settings.add_ValidationEventHandler({
  param($sender, $eventArgs)
  $errors.Add($eventArgs.Message)
})

$reader = [System.Xml.XmlReader]::Create((Resolve-Path $Fixture), $settings)
try {
  while ($reader.Read()) { }
} finally {
  $reader.Dispose()
}

if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Host "MusicXML 4.0 XSD validation passed: $Fixture"
```

- [ ] **Step 2: XSD 검증을 실행하고 schema 위반을 하나씩 수정한다**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/validate-musicxml-schema.ps1
```

Expected: `MusicXML 4.0 XSD validation passed`와 exit code 0. 오류가 있으면 첫 오류부터 MusicXML 자식 순서, 필수 값, enum 또는 attribute 형식을 수정한 뒤 다시 실행한다.

- [ ] **Step 3: 검증기와 XSD 수정 사항을 커밋한다**

```powershell
git add tests/validate-musicxml-schema.ps1 tests/fixtures/guitar-tab-all-specs.musicxml
git commit -m "MusicXML fixture XSD 검증 추가"
```

## Task 4: 전체 회귀 검증과 문서 일치 확인

**Files:**
- Verify: `tests/fixtures/guitar-tab-all-specs.musicxml`
- Verify: `tests/guitar-tab-fixture.test.js`
- Verify: `tests/validate-musicxml-schema.ps1`
- Verify: `docs/superpowers/specs/2026-10-08-guitar-tab-all-specs-fixture-design.md`

- [ ] **Step 1: fixture의 rehearsal 계약을 다시 확인한다**

Run:

```powershell
npx vitest run tests/guitar-tab-fixture.test.js
```

Expected: 5 tests PASS.

- [ ] **Step 2: 공식 XSD 검증을 새로 실행한다**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/validate-musicxml-schema.ps1
```

Expected: validation passed, exit code 0.

- [ ] **Step 3: 저장소 전체 테스트와 빌드를 실행한다**

Run:

```powershell
npm test
npm run build
```

Expected: 전체 Vitest suite PASS, Vite build exit code 0.

- [ ] **Step 4: 설계 범위와 실제 rehearsal 구간을 대조한다**

다음 명령 결과가 25개의 고유 label을 한 번씩 보여야 한다.

```powershell
Select-String -Path tests/fixtures/guitar-tab-all-specs.musicxml -Pattern '<rehearsal>([^<]+)</rehearsal>' | ForEach-Object { $_.Matches.Groups[1].Value }
```

Expected: `META-LAYOUT`에서 `FINAL`까지 테스트의 `expectedRehearsals`와 같은 순서로 25줄.

- [ ] **Step 5: 검증 후 남은 변경을 커밋한다**

검증 과정에서 파일이 바뀐 경우에만 실행한다.

```powershell
git add tests/fixtures/guitar-tab-all-specs.musicxml tests/guitar-tab-fixture.test.js tests/validate-musicxml-schema.ps1 package.json package-lock.json
git commit -m "기타 TAB MusicXML fixture 검증 보완"
```
