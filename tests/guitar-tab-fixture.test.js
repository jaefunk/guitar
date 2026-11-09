// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixturePath = resolve('tests/fixtures/guitar-tab-all-specs.musicxml');
const expectedRehearsals = [
  'META-LAYOUT', 'TAB-STANDARD', 'RHYTHM-DURATIONS', 'RHYTHM-GRACE-CUE',
  'RHYTHM-BEAMS', 'RHYTHM-TUPLETS', 'RHYTHM-VOICES', 'TECH-LEGATO',
  'TECH-SLIDES', 'TECH-BENDS', 'TECH-HARMONICS', 'TECH-HANDS',
  'TECH-ATTACKS', 'TECH-TREMOLO', 'EXPR-ARTICULATIONS', 'EXPR-DYNAMICS',
  'EXPR-DIRECTIONS', 'EXPR-ORNAMENTS', 'TEXT-LYRICS', 'HARMONY-CHORDS',
  'FLOW-REPEAT', 'FLOW-NAVIGATION', 'MEASURE-STYLES', 'TAB-DROP-D', 'FINAL'
];

function parseFixture() {
  const xml = readFileSync(fixturePath, 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return { xml, doc };
}

function texts(doc, selector) {
  return [...doc.querySelectorAll(selector)].map((node) => node.textContent.trim());
}

function sectionMeasure(doc, label) {
  return [...doc.querySelectorAll('rehearsal')]
    .find((node) => node.textContent.trim() === label)?.closest('measure');
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// Work in quarter-note units so each duration uses the divisions active at that point.
// A voice may move between staves; staff changes do not create a new time cursor.
function auditMeasureDurations(doc) {
  let divisions;
  let capacity;
  const tolerance = 1e-8; // Triplet decimal rounding is much smaller than this.
  const noteValues = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 };
  return [...doc.querySelectorAll('part > measure')].map((measure) => {
    const label = `measure ${measure.getAttribute('number')}`;
    let cursor = 0;
    let maximum = 0;
    let previousNote;
    const voices = new Map();
    for (const element of measure.children) {
      if (element.localName === 'attributes') {
        const divisionNode = element.querySelector('divisions');
        if (divisionNode) divisions = Number(divisionNode.textContent);
        const time = element.querySelector('time');
        if (time) capacity = Number(time.querySelector('beats').textContent) * 4 / Number(time.querySelector('beat-type').textContent);
        check(divisions > 0 && capacity > 0, `${label}: missing divisions or meter`);
        continue;
      }
      if (!['note', 'backup', 'forward'].includes(element.localName)) continue;
      if (element.querySelector('grace')) {
        check(!element.querySelector('duration'), `${label}: grace must not advance time`);
        continue;
      }
      const duration = Number(element.querySelector('duration')?.textContent) / divisions;
      check(Number.isFinite(duration) && duration > 0, `${label}: invalid duration`);
      if (element.localName === 'backup') {
        cursor -= duration;
        previousNote = undefined;
        check(cursor >= -tolerance, `${label}: backup before measure start`);
        continue;
      }
      const voice = element.querySelector('voice')?.textContent.trim() || '1';
      const staff = element.querySelector('staff')?.textContent.trim() || '1';
      if (element.localName === 'note') {
        const type = element.querySelector('type')?.textContent.trim();
        if (type) {
          const dots = element.querySelectorAll('dot').length;
          const modification = element.querySelector('time-modification');
          const ratio = modification
            ? Number(modification.querySelector('normal-notes').textContent) / Number(modification.querySelector('actual-notes').textContent)
            : 1;
          const notated = noteValues[type] * (2 - 2 ** -dots) * ratio;
          check(Math.abs(duration - notated) < tolerance, `${label}, voice ${voice}: duration differs from notated value`);
        }
        if (element.querySelector('chord')) {
          check(previousNote?.voice === voice, `${label}: chord has no preceding note in its voice`);
          check(duration <= previousNote.duration + tolerance, `${label}: chord outlasts its base note`);
          voices.get(voice).staves.add(staff);
          continue;
        }
        previousNote = { voice, duration };
      } else {
        previousNote = undefined;
      }
      const lane = voices.get(voice) || { end: 0, staves: new Set() };
      check(Math.abs(cursor - lane.end) < tolerance, `${label}, voice ${voice}: gap or overlap (use rest or forward)`);
      cursor += duration;
      lane.end = cursor;
      lane.staves.add(staff);
      voices.set(voice, lane);
      maximum = Math.max(maximum, cursor);
      check(cursor <= capacity + tolerance, `${label}, voice ${voice}: exceeds active meter`);
    }
    const implicit = measure.getAttribute('implicit') === 'yes';
    check(maximum > 0 && voices.size > 0, `${label}: empty measure`);
    check(implicit ? maximum < capacity - tolerance : Math.abs(maximum - capacity) < tolerance,
      `${label}: ${implicit ? 'pickup must be shorter than' : 'duration must fill'} active meter`);
    check(Math.abs(cursor - maximum) < tolerance, `${label}: final cursor is not at measure end`);
    for (const [voice, lane] of voices) {
      check(Math.abs(lane.end - maximum) < tolerance, `${label}, voice ${voice}: incomplete voice`);
    }
    return { number: measure.getAttribute('number'), implicit, duration: maximum, capacity, divisions, voices };
  });
}

function noteIdentity(node, includePitch = false) {
  const note = node.closest('note');
  const voice = note.querySelector('voice')?.textContent.trim() || '1';
  const staff = note.querySelector('staff')?.textContent.trim() || '1';
  const pitch = includePitch ? ['step', 'alter', 'octave'].map((name) =>
    note.querySelector(`pitch > ${name}`)?.textContent.trim() || '0').join(':') : '';
  return `${voice}:${staff}:${pitch}`;
}

function auditRelationships(doc) {
  const numbered = (node) => node.getAttribute('number') || '1';
  const relationships = [
    ...['hammer-on', 'pull-off', 'slide', 'slur', 'tuplet', 'wavy-line', 'glissando'].map((selector) => ({ selector })),
    { selector: 'note > tie', key: (node) => noteIdentity(node, true) },
    { selector: 'notations > tied', key: (node) => `${numbered(node)}:${noteIdentity(node, true)}` },
    { selector: 'direction-type > wedge', starts: ['crescendo', 'diminuendo'] },
    { selector: 'direction-type > octave-shift', starts: ['up', 'down'] },
    { selector: 'direction-type > bracket' },
    { selector: 'direction-type > dashes' },
    { selector: 'ornaments > tremolo', key: (node) => noteIdentity(node) },
    { selector: 'barline > ending', stops: ['stop', 'discontinue'] },
    { selector: 'lyric > extend', key: (node) => `${numbered(node.closest('lyric'))}:${noteIdentity(node)}` },
    { selector: 'measure-style > measure-repeat' },
    { selector: 'measure-style > beat-repeat' },
    { selector: 'measure-style > slash' },
    { selector: 'frame-note > barre' }
  ];
  for (const { selector, starts = ['start'], stops = ['stop'], key = numbered } of relationships) {
    const open = new Map();
    let startCount = 0;
    for (const node of doc.querySelectorAll(selector)) {
      const type = node.getAttribute('type');
      const id = key(node);
      if (starts.includes(type)) {
        check(!open.has(id), `${selector}: duplicate start ${id}`);
        open.set(id, node);
        startCount++;
      } else if (stops.includes(type)) {
        check(open.has(id), `${selector}: stop ${id} without earlier matching start`);
        open.delete(id);
      }
    }
    check(startCount > 0, `${selector}: no start`);
    check(open.size === 0, `${selector}: unfinished relationship`);
  }
  // Playback ties and engraving ties must describe the same endpoints on each note.
  for (const note of doc.querySelectorAll('note')) {
    expect([...note.querySelectorAll('tie')].map((node) => node.getAttribute('type')))
      .toEqual([...note.querySelectorAll('notations > tied')].map((node) => node.getAttribute('type')));
  }
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
    const initialTab = doc.querySelector('measure > attributes > staff-details[number="2"]');
    expect(initialTab.closest('measure')).toBe(doc.querySelector('measure'));
    expect(initialTab.querySelector('capo').textContent).toBe('2');
    expect([...initialTab.querySelectorAll('staff-tuning')].map((node) => [
      node.getAttribute('line'), node.querySelector('tuning-step').textContent, node.querySelector('tuning-octave').textContent
    ])).toEqual([['1', 'E', '2'], ['2', 'A', '2'], ['3', 'D', '3'], ['4', 'G', '3'], ['5', 'B', '3'], ['6', 'E', '4']]);
    const dropD = [...doc.querySelectorAll('staff-details[number="2"]')]
      .find((node) => node.querySelector('staff-tuning[line="1"] > tuning-step')?.textContent.trim() === 'D');
    expect(dropD).not.toBeUndefined();
    expect(dropD.querySelector('staff-tuning[line="1"] > tuning-octave')?.textContent.trim()).toBe('2');
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

  it('pairs every connected relationship in order, including non-start/stop type names', () => {
    const { doc } = parseFixture();
    auditRelationships(doc);
  });

  it('contains a short implicit pickup and real, restored key/time/divisions changes', () => {
    const { doc } = parseFixture();
    const measures = [...doc.querySelectorAll('part > measure')];
    expect(measures.map((node) => Number(node.getAttribute('number')))).toEqual(measures.map((_, index) => index + 1));
    expect(measures[0].getAttribute('implicit')).toBe('yes');
    expect(doc.querySelectorAll('measure[implicit="yes"]')).toHaveLength(1);
    expect(texts(doc, 'attributes > divisions')).toEqual(['8', '16', '8']);
    expect(texts(doc, 'attributes > key > fifths')).toEqual(['0', '2', '0']);
    expect([...doc.querySelectorAll('attributes > time')].map((time) =>
      `${time.querySelector('beats').textContent}/${time.querySelector('beat-type').textContent}`)).toEqual(['4/4', '3/4', '4/4']);
    expect(auditMeasureDurations(doc)[0]).toMatchObject({ implicit: true, duration: 1, capacity: 4 });
  });

  it('balances every active voice against the active meter, including cross-staff and tuplets', () => {
    const { doc } = parseFixture();
    const timeline = auditMeasureDurations(doc);
    expect(timeline).toHaveLength(doc.querySelectorAll('part > measure').length);
    expect(timeline.some((measure) => measure.divisions === 16 && measure.duration === 3)).toBe(true);
    expect(timeline.some((measure) => measure.voices.size > 1)).toBe(true);
    expect(timeline.some((measure) => [...measure.voices.values()].some((voice) => voice.staves.size > 1))).toBe(true);
  });

  it('contains explicit page/system breaks and a valid color attribute', () => {
    const { doc } = parseFixture();
    for (const attribute of ['new-system', 'new-page']) {
      const breaks = [...doc.querySelectorAll(`print[${attribute}="yes"]`)];
      expect(breaks.length).toBeGreaterThan(0);
      expect(breaks.some((node) => node.closest('measure') !== doc.querySelector('measure'))).toBe(true);
    }
    expect(sectionMeasure(doc, 'META-LAYOUT').querySelector('rehearsal').getAttribute('color')).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/i);
  });

  it('covers chord families, degree operations, timed harmony, and distinct open/muted frame strings', () => {
    const { doc } = parseFixture();
    expect(texts(doc, 'harmony > kind')).toEqual(expect.arrayContaining(['major', 'minor', 'dominant', 'major-seventh', 'suspended-fourth']));
    const degrees = [...doc.querySelectorAll('harmony > degree')].map((node) => ({
      type: node.querySelector('degree-type').textContent,
      value: Number(node.querySelector('degree-value').textContent),
      alter: Number(node.querySelector('degree-alter').textContent)
    }));
    expect(degrees).toEqual(expect.arrayContaining([
      { type: 'add', value: 9, alter: 0 }, { type: 'alter', value: 5, alter: -1 }, { type: 'subtract', value: 5, alter: 0 }
    ]));
    const offset = doc.querySelector('harmony > offset');
    expect(Number(offset.textContent)).toBeGreaterThan(0);
    const harmonyMeasure = offset.closest('measure');
    expect(Number(harmonyMeasure.querySelector('note > duration').textContent)).toBe(Number(offset.textContent));
    expect(harmonyMeasure.querySelector('note > rest')).not.toBeNull();
    const mutedFrame = doc.querySelector('frame[unplayed="x"]');
    expect(mutedFrame).not.toBeNull();
    expect(mutedFrame.querySelector('frame-strings').textContent).toBe('6');
    expect(texts(mutedFrame, 'frame-note > string')).toEqual(['5', '4', '3', '2', '1']);
    expect(texts(mutedFrame, 'frame-note > fret')).toContain('0');
    expect(doc.querySelectorAll('frame-note > barre')).toHaveLength(2);
    expect(doc.querySelector('harmony > inversion').textContent).toBe('1');
    expect(doc.querySelector('harmony > bass > bass-step').textContent).toBe('E');
  });

  it('contains a beam that crosses staves without changing voice', () => {
    const { doc } = parseFixture();
    const measure = sectionMeasure(doc, 'RHYTHM-VOICES');
    const groups = new Map();
    const completed = [];
    for (const note of measure.querySelectorAll('note')) {
      const beam = note.querySelector('beam[number="1"]');
      if (!beam) continue;
      const voice = note.querySelector('voice').textContent;
      const type = beam.textContent.trim();
      if (type === 'begin') groups.set(voice, new Set());
      expect(groups.has(voice), 'beam must start before continuing across staves').toBe(true);
      groups.get(voice).add(note.querySelector('staff').textContent);
      if (type === 'end') {
        completed.push(groups.get(voice));
        groups.delete(voice);
      }
    }
    expect(groups.size).toBe(0);
    expect(completed.some((staves) => staves.has('1') && staves.has('2'))).toBe(true);
  });

  it('preserves enharmonic spelling, thumb, dead/ghost notes, and mute/ring instructions', () => {
    const { doc } = parseFixture();
    for (const [step, alter, accidental] of [['C', '1', 'sharp'], ['D', '-1', 'flat']]) {
      const note = [...doc.querySelectorAll('note')].find((node) =>
        node.querySelector('pitch > step')?.textContent === step && node.querySelector('pitch > alter')?.textContent === alter);
      expect(note, `${step}${alter} spelling`).not.toBeUndefined();
      expect(note.querySelector('pitch > octave').textContent).toBe('4');
      expect(note.querySelector('accidental').textContent).toBe(accidental);
    }
    expect(sectionMeasure(doc, 'TECH-HANDS').querySelector('technical > thumb-position')).not.toBeNull();
    const attacks = sectionMeasure(doc, 'TECH-ATTACKS');
    expect(texts(attacks, 'note > notehead')).toContain('x');
    expect(attacks.querySelector('notehead[parentheses="yes"]').textContent).toBe('normal');
    expect(texts(attacks, 'direction-type > words')).toEqual(expect.arrayContaining(['Palm mute', 'Let ring']));
    const bends = [...sectionMeasure(doc, 'TECH-BENDS').querySelectorAll('bend')];
    for (const technique of ['pre-bend', 'release']) {
      const matching = bends.filter((bend) => bend.querySelector(technique));
      expect(matching, technique).toHaveLength(1);
      expect(Number(matching[0].querySelector('bend-alter').textContent)).toBe(-2);
    }
    expect(Number(sectionMeasure(doc, 'TECH-BENDS').querySelector('bend-alter').textContent)).toBe(2);
  });

  it.each([
    ['an underfilled full measure', (doc) => sectionMeasure(doc, 'TAB-STANDARD').lastElementChild.remove()],
    ['a chord incorrectly advancing time', (doc) => doc.querySelector('note > chord').remove()],
    ['a backup moving before the start', (doc) => { doc.querySelector('backup > duration').textContent = '999'; }],
    ['a forward creating a voice gap', (doc) => { doc.querySelector('forward > duration').textContent = '4'; }],
    ['a changed divisions scale without changed durations', (doc) => { doc.querySelector('divisions').textContent = '16'; }],
    ['a grace note incorrectly consuming time', (doc) => {
      const duration = doc.createElement('duration');
      duration.textContent = '4';
      doc.querySelector('grace').parentElement.append(duration);
    }]
  ])('duration audit rejects %s', (_, mutate) => {
    const { doc } = parseFixture();
    mutate(doc);
    expect(() => auditMeasureDurations(doc)).toThrow();
  });

  it.each([
    ['a tie ending on a different pitch', (doc) => { doc.querySelector('tie[type="stop"]').closest('note').querySelector('step').textContent = 'F'; }],
    ['a wedge ending before its start', (doc) => {
      const stop = doc.querySelector('wedge[type="stop"]').closest('direction');
      stop.parentElement.prepend(stop);
    }],
    ['an unfinished lyric extension', (doc) => doc.querySelector('lyric > extend[type="stop"]').remove()]
  ])('relationship audit rejects %s', (_, mutate) => {
    const { doc } = parseFixture();
    mutate(doc);
    expect(() => auditRelationships(doc)).toThrow();
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
