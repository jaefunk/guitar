import { Inflate, strToU8, zipSync } from 'fflate';

const CONTAINER_PATH = 'META-INF/container.xml';
const MXL_MIME_TYPE = 'application/vnd.recordare.musicxml';
const MUSICXML_MIME_TYPE = 'application/vnd.recordare.musicxml+xml';
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_COUNT = 64;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 256 * 1024;
const MAX_ROOT_SCORE_BYTES = 8 * 1024 * 1024;
const INFLATE_INPUT_CHUNK_BYTES = 512;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

function assertSafeRootPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0')) {
    throw new Error('Invalid MXL root path');
  }

  const segments = path.split('/');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid MXL root path');
  }

  const normalized = path.normalize('NFC').toLowerCase();
  if (normalized === 'mimetype' || normalized === CONTAINER_PATH.toLowerCase()) {
    throw new Error('MXL root path is reserved for package metadata');
  }
}

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function containerXml(path) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${escapeAttribute(path)}" media-type="${MUSICXML_MIME_TYPE}"/>
  </rootfiles>
</container>`;
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`MXL ${label} is not valid UTF-8`, { cause: error });
  }
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function assertRange(bytes, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`Invalid MXL archive: truncated ${label}`);
  }
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readUint32(bytes, offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = readUint16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw new Error('Invalid MXL archive: missing ZIP central directory');
}

function parseZipDirectory(bytes) {
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDisk = readUint16(bytes, endOffset + 6);
  const diskEntryCount = readUint16(bytes, endOffset + 8);
  const entryCount = readUint16(bytes, endOffset + 10);
  const centralSize = readUint32(bytes, endOffset + 12);
  const centralOffset = readUint32(bytes, endOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || diskEntryCount !== entryCount
    || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('Invalid MXL archive: multi-disk and ZIP64 archives are unsupported');
  }
  if (entryCount > MAX_ENTRY_COUNT) {
    throw new Error(`Invalid MXL archive: entry count exceeds limit of ${MAX_ENTRY_COUNT}`);
  }
  assertRange(bytes, centralOffset, centralSize, 'central directory');
  if (centralOffset + centralSize !== endOffset) {
    throw new Error('Invalid MXL archive: inconsistent central directory size');
  }

  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assertRange(bytes, offset, 46, 'central directory entry');
    if (readUint32(bytes, offset) !== CENTRAL_FILE_SIGNATURE) {
      throw new Error('Invalid MXL archive: malformed central directory entry');
    }

    const flags = readUint16(bytes, offset + 8);
    const compression = readUint16(bytes, offset + 10);
    const crc = readUint32(bytes, offset + 16);
    const compressedSize = readUint32(bytes, offset + 20);
    const originalSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const diskStart = readUint16(bytes, offset + 34);
    const localOffset = readUint32(bytes, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    assertRange(bytes, offset, recordLength, 'central directory entry');

    const name = decodeUtf8(bytes.subarray(offset + 46, offset + 46 + nameLength), 'entry name');
    if (diskStart !== 0) {
      throw new Error('Invalid MXL archive: multi-disk entries are unsupported');
    }
    if (entries.has(name)) throw new Error(`Invalid MXL archive: duplicate entry ${name}`);
    if (flags & 1) throw new Error('Invalid MXL archive: encrypted entries are unsupported');
    if (originalSize > MAX_ENTRY_BYTES) {
      throw new Error(`Invalid MXL archive: entry size exceeds limit: ${name}`);
    }

    entries.set(name, {
      name,
      flags,
      compression,
      crc,
      compressedSize,
      originalSize,
      localOffset
    });
    offset += recordLength;
  }

  if (offset !== endOffset) {
    throw new Error('Invalid MXL archive: entry count does not match central directory');
  }
  return { entries, centralOffset };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc, bytes) {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function compressedEntryBytes(archiveBytes, directory, entry) {
  const offset = entry.localOffset;
  assertRange(archiveBytes, offset, 30, 'local file header');
  if (readUint32(archiveBytes, offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid MXL archive: missing local header for ${entry.name}`);
  }

  const localFlags = readUint16(archiveBytes, offset + 6);
  const localCompression = readUint16(archiveBytes, offset + 8);
  const localCrc = readUint32(archiveBytes, offset + 14);
  const localCompressedSize = readUint32(archiveBytes, offset + 18);
  const localOriginalSize = readUint32(archiveBytes, offset + 22);
  const nameLength = readUint16(archiveBytes, offset + 26);
  const extraLength = readUint16(archiveBytes, offset + 28);
  const headerLength = 30 + nameLength + extraLength;
  assertRange(archiveBytes, offset, headerLength, 'local file header');

  const localName = decodeUtf8(
    archiveBytes.subarray(offset + 30, offset + 30 + nameLength),
    'entry name'
  );
  if (localName !== entry.name || localFlags !== entry.flags
    || localCompression !== entry.compression) {
    throw new Error(`Invalid MXL archive: local header mismatch for ${entry.name}`);
  }
  if (!(entry.flags & 8) && (localCrc !== entry.crc
    || localCompressedSize !== entry.compressedSize
    || localOriginalSize !== entry.originalSize)) {
    throw new Error(`Invalid MXL archive: local metadata mismatch for ${entry.name}`);
  }

  const dataOffset = offset + headerLength;
  assertRange(archiveBytes, dataOffset, entry.compressedSize, `compressed data for ${entry.name}`);
  if (dataOffset + entry.compressedSize > directory.centralOffset) {
    throw new Error(`Invalid MXL archive: compressed data overlaps central directory for ${entry.name}`);
  }
  return archiveBytes.subarray(dataOffset, dataOffset + entry.compressedSize);
}

function extractEntry(archiveBytes, directory, entry, outputLimit, label) {
  if (!entry) return null;
  if (entry.originalSize > outputLimit) throw new Error(`MXL ${label} size exceeds limit`);

  const compressed = compressedEntryBytes(archiveBytes, directory, entry);
  const chunks = [];
  let actualSize = 0;
  let crc = 0xffffffff;
  const accept = (chunk) => {
    actualSize += chunk.byteLength;
    if (actualSize > outputLimit) {
      throw new Error(`MXL ${label} actual output size exceeds limit`);
    }
    crc = updateCrc32(crc, chunk);
    chunks.push(chunk);
  };

  if (entry.compression === 0) {
    for (let offset = 0; offset < compressed.byteLength; offset += INFLATE_INPUT_CHUNK_BYTES) {
      accept(compressed.subarray(offset, offset + INFLATE_INPUT_CHUNK_BYTES));
    }
  } else if (entry.compression === 8) {
    const inflate = new Inflate((chunk) => accept(chunk));
    if (!compressed.byteLength) inflate.push(new Uint8Array(), true);
    for (let offset = 0; offset < compressed.byteLength; offset += INFLATE_INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, compressed.byteLength);
      inflate.push(compressed.subarray(offset, end), end === compressed.byteLength);
    }
  } else {
    throw new Error(`Invalid MXL archive: unsupported compression method ${entry.compression}`);
  }

  const actualCrc = (crc ^ 0xffffffff) >>> 0;
  if (actualSize !== entry.originalSize) {
    throw new Error(`MXL ${label} declared size does not match actual output size`);
  }
  if (actualCrc !== entry.crc) throw new Error(`MXL ${label} CRC32 integrity check failed`);

  const output = new Uint8Array(actualSize);
  let outputOffset = 0;
  for (const chunk of chunks) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }
  return output;
}

function parseRootPath(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const parserError = root?.localName === 'parsererror'
    || doc.getElementsByTagNameNS(
      'http://www.mozilla.org/newlayout/xml/parsererror.xml',
      'parsererror'
    ).length > 0;

  if (parserError || root?.localName !== 'container') {
    throw new Error('Invalid MXL container XML');
  }

  const rootfiles = Array.from(root.children)
    .find((element) => element.localName === 'rootfiles');
  const rootfile = Array.from(rootfiles?.children || [])
    .find((element) => element.localName === 'rootfile');
  const path = rootfile?.getAttribute('full-path');
  if (!path) throw new Error('MXL container is missing a rootfile path');
  if (rootfile.hasAttribute('media-type')
    && rootfile.getAttribute('media-type') !== MUSICXML_MIME_TYPE) {
    throw new Error('MXL rootfile has an invalid media-type');
  }

  assertSafeRootPath(path);
  return path;
}

export function packMxl(xml, path = 'score.musicxml') {
  assertSafeRootPath(path);
  const scoreBytes = strToU8(xml);
  if (scoreBytes.byteLength > MAX_ROOT_SCORE_BYTES) {
    throw new Error('MXL root score size exceeds limit');
  }

  return zipSync({
    mimetype: [strToU8(MXL_MIME_TYPE), { level: 0 }],
    [CONTAINER_PATH]: strToU8(containerXml(path)),
    [path]: scoreBytes
  });
}

export function unpackMxl(bytes) {
  let archiveBytes;
  try {
    archiveBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } catch (error) {
    throw new Error('Invalid MXL archive', { cause: error });
  }
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`MXL archive size exceeds limit of ${MAX_ARCHIVE_BYTES} bytes`);
  }

  let directory;
  try {
    directory = parseZipDirectory(archiveBytes);
  } catch (error) {
    if (error.message.startsWith('Invalid MXL archive:')) throw error;
    throw new Error(`Invalid MXL archive: ${error.message}`, { cause: error });
  }

  const container = extractEntry(
    archiveBytes,
    directory,
    directory.entries.get(CONTAINER_PATH),
    MAX_CONTAINER_BYTES,
    'container'
  );
  if (!container) throw new Error('MXL archive is missing META-INF/container.xml');

  const path = parseRootPath(decodeUtf8(container, 'container'));
  const score = extractEntry(
    archiveBytes,
    directory,
    directory.entries.get(path),
    MAX_ROOT_SCORE_BYTES,
    'root score'
  );
  if (!score) throw new Error(`MXL archive is missing root score: ${path}`);

  return {
    path,
    xml: decodeUtf8(score, 'root score')
  };
}
