import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const CONTAINER_PATH = 'META-INF/container.xml';
const MXL_MIME_TYPE = 'application/vnd.recordare.musicxml';
const MUSICXML_MIME_TYPE = 'application/vnd.recordare.musicxml+xml';

function assertSafeRootPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0')) {
    throw new Error('Invalid MXL root path');
  }

  const segments = path.split('/');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid MXL root path');
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

  const rootfile = Array.from(root.getElementsByTagName('*'))
    .find((element) => element.localName === 'rootfile');
  const path = rootfile?.getAttribute('full-path');
  if (!path) throw new Error('MXL container is missing a rootfile path');

  assertSafeRootPath(path);
  return path;
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
  let entries;
  try {
    const archiveBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    entries = unzipSync(archiveBytes);
  } catch (error) {
    throw new Error('Invalid MXL archive', { cause: error });
  }

  const container = entries[CONTAINER_PATH];
  if (!container) throw new Error('MXL archive is missing META-INF/container.xml');

  const path = parseRootPath(strFromU8(container));
  const score = entries[path];
  if (!score) throw new Error(`MXL archive is missing root score: ${path}`);

  return {
    path,
    xml: strFromU8(score)
  };
}
