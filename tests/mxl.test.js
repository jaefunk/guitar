// @vitest-environment jsdom

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { packMxl, unpackMxl } from '../src/mxl.js';

const score = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list/></score-partwise>`;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 256 * 1024;
const MAX_ROOT_SCORE_BYTES = 8 * 1024 * 1024;

function archive(entries) {
  return zipSync(Object.fromEntries(
    Object.entries(entries).map(([path, text]) => [path, strToU8(text)])
  ));
}

function readUint32(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
  bytes[offset + 3] = value >>> 24;
}

function findCentralEntry(bytes, name) {
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (readUint32(bytes, offset) !== 0x02014b50) continue;
    const nameLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const entryName = strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (entryName === name) {
      return { centralOffset: offset, localOffset: readUint32(bytes, offset + 42) };
    }
  }
  throw new Error(`Central entry not found: ${name}`);
}

function forgeEntryMetadata(bytes, name, { originalSize, crc }) {
  const forged = bytes.slice();
  const { centralOffset, localOffset } = findCentralEntry(forged, name);
  if (originalSize !== undefined) {
    writeUint32(forged, centralOffset + 24, originalSize);
    writeUint32(forged, localOffset + 22, originalSize);
  }
  if (crc !== undefined) {
    writeUint32(forged, centralOffset + 16, crc);
    writeUint32(forged, localOffset + 14, crc);
  }
  return forged;
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

  it('writes only the mimetype, container, and root score with mimetype first and stored', () => {
    const bytes = packMxl(score);
    const fileNameLength = bytes[26] | (bytes[27] << 8);
    const extraLength = bytes[28] | (bytes[29] << 8);
    const compressedSize = readUint32(bytes, 18);
    const dataOffset = 30 + fileNameLength + extraLength;

    expect(strFromU8(bytes.subarray(30, 30 + fileNameLength))).toBe('mimetype');
    expect(bytes[8] | (bytes[9] << 8)).toBe(0);
    expect(extraLength).toBe(0);
    expect(strFromU8(bytes.subarray(dataOffset, dataOffset + compressedSize))).toBe(
      'application/vnd.recordare.musicxml'
    );
    expect(Object.keys(unzipSync(bytes))).toEqual([
      'mimetype',
      'META-INF/container.xml',
      'score.musicxml'
    ]);
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

  it.each([
    'mimetype',
    'MIMETYPE',
    'META-INF/container.xml',
    'meta-inf/container.xml',
    'META-INF/./container.xml'
  ])('rejects reserved package path %s', (path) => {
    expect(() => packMxl(score, path)).toThrow(/reserved|path/i);
  });

  it('rejects a root score whose UTF-8 representation exceeds the import limit', () => {
    expect(() => packMxl(' '.repeat(MAX_ROOT_SCORE_BYTES + 1))).toThrow(/size|large|limit/i);
  });
});

describe('MXL validation', () => {
  it('rejects a compressed archive larger than the input limit', () => {
    expect(() => unpackMxl(new Uint8Array(MAX_ARCHIVE_BYTES + 1))).toThrow(/size|large|limit/i);
  });

  it('rejects an archive with too many entries', () => {
    const entries = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`extra-${index}.txt`, ''])
    );
    entries['META-INF/container.xml'] = '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>';
    entries['score.musicxml'] = score;

    expect(() => unpackMxl(archive(entries))).toThrow(/entr|file|limit/i);
  });

  it('rejects an oversized container before parsing it', () => {
    const oversizedContainer = `<container>${' '.repeat(MAX_CONTAINER_BYTES)}</container>`;

    expect(() => unpackMxl(archive({
      'META-INF/container.xml': oversizedContainer,
      'score.musicxml': score
    }))).toThrow(/container.*size|size.*container|large/i);
  });

  it('rejects a highly compressed root score above the uncompressed size limit', () => {
    const oversizedScore = ' '.repeat(MAX_ROOT_SCORE_BYTES + 1);
    const bytes = archive({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
      'score.musicxml': oversizedScore
    });

    expect(bytes.byteLength).toBeLessThan(MAX_ROOT_SCORE_BYTES);
    expect(() => unpackMxl(bytes)).toThrow(/root.*size|size.*root|large/i);
  });

  it('counts actual inflated bytes when declared sizes are forged small', () => {
    const oversizedScore = ' '.repeat(MAX_ROOT_SCORE_BYTES + 1);
    const bytes = archive({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
      'score.musicxml': oversizedScore
    });
    const forged = forgeEntryMetadata(bytes, 'score.musicxml', { originalSize: 1 });

    expect(() => unpackMxl(forged)).toThrow(/actual|output|size|limit/i);
  });

  it('rejects a root score whose CRC32 metadata is forged', () => {
    const bytes = packMxl(score);
    const { centralOffset } = findCentralEntry(bytes, 'score.musicxml');
    const forgedCrc = readUint32(bytes, centralOffset + 16) ^ 0xffffffff;
    const forged = forgeEntryMetadata(bytes, 'score.musicxml', { crc: forgedCrc });

    expect(() => unpackMxl(forged)).toThrow(/crc|integrity/i);
  });

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

  it('rejects a rootfile outside the direct rootfiles child', () => {
    const bytes = archive({
      'META-INF/container.xml': '<container><metadata><rootfile full-path="score.musicxml"/></metadata><rootfiles/></container>',
      'score.musicxml': score
    });

    expect(() => unpackMxl(bytes)).toThrow(/rootfile/i);
  });

  it('uses only the first direct rootfile declaration', () => {
    const bytes = archive({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="missing.musicxml"/><rootfile full-path="score.musicxml"/></rootfiles></container>',
      'score.musicxml': score
    });

    expect(() => unpackMxl(bytes)).toThrow(/missing.*root score/i);
  });

  it('rejects a rootfile with a non-MusicXML media type', () => {
    const bytes = archive({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/pdf"/></rootfiles></container>',
      'score.musicxml': score
    });

    expect(() => unpackMxl(bytes)).toThrow(/media.?type/i);
  });

  it('allows an omitted rootfile media type for legacy MXL compatibility', () => {
    const bytes = archive({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
      'score.musicxml': score
    });

    expect(unpackMxl(bytes)).toEqual({ path: 'score.musicxml', xml: score });
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

  it('rejects a root score that is not valid UTF-8', () => {
    const invalidScore = new Uint8Array([
      ...strToU8('<score-partwise>'),
      0xc3,
      0x28,
      ...strToU8('</score-partwise>')
    ]);
    const bytes = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),
      'score.musicxml': invalidScore
    });

    expect(() => unpackMxl(bytes)).toThrow(/utf-8/i);
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
