// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  listTabParts,
  parseMusicXml,
  readScoreMetadata,
  serializeMusicXml
} from '../src/musicxml.js';

const moduleUrl = import.meta.url;
const fixture = readFileSync(new URL('./fixtures/basic-tab.musicxml', moduleUrl), 'utf8');

const multiPartScore = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
    <score-part id="P2"><part-name>Scoped TAB</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1">
    <attributes>
      <time><beats>3</beats><beat-type>8</beat-type></time>
      <clef number="1"><sign>G</sign><line>2</line></clef>
      <staff-details><capo>0</capo></staff-details>
    </attributes>
    <direction><sound tempo="120"/></direction>
  </measure></part>
  <part id="P2"><measure number="1">
    <attributes>
      <time><beats>6</beats><beat-type>8</beat-type></time>
      <clef number="2"><sign>TAB</sign><line>5</line></clef>
      <staff-details><capo>2</capo></staff-details>
    </attributes>
    <direction><sound tempo="72"/></direction>
  </measure></part>
</score-partwise>`;

describe('MusicXML boundary', () => {
  it('parses a MusicXML 4.0 partwise score', () => {
    const doc = parseMusicXml(fixture);

    expect(doc.documentElement.localName).toBe('score-partwise');
    expect(doc.documentElement.getAttribute('version')).toBe('4.0');
  });

  it('rejects partwise scores outside the MusicXML 4.0 boundary', () => {
    expect(() => parseMusicXml('<score-partwise/>')).toThrow(/MusicXML/);
    expect(() => parseMusicXml('<score-partwise version="3.1"/>')).toThrow(/MusicXML/);
  });

  it('lists parts whose own score body uses a TAB clef', () => {
    const doc = parseMusicXml(fixture);

    expect(listTabParts(doc)).toEqual([{ id: 'P1', name: 'Gt.1', staff: 1 }]);
  });

  it('keeps TAB discovery and metadata scoped to each part body', () => {
    const doc = parseMusicXml(multiPartScore);

    expect(listTabParts(doc)).toEqual([{ id: 'P2', name: 'Scoped TAB', staff: 2 }]);
    expect(readScoreMetadata(doc, 'P1')).toEqual({
      tempo: 120,
      capo: 0,
      beats: 3,
      beatType: 8
    });
    expect(readScoreMetadata(doc, 'P2')).toEqual({
      tempo: 72,
      capo: 2,
      beats: 6,
      beatType: 8
    });
  });

  it('reads tempo, capo, and time signature from the requested part', () => {
    const doc = parseMusicXml(fixture);

    expect(readScoreMetadata(doc, 'P1')).toMatchObject({
      tempo: 84,
      capo: 1,
      beats: 4,
      beatType: 4
    });
  });

  it('serializes the retained DOM as MusicXML 4.0 with an XML declaration', () => {
    const serialized = serializeMusicXml(parseMusicXml(fixture));

    expect(serialized).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(parseMusicXml(serialized).documentElement.getAttribute('version')).toBe('4.0');
  });

  it('serializes the whole document and emits exactly one XML declaration', () => {
    const source = '<?xml version="1.0"?><!--before--><?keep yes?><!DOCTYPE score-partwise SYSTEM "partwise.dtd"><score-partwise version="4.0"><part-list/></score-partwise>';
    const serialized = serializeMusicXml(parseMusicXml(source));

    expect(serialized.match(/<\?xml\b/g)).toHaveLength(1);
    expect(serialized).toContain('<!--before-->');
    expect(serialized).toContain('<?keep yes?>');
    expect(serialized).toContain('<!DOCTYPE score-partwise SYSTEM "partwise.dtd">');
  });

  it('normalizes empty and invalid numeric metadata to null', () => {
    const doc = parseMusicXml(`<score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>Gt.</part-name></score-part></part-list>
      <part id="P1"><measure number="1"><attributes>
        <time><beats>nope</beats><beat-type>Infinity</beat-type></time>
        <staff-details><capo> </capo></staff-details>
      </attributes><direction><sound tempo=""/></direction></measure></part>
    </score-partwise>`);

    expect(readScoreMetadata(doc, 'P1')).toEqual({
      tempo: null,
      capo: null,
      beats: null,
      beatType: null
    });
  });

  it('accepts namespaced extension elements named parsererror', () => {
    const doc = parseMusicXml('<score-partwise version="4.0" xmlns:ext="urn:example"><ext:parsererror>extension data</ext:parsererror></score-partwise>');

    expect(doc.documentElement.localName).toBe('score-partwise');
  });

  it('rejects malformed XML with a MusicXML error', () => {
    expect(() => parseMusicXml('<score-partwise>')).toThrow(/MusicXML/);
  });

  it('rejects XML that is not a partwise MusicXML score', () => {
    expect(() => parseMusicXml('<score-timewise version="4.0"/>')).toThrow(/MusicXML/);
  });
});
