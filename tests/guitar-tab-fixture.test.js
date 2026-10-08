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

describe('Guitar/TAB MusicXML 4.0 comprehensive fixture', () => {
  it('is a partwise 4.0 score with one two-staff guitar part', () => {
    const { doc } = parseFixture();
    expect(doc.documentElement.localName).toBe('score-partwise');
    expect(doc.documentElement.getAttribute('version')).toBe('4.0');
    expect(doc.querySelectorAll('part-list > score-part')).toHaveLength(1);
    expect(doc.querySelector('part[id="P1"]')).not.toBeNull();
    expect(texts(doc, 'attributes > staves')).toContain('2');
    expect(texts(doc, 'clef > sign')).toEqual(expect.arrayContaining(['G', 'TAB']));
    const initialTab = [...doc.querySelectorAll('staff-details[number="2"]')]
      .find((node) => node.querySelector('capo'));
    expect(initialTab).not.toBeUndefined();
    expect(initialTab.querySelectorAll('staff-tuning')).toHaveLength(6);
    const dropD = [...doc.querySelectorAll('staff-details[number="2"]')]
      .find((node) => node.querySelector('staff-tuning[line="6"] > tuning-step')?.textContent.trim() === 'D');
    expect(dropD).not.toBeUndefined();
    expect(dropD.querySelector('staff-tuning[line="6"] > tuning-octave')?.textContent.trim()).toBe('2');
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
      const startNodes = [...doc.querySelectorAll(startSelector)];
      const stopNodes = [...doc.querySelectorAll(stopSelector)];
      expect(startNodes.length, `${startSelector} must have a start`).toBeGreaterThan(0);
      const starts = startNodes.map((node) => node.getAttribute('number') || '1');
      const stops = stopNodes.map((node) => node.getAttribute('number') || '1');
      expect(stops, `${startSelector} / ${stopSelector}`).toEqual(starts);
      if (stopNodes.length !== startNodes.length) continue;
      for (const [index, startNode] of startNodes.entries()) {
        expect(
          Boolean(startNode.compareDocumentPosition(stopNodes[index]) & Node.DOCUMENT_POSITION_FOLLOWING),
          `${startSelector} / ${stopSelector} pair ${index + 1} order`
        ).toBe(true);
      }
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
