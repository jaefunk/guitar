// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  listTabParts,
  parseMusicXml,
  readScoreMetadata,
  serializeMusicXml
} from '../src/musicxml.js';

const fixture = readFileSync('tests/fixtures/basic-tab.musicxml', 'utf8');

describe('MusicXML boundary', () => {
  it('parses a MusicXML 4.0 partwise score', () => {
    const doc = parseMusicXml(fixture);

    expect(doc.documentElement.localName).toBe('score-partwise');
    expect(doc.documentElement.getAttribute('version')).toBe('4.0');
  });

  it('lists parts whose own score body uses a TAB clef', () => {
    const doc = parseMusicXml(fixture);

    expect(listTabParts(doc)).toEqual([{ id: 'P1', name: 'Gt.1', staff: 1 }]);
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

  it('rejects malformed XML with a MusicXML error', () => {
    expect(() => parseMusicXml('<score-partwise>')).toThrow(/MusicXML/);
  });

  it('rejects XML that is not a partwise MusicXML score', () => {
    expect(() => parseMusicXml('<score-timewise version="4.0"/>')).toThrow(/MusicXML/);
  });
});
