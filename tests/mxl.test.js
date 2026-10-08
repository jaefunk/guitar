// @vitest-environment jsdom

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { packMxl, unpackMxl } from '../src/mxl.js';

const score = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list/></score-partwise>`;

function archive(entries) {
  return zipSync(Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, strToU8(text)])
  ));
}

describe('MXL packaging', () => {
  it('packs a MusicXML score with a container that points to the requested root file', () => {
    const bytes = packMxl(score, 'scores/guitar.musicxml');
    const entries = unzipSync(bytes);

    expect(strFromU8(entries['scores/guitar.musicxml'])).toBe(score);
    expect(strFromU8(entries['META-INF/container.xml'])).toContain(
      'full-path="scores/guitar.musicxml"'
    );
  });

  it('round-trips the default MusicXML root file', () => {
    expect(unpackMxl(packMxl(score))).toEqual({
      path: 'score.musicxml',
      xml: score
    });
  });

  it('round-trips an exact ArrayBuffer slice of the packed bytes', () => {
    const packed = packMxl(score, 'scores/guitar.musicxml');
    const buffer = packed.buffer.slice(
      packed.byteOffset,
      packed.byteOffset + packed.byteLength
    );

    expect(unpackMxl(buffer)).toEqual({
      path: 'scores/guitar.musicxml',
      xml: score
    });
  });
});

describe('MXL validation', () => {
  it('rejects an archive without META-INF/container.xml', () => {
    expect(() => unpackMxl(archive({ 'score.musicxml': score }))).toThrow(/container/i);
  });

  it('rejects malformed container XML', () => {
    expect(() => unpackMxl(archive({
      'META-INF/container.xml': '<container>'
    }))).toThrow(/container/i);
  });

  it('rejects a container without a rootfile declaration', () => {
    expect(() => unpackMxl(archive({
      'META-INF/container.xml': '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles/></container>'
    }))).toThrow(/rootfile/i);
  });

  it('reads a namespace-prefixed rootfile declaration by local name', () => {
    const bytes = archive({
      'META-INF/container.xml': '<c:container xmlns:c="urn:oasis:names:tc:opendocument:xmlns:container"><c:rootfiles><c:rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></c:rootfiles></c:container>',
      'score.musicxml': score
    });

    expect(unpackMxl(bytes)).toEqual({
      path: 'score.musicxml',
      xml: score
    });
  });

  it('rejects a rootfile declaration whose score entry is missing', () => {
    const bytes = archive({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="missing.musicxml"/></rootfiles></container>'
    });

    expect(() => unpackMxl(bytes)).toThrow(/root score/i);
  });

  it.each([
    '../score.musicxml',
    'scores/../../score.musicxml',
    '/score.musicxml',
    'C:/score.musicxml',
    'scores\\score.musicxml'
  ])('rejects unsafe root path %s while packing and unpacking', (path) => {
    expect(() => packMxl(score, path)).toThrow(/path/i);

    const bytes = archive({
      'META-INF/container.xml': `<container><rootfiles><rootfile full-path="${path}"/></rootfiles></container>`,
      [path]: score
    });
    expect(() => unpackMxl(bytes)).toThrow(/path/i);
  });
});
