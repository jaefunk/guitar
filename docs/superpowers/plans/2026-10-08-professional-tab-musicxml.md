# Professional TAB and MusicXML 4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MusicXML 4.0을 저장 정본으로 사용하는 데스크톱 전문 TAB 편집기와 `1:03` Gt1 실제 77마디 샘플을 구현한다.

**Architecture:** MusicXML DOM이 영구 저장 정본이며 `ScoreIndex`는 선택 파트를 렌더링·편집·재생하기 위한 메모리 전용 투영이다. 기능을 MusicXML 기반, SVG 조판, 편집·재생, 악보 전사의 네 단계로 나누고 각 단계가 독립적으로 테스트되고 커밋되게 한다.

**Tech Stack:** Vanilla JavaScript ES modules, Vite 6, Vitest 3 with jsdom, Web Audio API, SVG, DOMParser/XMLSerializer, fflate, Playwright smoke tests

---

## File map

### Create

- `src/musicxml.js` — XML parse/serialize, part discovery, metadata and DOM mutation helpers
- `src/mxl.js` — compressed MusicXML container import/export
- `src/score-index.js` — measure timing, event grouping, techniques, diagnostics and playback order
- `src/v3-musicxml.js` — v3 grid to MusicXML 4.0 migration
- `src/score-layout.js` — pure TAB system and glyph geometry
- `src/score-render.js` — SVG DOM rendering and selection/highlight updates
- `src/score-edit.js` — command-based editing, Undo and Redo
- `src/score-ui.js` — desktop score workspace bindings and inspector
- `src/score-audio.js` — ScoreIndex to existing synth scheduling adapter
- `tests/fixtures/basic-tab.musicxml` — minimal guitar fixture
- `tests/fixtures/techniques.musicxml` — tuplets, techniques, repeats and endings fixture
- `tests/fixtures/multipart.musicxml` — vocal/Gt1/Gt2 preservation fixture
- `tests/musicxml.test.js`
- `tests/mxl.test.js`
- `tests/score-index.test.js`
- `tests/v3-musicxml.test.js`
- `tests/score-layout.test.js`
- `tests/score-edit.test.js`
- `tests/score-audio.test.js`
- `songs/nell-1-03-gt1.musicxml` — verified 77-measure transcription
- `tests/nell-score.test.js` — transcription acceptance checks

### Modify

- `package.json` / `package-lock.json` — add `fflate`
- `src/state.js` — MusicXML song persistence and v3 migration
- `src/audio.js` — expose low-level note scheduling hooks used by score playback
- `src/main.js` — mode switching and import/export entry points
- `index.html` — desktop score workspace, file picker and diagnostics UI
- `styles.css` — desktop layout, SVG TAB and print styles
- `tests/state.test.js` — migrated document and persistence tests
- `tests/e2e/smoke.mjs` — MusicXML workflow coverage
- `README.md` and `HANDOFF.md` — new architecture and usage

---

## Phase A — MusicXML foundation

### Task 1: Add MusicXML fixtures and parser boundary

**Files:**
- Create: `src/musicxml.js`
- Create: `tests/fixtures/basic-tab.musicxml`
- Create: `tests/musicxml.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the XML test environment**

Run: `npm install -D jsdom`

Expected: `jsdom` appears under `devDependencies`.

- [ ] **Step 2: Create a one-measure TAB fixture**

Use MusicXML 4.0 partwise XML with `P1`, TAB clef, six `staff-tuning` entries, `capo` 1, divisions 4, 4/4, tempo 84, and two notes on string 3 at frets 5 and 7.

- [ ] **Step 3: Write the failing parser test**

```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parseMusicXml, listTabParts, readScoreMetadata, serializeMusicXml } from '../src/musicxml.js';

const xml = fs.readFileSync(new URL('./fixtures/basic-tab.musicxml', import.meta.url), 'utf8');

describe('MusicXML boundary', () => {
  it('parses TAB part and metadata without replacing the document', () => {
    const doc = parseMusicXml(xml);
    expect(listTabParts(doc)).toEqual([{ id: 'P1', name: 'Gt.1', staff: 1 }]);
    expect(readScoreMetadata(doc, 'P1')).toMatchObject({ tempo: 84, capo: 1, beats: 4, beatType: 4 });
    expect(serializeMusicXml(doc)).toContain('version="4.0"');
  });

  it('rejects malformed XML', () => {
    expect(() => parseMusicXml('<score-partwise>')).toThrow(/MusicXML/);
  });
});
```

Add `// @vitest-environment jsdom` as the first line of the test file.

- [ ] **Step 4: Run the focused test and verify failure**

Run: `npx vitest run tests/musicxml.test.js`

Expected: FAIL because `src/musicxml.js` does not exist.

- [ ] **Step 5: Implement the minimal public API**

```js
export function parseMusicXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'score-partwise') {
    throw new Error('MusicXML 문서를 읽지 못했습니다');
  }
  return doc;
}

export function serializeMusicXml(doc) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(doc.documentElement);
}

export function listTabParts(doc) {
  return [...doc.querySelectorAll('score-part')].flatMap((part) => {
    const id = part.getAttribute('id');
    const body = doc.querySelector(`part[id="${CSS.escape(id)}"]`);
    const clef = body?.querySelector('clef > sign');
    if (clef?.textContent.trim() !== 'TAB') return [];
    return [{ id, name: part.querySelector('part-name')?.textContent.trim() || id, staff: 1 }];
  });
}
```

Implement `readScoreMetadata` using scoped element helpers rather than global descendant queries.

- [ ] **Step 6: Run parser and existing tests**

Run: `npx vitest run tests/musicxml.test.js tests/tab.test.js tests/state.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/musicxml.js tests/musicxml.test.js tests/fixtures/basic-tab.musicxml
git commit -m "MusicXML TAB 파서 기반 추가"
```

### Task 2: Build ScoreIndex timing and chord grouping

**Files:**
- Create: `src/score-index.js`
- Create: `tests/score-index.test.js`

- [ ] **Step 1: Write tests for note, chord, rest, backup and forward**

```js
import { buildScoreIndex } from '../src/score-index.js';

it('uses MusicXML cursor rules and groups chord notes', () => {
  const index = buildScoreIndex(doc, 'P1');
  expect(index.measures[0].events.map((e) => [e.kind, e.onset, e.duration])).toEqual([
    ['notes', { n: 0, d: 1 }, { n: 1, d: 2 }],
    ['rest',  { n: 1, d: 2 }, { n: 1, d: 2 }]
  ]);
  expect(index.measures[0].events[0].notes).toHaveLength(2);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/score-index.test.js`

Expected: FAIL because `buildScoreIndex` is missing.

- [ ] **Step 3: Implement rational helpers and cursor parsing**

```js
export function rational(n, d = 1) {
  const g = gcd(Math.abs(n), Math.abs(d));
  return { n: n / g * Math.sign(d || 1), d: Math.abs(d) / g };
}

export function addRational(a, b) {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function buildScoreIndex(doc, partId) {
  const part = findPart(doc, partId);
  const context = { divisions: 1, beats: 4, beatType: 4 };
  return { partId, measures: [...part.children].filter(isMeasure).map((m) => indexMeasure(m, context)) };
}
```

`indexMeasure` must apply MusicXML cursor semantics: normal notes advance, `<chord/>` reuses the previous onset, `<backup>` subtracts duration, and `<forward>` adds duration.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/score-index.test.js`

Expected: PASS for cursor, chord and rest cases.

- [ ] **Step 5: Commit**

```bash
git add src/score-index.js tests/score-index.test.js
git commit -m "MusicXML 시간축 인덱스 추가"
```

### Task 3: Index techniques, tuplets, diagnostics and playback order

**Files:**
- Create: `tests/fixtures/techniques.musicxml`
- Modify: `src/score-index.js`
- Modify: `tests/score-index.test.js`

- [ ] **Step 1: Add a fixture containing hammer-on, pull-off, slide, half bend, dead note, tie, 3:2 tuplet, forward/backward repeats and endings 1/2**

Keep the fixture to six measures so every playback branch is visible in one assertion.

- [ ] **Step 2: Write failing semantic tests**

```js
it('links techniques and expands repeats with endings', () => {
  const index = buildScoreIndex(doc, 'P1');
  expect(index.links.map((l) => l.type)).toEqual(expect.arrayContaining(['hammer-on', 'pull-off', 'slide', 'tie']));
  expect(index.measures[2].events[0].notes[0].bend).toEqual({ n: 1, d: 2 });
  expect(index.measures[5].events.at(-1).fermata).toBe(true);
  expect(index.measures[1].events[0].tuplet).toMatchObject({ actual: 3, normal: 2 });
  expect(index.playbackMeasures).toEqual([0, 1, 2, 3, 0, 1, 2, 4, 5]);
});

it('reports invalid string, duration and unclosed links', () => {
  expect(index.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining([
    'INVALID_STRING', 'MEASURE_DURATION', 'UNCLOSED_TECHNIQUE'
  ]));
});
```

- [ ] **Step 3: Run and verify failure**

Run: `npx vitest run tests/score-index.test.js`

Expected: FAIL on missing links, tuplets, diagnostics and playback order.

- [ ] **Step 4: Implement notation readers and repeat expansion**

Add these stable shapes:

```js
// technique link
{ type, number, startEventId, endEventId }

// diagnostic
{ severity: 'error' | 'warning', code, measureNumber, eventId, message }

// tuplet
{ actual, normal }
```

Use a stack keyed by `type:number` for paired techniques. Read fermata as an event notation. Expand repeats from measure barlines without duplicating measure objects.

- [ ] **Step 5: Run all foundation tests**

Run: `npx vitest run tests/musicxml.test.js tests/score-index.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/score-index.js tests/score-index.test.js tests/fixtures/techniques.musicxml
git commit -m "TAB 주법과 반복 인덱싱 추가"
```

### Task 4: Add compressed MXL import and export

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/mxl.js`
- Create: `tests/mxl.test.js`

- [ ] **Step 1: Install the ZIP dependency**

Run: `npm install fflate`

Expected: `fflate` appears under `dependencies`, not `devDependencies`.

- [ ] **Step 2: Write failing round-trip test**

```js
import { packMxl, unpackMxl } from '../src/mxl.js';

it('round-trips MusicXML through a valid MXL container', () => {
  const bytes = packMxl(xml, 'score.musicxml');
  const unpacked = unpackMxl(bytes);
  expect(unpacked.path).toBe('score.musicxml');
  expect(unpacked.xml).toContain('<score-partwise');
});
```

- [ ] **Step 3: Run and verify failure**

Run: `npx vitest run tests/mxl.test.js`

Expected: FAIL because `src/mxl.js` is missing.

- [ ] **Step 4: Implement container handling**

```js
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export function unpackMxl(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const container = parseContainer(strFromU8(files['META-INF/container.xml']));
  if (!files[container]) throw new Error('MXL 루트 MusicXML이 없습니다');
  return { path: container, xml: strFromU8(files[container]) };
}

export function packMxl(xml, path = 'score.musicxml') {
  return zipSync({
    'META-INF/container.xml': strToU8(containerXml(path)),
    [path]: strToU8(xml)
  });
}
```

- [ ] **Step 5: Test valid and malformed containers**

Run: `npx vitest run tests/mxl.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/mxl.js tests/mxl.test.js
git commit -m "압축 MusicXML 입출력 추가"
```

### Task 5: Convert v3 songs and persist MusicXML songs

**Files:**
- Create: `src/v3-musicxml.js`
- Create: `tests/v3-musicxml.test.js`
- Modify: `src/state.js`
- Modify: `tests/state.test.js`

- [ ] **Step 1: Write migration tests before changing state**

```js
it('converts one v3 column to a MusicXML chord', () => {
  const xml = v3SongToMusicXml(v3Song);
  const index = buildScoreIndex(parseMusicXml(xml), 'P1');
  expect(index.measures[0].events[0].notes.map((n) => [n.string, n.fret])).toEqual([[1, 3], [2, 5]]);
});

it('keeps the legacy key after creating the v4 library', () => {
  load();
  expect(storage.getItem('gtab-editor-v3')).not.toBeNull();
  expect(Object.values(JSON.parse(storage.getItem('gtab-editor-v4')).songs)[0].musicxml).toContain('<score-partwise');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/v3-musicxml.test.js tests/state.test.js`

Expected: FAIL on missing converter and v4 key.

- [ ] **Step 3: Implement v3 MusicXML builder**

Generate MusicXML 4.0 with divisions 4, 4/4, TAB clef, standard tuning, one measure per legacy measure, and `<chord/>` for additional notes at the same slot. Map marks to `<direction><direction-type><words>` and known modifiers to `<notations>`.

- [ ] **Step 4: Update state boundary**

Add `KEY_V4 = 'gtab-editor-v4'` and persist:

```js
{ v: 4, songs: { [id]: { id, title, musicxml, selectedPartId, createdAt, updatedAt } }, order, currentId, settings }
```

Read v4 first; if absent, convert v3 without deleting v3.

- [ ] **Step 5: Run state and migration suites**

Run: `npx vitest run tests/v3-musicxml.test.js tests/state.test.js`

Expected: PASS, including old migration fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/v3-musicxml.js src/state.js tests/v3-musicxml.test.js tests/state.test.js
git commit -m "기존 곡을 MusicXML 저장 구조로 마이그레이션"
```

---

## Phase B — Professional SVG TAB

### Task 6: Implement pure score layout

**Files:**
- Create: `src/score-layout.js`
- Create: `tests/score-layout.test.js`

- [ ] **Step 1: Write geometry tests**

```js
it('allocates more width to rhythm-dense measures and wraps systems', () => {
  const layout = layoutScore(index, { width: 1120, staffGap: 12, minMeasureWidth: 180 });
  expect(layout.measures[1].width).toBeGreaterThan(layout.measures[0].width);
  expect(layout.systems.every((s) => s.width <= 1120)).toBe(true);
});

it('places fret labels and technique lanes without overlap', () => {
  const boxes = layoutScore(index, options).hitBoxes;
  expect(findOverlaps(boxes.filter((b) => b.kind === 'fret'))).toEqual([]);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/score-layout.test.js`

Expected: FAIL because layout functions do not exist.

- [ ] **Step 3: Implement deterministic layout records**

Return plain objects only:

```js
{ systems, measures, events, beams, tuplets, links, barlines, hitBoxes, totalHeight }
```

Measure width is `max(minMeasureWidth, leftPadding + rhythmicColumns * columnWidth + rightPadding)`. Technique links use stacked lanes above the TAB staff.

- [ ] **Step 4: Run layout tests**

Run: `npx vitest run tests/score-layout.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/score-layout.js tests/score-layout.test.js
git commit -m "전문 TAB 조판 계산 추가"
```

### Task 7: Render selectable SVG TAB and print layout

**Files:**
- Create: `src/score-render.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/main.js`

- [ ] **Step 1: Add a hidden score workspace and mode toggle to HTML**

Create `#scoreWorkspace`, `#scoreCanvas`, `#measureNav`, `#scoreInspector`, `#scoreDiagnostics`, and buttons with stable IDs `modeGrid` / `modeScore`.

- [ ] **Step 2: Implement SVG rendering from layout records**

```js
export function renderScoreSvg(host, index, options) {
  const layout = layoutScore(index, options);
  const svg = svgEl('svg', { viewBox: `0 0 ${options.width} ${layout.totalHeight}` });
  drawStaffLines(svg, layout);
  drawBarlines(svg, layout);
  drawFretLabels(svg, layout);
  drawRhythm(svg, layout);
  drawTechniques(svg, layout);
  host.replaceChildren(svg);
  return layout;
}
```

Every event group gets `data-event-id`; every measure gets `data-measure-number`.

- [ ] **Step 3: Add desktop and print CSS**

Use a four-region CSS grid at widths >= 1024px. Add `@media print` to hide controls and render the score at A4 content width.

- [ ] **Step 4: Bind mode switching without deleting the legacy grid**

`main.js` toggles `[hidden]` on legacy and score workspaces and persists `editorMode: 'grid' | 'score'` in settings.

- [ ] **Step 5: Run build and manually inspect the fixture**

Run: `npm test && npm run build && npm run dev`

Expected: all tests pass; score mode displays six TAB lines, fret labels, beams, tuplets and repeat barlines.

- [ ] **Step 6: Commit**

```bash
git add src/score-render.js src/main.js index.html styles.css
git commit -m "데스크톱 전문 TAB 화면 추가"
```

---

## Phase C — Editing, import/export and playback

### Task 8: Add command-based score editing and inspector

**Files:**
- Create: `src/score-edit.js`
- Create: `src/score-ui.js`
- Create: `tests/score-edit.test.js`
- Modify: `src/main.js`
- Modify: `index.html`

- [ ] **Step 1: Write command and history tests**

```js
it('changes fret and supports undo and redo', () => {
  const history = createHistory(() => {});
  history.execute(setFretCommand(doc, eventId, 9));
  expect(readFret(doc, eventId)).toBe(9);
  history.undo(); expect(readFret(doc, eventId)).toBe(7);
  history.redo(); expect(readFret(doc, eventId)).toBe(9);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/score-edit.test.js`

Expected: FAIL because command/history functions are missing.

- [ ] **Step 3: Implement commands as reversible XML mutations**

```js
export function createHistory(onChanged) {
  const undo = [], redo = [];
  return {
    execute(command) { command.apply(); undo.push(command); redo.length = 0; onChanged(command.measures); },
    undo() { const c = undo.pop(); if (c) { c.revert(); redo.push(c); onChanged(c.measures); } },
    redo() { const c = redo.pop(); if (c) { c.apply(); undo.push(c); onChanged(c.measures); } }
  };
}
```

Implement commands for fret/string, duration/dots/tuplet, rest/dead/ghost, insert/delete event, technique pair, repeats and endings.

- [ ] **Step 4: Bind score selection and inspector controls**

Use event delegation on `#scoreCanvas`; inspector controls dispatch commands and re-render only affected systems.

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run tests/score-edit.test.js && npm run build`

Expected: PASS and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/score-edit.js src/score-ui.js src/main.js index.html tests/score-edit.test.js
git commit -m "전문 TAB 편집과 Undo Redo 추가"
```

### Task 9: Add file import, diagnostics and XML/MXL export

**Files:**
- Modify: `src/score-ui.js`
- Modify: `src/main.js`
- Modify: `index.html`
- Create: `tests/fixtures/multipart.musicxml`
- Modify: `tests/musicxml.test.js`

- [ ] **Step 1: Add multipart preservation test**

```js
it('edits Gt1 while preserving vocal and Gt2 parts', () => {
  const doc = parseMusicXml(multipartXml);
  setFret(doc, 'P2', eventId, 9);
  const out = serializeMusicXml(doc);
  expect(out).toContain('<part id="P1">');
  expect(out).toContain('<part id="P3">');
  expect(parseMusicXml(out)).toBeTruthy();
});
```

- [ ] **Step 2: Add file picker and part-choice dialog**

Accept `.musicxml,.xml,.mxl`; detect extension; parse into a temporary document; show `listTabParts`; only add the song after the user selects a valid part.

- [ ] **Step 3: Render diagnostics grouped by measure**

Errors block import. Warnings open the document and populate `#scoreDiagnostics`; clicking one scrolls to its measure.

- [ ] **Step 4: Add XML and MXL downloads**

Use `serializeMusicXml` for XML and `packMxl` for MXL, create an object URL, click a temporary download anchor, then revoke the URL.

- [ ] **Step 5: Run round-trip and build checks**

Run: `npx vitest run tests/musicxml.test.js tests/mxl.test.js && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/score-ui.js src/main.js index.html tests/musicxml.test.js tests/fixtures/multipart.musicxml
git commit -m "MusicXML 파일 작업 흐름 추가"
```

### Task 10: Drive playback from ScoreIndex

**Files:**
- Create: `src/score-audio.js`
- Modify: `src/audio.js`
- Modify: `src/main.js`
- Create: `tests/score-audio.test.js`

- [ ] **Step 1: Write a pure scheduling-plan test**

```js
it('schedules expanded repeats and applies tie/rest gates', () => {
  const plan = buildPlaybackPlan(index, { bpm: 84 });
  expect(plan.measureNumbers).toEqual(index.playbackMeasures.map((i) => index.measures[i].number));
  expect(plan.events.find((e) => e.technique === 'bend').bendSemitones).toBe(0.5);
  expect(plan.events.find((e) => e.endsAtRest).gateSeconds).toBeLessThan(0.2);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run tests/score-audio.test.js`

Expected: FAIL because playback-plan functions are missing.

- [ ] **Step 3: Implement pure playback plan generation**

Produce absolute quarter positions, duration, MIDI, string, velocity and technique parameters without using AudioContext.

- [ ] **Step 4: Expose the existing synth voice boundary**

Export a small adapter from `audio.js` that schedules/stops a note voice; keep buffer synthesis and effects private.

- [ ] **Step 5: Implement look-ahead scheduling and SVG highlight**

Use the existing 0.25-second horizon and 70ms tick but consume the playback plan. Highlight by event ID rather than fixed slot number.

- [ ] **Step 6: Run audio and synth tests**

Run: `npx vitest run tests/score-audio.test.js tests/synth.test.js && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/score-audio.js src/audio.js src/main.js tests/score-audio.test.js
git commit -m "MusicXML 악보 재생 스케줄러 추가"
```

---

## Phase D — `1:03` transcription and release validation

### Task 11: Transcribe and validate the 77-measure Gt1 score

**Files:**
- Create: `songs/nell-1-03-gt1.musicxml`
- Create: `tests/nell-score.test.js`
- Modify: `src/songs.js`

- [ ] **Step 1: Create the MusicXML document header and measures 1–20**

Encode title `1:03`, part `Gt.1`, tempo 84, 4/4, capo 1 and six-string tuning. Enter only Gt1 from PDF pages 1–2.

- [ ] **Step 2: Add acceptance assertions before the remaining transcription**

```js
it('matches the fixed score metadata and structure', () => {
  const index = buildScoreIndex(doc, 'P1');
  expect(index.measures).toHaveLength(77);
  expect(readScoreMetadata(doc, 'P1')).toMatchObject({ tempo: 84, capo: 1, beats: 4, beatType: 4 });
  expect(index.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
});

it('contains the reference techniques and form', () => {
  expect(techniquesIn(21)).toEqual(expect.arrayContaining(['hammer-on', 'dead-note']));
  expect(techniquesIn(49)).toContain('slide');
  expect(techniquesIn(50)).toContain('bend');
  expect(techniquesIn(51)).toEqual(expect.arrayContaining(['pull-off', 'slide']));
  expect(measure(51).events.some((e) => e.tuplet?.actual === 3)).toBe(true);
  expect(index.playbackMeasures.length).toBeGreaterThan(77);
  expect(measure(77).events.some((e) => e.fermata)).toBe(true);
});
```

- [ ] **Step 3: Confirm the test fails only on incomplete transcription**

Run: `npx vitest run tests/nell-score.test.js`

Expected: FAIL because only measures 1–20 exist.

- [ ] **Step 4: Transcribe measures 21–48 and verify PDF pages 3–4**

Check every onset, fret, string, rest, dead note, hammer-on, repeat and first ending against the rendered PDF pages.

- [ ] **Step 5: Transcribe measures 49–77 and verify PDF pages 5–7**

Check bends, pull-offs, slides, tuplets, second endings, the repeat at measure 71 and the final fermata.

- [ ] **Step 6: Run semantic validation**

Run: `npx vitest run tests/nell-score.test.js tests/score-index.test.js`

Expected: PASS with 77 measures and zero error diagnostics.

- [ ] **Step 7: Add the score to the built-in song list**

Load the XML asset on explicit user action; do not copy the copyrighted score into every new localStorage document automatically.

- [ ] **Step 8: Commit**

```bash
git add songs/nell-1-03-gt1.musicxml src/songs.js tests/nell-score.test.js
git commit -m "1:03 Gt1 전문 TAB 샘플 추가"
```

### Task 12: Browser workflow, documentation and final verification

**Files:**
- Modify: `tests/e2e/smoke.mjs`
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Make Playwright reproducible**

Run: `npm install -D playwright && npx playwright install chromium`

Expected: `playwright` appears under `devDependencies` and the Chromium browser binary is installed.

- [ ] **Step 2: Extend the browser smoke test**

Add assertions that import `basic-tab.musicxml`, select Gt1, switch to professional TAB, edit fret 7 to 9, undo, redo, export XML, re-import it, and confirm the same event count.

- [ ] **Step 3: Document the desktop workflow and architecture**

Document supported MusicXML elements, unsupported notation warnings, XML/MXL import/export, score mode, quick grid limitations and the built-in Gt1 sample.

- [ ] **Step 4: Run the complete unit suite**

Run: `npm test`

Expected: all legacy and new tests pass.

- [ ] **Step 5: Run a clean production build**

Run: `npm run build`

Expected: Vite build succeeds with no missing assets or module errors.

- [ ] **Step 6: Run the browser smoke test**

Run one terminal with `npm run preview -- --host 127.0.0.1 --port 4173`, then run `node tests/e2e/smoke.mjs` in another.

Expected: every smoke check prints `ok` and exits 0.

- [ ] **Step 7: Perform visual verification**

Open score mode at 1440×900 and print preview. Inspect measures 21, 49, 50, 51, 71, 75 and 77 for fret-label, beam, tuplet, technique-link, ending and fermata collisions. Record each check in the work log.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tests/e2e/smoke.mjs README.md HANDOFF.md
git commit -m "전문 TAB 작업 흐름 검증과 문서화"
```

- [ ] **Step 9: Verify the final branch**

Run: `git status --short && git log --oneline --decorate -15`

Expected: clean worktree and one focused commit per completed task.
