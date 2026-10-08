import { strToU8, unzipSync, zipSync } from 'fflate';

const CONTAINER_PATH = 'META-INF/container.xml';
const MXL_MIME_TYPE = 'application/vnd.recordare.musicxml';
const MUSICXML_MIME_TYPE = 'application/vnd.recordare.musicxml+xml';
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_COUNT = 64;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 256 * 1024;
const MAX_ROOT_SCORE_BYTES = 8 * 1024 * 1024;

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

function unzipSelected(archiveBytes, selectedPath, selectedLimit, label) {
  let entryCount = 0;
  let selected = false;

  try {
    return unzipSync(archiveBytes, {
      filter(entry) {
        entryCount += 1;
        if (entryCount > MAX_ENTRY_COUNT) {
          throw new Error(`MXL entry count exceeds limit of ${MAX_ENTRY_COUNT}`);
        }
        if (entry.originalSize > MAX_ENTRY_BYTES) {
          throw new Error(`MXL entry size exceeds limit: ${entry.name}`);
        }
        if (entry.name !== selectedPath) return false;
        if (selected) throw new Error(`MXL archive contains duplicate ${label}`);
        if (entry.originalSize > selectedLimit) {
          throw new Error(`MXL ${label} size exceeds limit`);
        }
        selected = true;
        return true;
      }
    });
  } catch (error) {
    throw new Error(`Invalid MXL archive: ${error.message}`, { cause: error });
  }
}

export function packMxl(xml, path = 'score.musicxml') {
  assertSafeRootPath(path);

  return zipSync({
    mimetype: [strToU8(MXL_MIME_TYPE), { level: 0 }],
    [CONTAINER_PATH]: strToU8(containerXml(path)),
    [path]: strToU8(xml)
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

  const containerEntries = unzipSelected(
    archiveBytes,
    CONTAINER_PATH,
    MAX_CONTAINER_BYTES,
    'container'
  );
  const container = containerEntries[CONTAINER_PATH];
  if (!container) throw new Error('MXL archive is missing META-INF/container.xml');

  const path = parseRootPath(decodeUtf8(container, 'container'));
  const scoreEntries = unzipSelected(
    archiveBytes,
    path,
    MAX_ROOT_SCORE_BYTES,
    'root score'
  );
  const score = scoreEntries[path];
  if (!score) throw new Error(`MXL archive is missing root score: ${path}`);

  return {
    path,
    xml: decodeUtf8(score, 'root score')
  };
}
