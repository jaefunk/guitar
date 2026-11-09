// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { parseMusicXml } from '../src/musicxml.js';
import { buildScoreIndex } from '../src/score-index.js';
import { emptyMeasure } from '../src/tab.js';
import { TUNINGS } from '../src/constants.js';
import { isLosslessV3GridMusicXml, musicXmlToV3Song, v3SongToMusicXml } from '../src/v3-musicxml.js';

function songWith(measures, overrides = {}) {
  return {
    id: 'legacy-1',
    title: 'A & B <demo>',
    tuning: 'standard',
    bpm: 84,
    measures,
    marks: {},
    createdAt: 10,
    updatedAt: 20,
    ...overrides
  };
}

describe('v3 grid to MusicXML 4.0', () => {
  it('converts notes in one slot to a MusicXML chord', () => {
    const measure = emptyMeasure();
    measure[0][0] = '3';
    measure[1][0] = '5';

    const xml = v3SongToMusicXml(songWith([measure]));
    const doc = parseMusicXml(xml);
    const index = buildScoreIndex(doc, 'P1');

    expect(index.measures[0].events[0].notes.map((note) => [note.string, note.fret]))
      .toEqual([[1, 3], [2, 5]]);
    expect(doc.documentElement.getAttribute('version')).toBe('4.0');
    expect(doc.querySelector('divisions')?.textContent).toBe('4');
    expect(doc.querySelector('time')?.textContent.replace(/\s/g, '')).toBe('44');
    expect(doc.querySelector('clef sign')?.textContent).toBe('TAB');
    expect(doc.querySelectorAll('staff-tuning')).toHaveLength(6);
    expect([...doc.querySelectorAll('staff-tuning')].map((tuning) => ({
      line: Number(tuning.getAttribute('line')),
      step: tuning.querySelector('tuning-step')?.textContent,
      octave: Number(tuning.querySelector('tuning-octave')?.textContent)
    }))).toEqual([
      { line: 1, step: 'E', octave: 2 },
      { line: 2, step: 'A', octave: 2 },
      { line: 3, step: 'D', octave: 3 },
      { line: 4, step: 'G', octave: 3 },
      { line: 5, step: 'B', octave: 3 },
      { line: 6, step: 'E', octave: 4 }
    ]);
  });

  it('emits one complete measure per legacy measure and rests for empty slots', () => {
    const first = emptyMeasure();
    const second = emptyMeasure();
    first[2][8] = '7';

    const index = buildScoreIndex(parseMusicXml(v3SongToMusicXml(songWith([first, second]))), 'P1');

    expect(index.measures).toHaveLength(2);
    expect(index.measures[0].events).toHaveLength(16);
    expect(index.measures[0].events[0].kind).toBe('rest');
    expect(index.measures[0].events[8].notes[0]).toMatchObject({ string: 3, fret: 7 });
    expect(index.measures[1].events.every((event) => event.kind === 'rest')).toBe(true);
    expect(index.diagnostics.filter((diagnostic) => diagnostic.code === 'MEASURE_DURATION')).toEqual([]);
  });

  it('maps marks and known modifiers to MusicXML notation elements', () => {
    const measure = emptyMeasure();
    measure[0][0] = '3h';
    measure[0][1] = '5p';
    measure[0][2] = '3/';
    measure[0][3] = '7b';
    measure[1][4] = '8~';
    measure[2][5] = 'x';
    const xml = v3SongToMusicXml(songWith([measure], { marks: { '0:0': 'Verse & <loud>' } }));
    const doc = parseMusicXml(xml);

    expect(doc.querySelector('direction words')?.textContent).toBe('Verse & <loud>');
    expect(doc.querySelector('hammer-on[type="start"]')).not.toBeNull();
    expect(doc.querySelector('hammer-on[type="stop"]')).not.toBeNull();
    expect(doc.querySelector('pull-off[type="start"]')).not.toBeNull();
    expect(doc.querySelector('slide[type="start"]')).not.toBeNull();
    expect(doc.querySelector('bend bend-alter')?.textContent).toBe('1');
    expect([...doc.querySelectorAll('other-technical')].map((node) => node.textContent)).toContain('vibrato');
    expect(doc.querySelector('notehead')?.textContent).toBe('x');
  });

  it('escapes metadata and text while keeping valid MusicXML', () => {
    const xml = v3SongToMusicXml(songWith([emptyMeasure()], {
      title: 'Rock & Roll <"live">',
      marks: { '0:3': 'A&B < C' }
    }));
    const doc = parseMusicXml(xml);

    expect(doc.querySelector('work-title')?.textContent).toBe('Rock & Roll <"live">');
    expect(doc.querySelector('words')?.textContent).toBe('A&B < C');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
  });

  it('rejects malformed legacy measure data instead of emitting invalid XML', () => {
    expect(() => v3SongToMusicXml(songWith([]))).toThrow(/v3|measure/i);
    expect(() => v3SongToMusicXml(songWith([[['not-a-measure']]]))).toThrow(/v3|measure/i);
  });

  it('recognizes current and pre-marker app-generated XML as lossless grid documents', () => {
    const current = v3SongToMusicXml(songWith([emptyMeasure()]));
    const preMarker = current.replace(/<identification>[\s\S]*?<\/identification>/, '');

    expect(isLosslessV3GridMusicXml(current, 'P1')).toBe(true);
    expect(isLosslessV3GridMusicXml(preMarker, 'P1')).toBe(true);
  });

  it('rejects rich, extra-part, comment, and unknown-node XML from legacy grid promotion', () => {
    const current = v3SongToMusicXml(songWith([emptyMeasure()]));
    const rich = current.replace('<measure number="1">', '<measure number="1"><print new-system="yes"/>');
    const extraPart = current
      .replace('</part-list>', '<score-part id="P2"><part-name>Extra</part-name></score-part></part-list>')
      .replace('</score-partwise>', '<part id="P2"><measure number="1"/></part></score-partwise>');
    const comment = current.replace('<part-list>', '<!--keep--><part-list>');
    const unknown = current.replace('<part-list>', '<unknown-extension/><part-list>');

    expect(isLosslessV3GridMusicXml(rich, 'P1')).toBe(false);
    expect(isLosslessV3GridMusicXml(extraPart, 'P1')).toBe(false);
    expect(isLosslessV3GridMusicXml(comment, 'P1')).toBe(false);
    expect(isLosslessV3GridMusicXml(unknown, 'P1')).toBe(false);
  });

  it.each(Object.entries(TUNINGS))('round-trips the %s open-string tuning', (tuningId, tuning) => {
    const measure = emptyMeasure();
    for (let stringIndex = 0; stringIndex < 6; stringIndex += 1) measure[stringIndex][stringIndex] = '0';

    const xml = v3SongToMusicXml(songWith([measure], { tuning: tuningId }));
    const doc = parseMusicXml(xml);
    const staffMidi = [...doc.querySelectorAll('staff-tuning')].map((node) => {
      const step = node.querySelector('tuning-step')?.textContent;
      const alter = Number(node.querySelector('tuning-alter')?.textContent || 0);
      const octave = Number(node.querySelector('tuning-octave')?.textContent);
      const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + alter;
      return (octave + 1) * 12 + semitone;
    });
    const noteMidi = buildScoreIndex(doc, 'P1').measures[0].events
      .filter((event) => event.kind === 'notes')
      .map((event) => {
        const pitch = event.notes[0].pitch;
        return (pitch.octave + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch.step] + (pitch.alter || 0);
      });

    expect(staffMidi).toEqual(tuning.midi.slice().reverse());
    expect(noteMidi).toEqual(tuning.midi);
    expect(musicXmlToV3Song(xml, 'P1').tuning).toBe(tuningId);
  });

  it('round-trips modifiers on their original string within chords', () => {
    const measure = emptyMeasure();
    measure[0][0] = '3h';
    measure[1][0] = '5~';
    measure[2][0] = 'x';
    measure[0][1] = '5p';
    measure[0][2] = '3/';
    measure[0][3] = '7\\';
    measure[0][4] = '9b';
    measure[0][5] = '11';
    measure[0][6] = '6hb~';
    measure[1][6] = '8p/';
    measure[0][7] = '8';
    measure[1][7] = '10';

    const projected = musicXmlToV3Song(v3SongToMusicXml(songWith([measure])), 'P1');

    expect(projected.measures[0][0].slice(0, 6)).toEqual(['3h', '5p', '3/', '7\\', '9b', '11']);
    expect(projected.measures[0][1][0]).toBe('5~');
    expect(projected.measures[0][2][0]).toBe('x');
    expect(projected.measures[0][0][6]).toBe('6hb~');
    expect(projected.measures[0][1][6]).toBe('8p/');
  });

  it('projects directions and chord notes using divisions-aware cursor semantics', () => {
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>8</divisions><clef><sign>TAB</sign></clef></attributes>
        <note><rest/><duration>2</duration></note>
        <direction><direction-type><words>slot one</words></direction-type></direction>
        <forward><duration>2</duration></forward>
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><notations><technical><string>1</string><fret>3</fret></technical></notations></note>
        <note><chord/><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><notations><technical><string>2</string><fret>5</fret></technical></notations></note>
        <backup><duration>2</duration></backup>
        <attributes><divisions>4</divisions></attributes>
        <direction><direction-type><words>slot two</words></direction-type></direction>
      </measure></part>
    </score-partwise>`;

    const projected = musicXmlToV3Song(xml, 'P1');

    expect(projected.marks).toMatchObject({ '0:1': 'slot one', '0:2': 'slot two' });
    expect(projected.measures[0][0][2]).toBe('3');
    expect(projected.measures[0][1][2]).toBe('5');
  });

  it('rounds fractional 16th positions deterministically and clamps them to a measure', () => {
    const xml = `<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list>
      <part id="P1"><measure number="1">
        <attributes><divisions>8</divisions><clef><sign>TAB</sign></clef></attributes>
        <forward><duration>1</duration></forward>
        <direction><direction-type><words>half slot</words></direction-type></direction>
        <forward><duration>40</duration></forward>
        <direction><direction-type><words>outside</words></direction-type></direction>
      </measure></part>
    </score-partwise>`;

    expect(musicXmlToV3Song(xml, 'P1').marks).toEqual({
      '0:1': 'half slot',
      '0:15': 'outside'
    });
  });
});

describe('격자 확장 필드의 MusicXML 왕복 (박자표·팜뮤트·끊기·반복 기호)', () => {
  it('박자표가 <time>과 마디 칸 수로 저장되고 되돌아온다', () => {
    const measure = emptyMeasure(12);
    measure[0][11] = '5';
    const xml = v3SongToMusicXml(songWith([measure], { meter: '6/8' }));
    const doc = parseMusicXml(xml);
    expect(doc.querySelector('time beats')?.textContent).toBe('6');
    expect(doc.querySelector('time beat-type')?.textContent).toBe('8');
    const index = buildScoreIndex(doc, 'P1');
    expect(index.measures[0].events).toHaveLength(12);
    expect(index.diagnostics.filter((d) => d.code === 'MEASURE_DURATION')).toEqual([]);
    const back = musicXmlToV3Song(xml, 'P1');
    expect(back.meter).toBe('6/8');
    expect(back.measures[0][0].length).toBe(12);
    expect(back.measures[0][0][11]).toBe('5');
    expect(isLosslessV3GridMusicXml(xml, 'P1')).toBe(true);
  });
  it('칸 수가 박자표와 어긋나면 거부한다', () => {
    expect(() => v3SongToMusicXml(songWith([emptyMeasure(16)], { meter: '3/4' }))).toThrow(/slot/);
  });
  it('팜뮤트·끊기·반복 기호가 other-direction과 barline으로 왕복한다', () => {
    const a = emptyMeasure(), b = emptyMeasure(), c = emptyMeasure(), d = emptyMeasure();
    a[0][0] = '3'; a[0][4] = '.'; a[1][4] = '5'; b[2][0] = '7h'; b[2][2] = '9';
    const song = songWith([a, b, c, d], {
      pm: { '0:0': 1, '0:1': 1, '1:0': 1 },
      rep: { 0: { s: 1 }, 1: { v: 1, e: 3 }, 2: { v: 2 }, 3: { e: 2 } }
    });
    const xml = v3SongToMusicXml(song);
    const doc = parseMusicXml(xml);
    expect([...doc.querySelectorAll('other-direction')].map((n) => n.textContent)).toEqual(['gtab-pm', 'gtab-pm', 'gtab-stop:1', 'gtab-pm']);
    expect(doc.querySelector('measure[number="1"] barline[location="left"] repeat')?.getAttribute('direction')).toBe('forward');
    const m2 = doc.querySelector('measure[number="2"]');
    expect(m2.querySelector('barline[location="left"] ending')?.getAttribute('number')).toBe('1');
    expect(m2.querySelector('barline[location="right"] ending')?.getAttribute('type')).toBe('stop');
    expect(m2.querySelector('barline[location="right"] repeat')?.getAttribute('times')).toBe('3');
    expect(doc.querySelector('measure[number="3"] barline[location="right"] ending')?.getAttribute('type')).toBe('discontinue');
    expect(doc.querySelector('measure[number="4"] barline[location="right"] repeat')?.hasAttribute('times')).toBe(false);
    // 끊기 칸은 음표가 되지 않는다(쉼표 자리). 같은 칸의 다른 줄 음은 그대로.
    const index = buildScoreIndex(doc, 'P1');
    expect(index.measures[0].events[4].notes.map((n) => [n.string, n.fret])).toEqual([[2, 5]]);
    const back = musicXmlToV3Song(xml, 'P1');
    expect(back.pm).toEqual(song.pm);
    expect(back.rep).toEqual(song.rep);
    expect(back.measures[0][0][4]).toBe('.');
    expect(back.measures[0][1][4]).toBe('5');
    expect(back.measures[1][2][0]).toBe('7h');
    expect(isLosslessV3GridMusicXml(xml, 'P1')).toBe(true);
  });
  it('복수 괄호 번호(1,2)는 ending number="1,2"로 왕복한다', () => {
    const song = songWith([emptyMeasure(), emptyMeasure(), emptyMeasure()], { rep: { 1: { v: [1, 2], e: 3 }, 2: { v: 3 } } });
    const xml = v3SongToMusicXml(song);
    expect(xml).toContain('<ending number="1,2" type="start"/>');
    expect(musicXmlToV3Song(xml, 'P1').rep).toEqual(song.rep);
  });
  it('끊기 너머로는 해머온·슬라이드 짝을 잇지 않는다', () => {
    const m = emptyMeasure();
    m[0][0] = '3/'; m[0][1] = '.'; m[0][2] = '5';
    const doc = parseMusicXml(v3SongToMusicXml(songWith([m])));
    expect(doc.querySelector('slide[type="stop"]')).toBeNull();
  });
  it('새 필드가 없는 곡의 XML은 이전과 같다(기존 v4 문서 호환)', () => {
    const m = emptyMeasure(); m[0][0] = '3';
    const xml = v3SongToMusicXml(songWith([m]));
    expect(xml).not.toContain('other-direction');
    expect(xml).not.toContain('<barline');
    expect(xml).toContain('<time><beats>4</beats><beat-type>4</beat-type></time>');
  });
});
