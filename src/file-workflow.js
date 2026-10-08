import { listTabParts, parseMusicXml, serializeMusicXml } from './musicxml.js';
import { packMxl, unpackMxl } from './mxl.js';
import { buildScoreIndex } from './score-index.js';

const XML_MIME = 'application/vnd.recordare.musicxml+xml';
const MXL_MIME = 'application/vnd.recordare.musicxml';
const XML_MIMES = new Set([XML_MIME, 'application/xml', 'text/xml']);
const MXL_MIMES = new Set([MXL_MIME, 'application/zip', 'application/octet-stream']);

function extension(name = '') {
  return name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '';
}

function strictUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('MusicXML 파일이 올바른 UTF-8이 아닙니다', { cause: error });
  }
}

function fallbackTitle(filename) {
  const value = String(filename || '').replace(/\.(musicxml|xml|mxl)$/i, '').trim();
  return value || '제목 없음';
}

function documentTitle(doc) {
  const nodes = Array.from(doc.getElementsByTagName('*'));
  for (const name of ['work-title', 'movement-title']) {
    const value = nodes.find((node) => node.localName === name)?.textContent?.trim();
    if (value) return value;
  }
  return '';
}

export async function decodeMusicXmlFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('불러올 파일이 없습니다');
  const ext = extension(file.name);
  const mime = String(file.type || '').toLowerCase();
  const isMxl = ext === 'mxl' || (ext !== 'musicxml' && ext !== 'xml' && mime === MXL_MIME);
  const isXml = ext === 'musicxml' || ext === 'xml' || (ext !== 'mxl' && XML_MIMES.has(mime));
  if (!isMxl && !isXml) {
    if (MXL_MIMES.has(mime) && mime !== 'application/octet-stream') {
      throw new Error('MXL 파일은 .mxl 확장자가 필요합니다');
    }
    throw new Error('지원하는 파일 형식은 .musicxml, .xml, .mxl입니다');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isMxl) return { ...unpackMxl(bytes), format: 'mxl' };
  return { xml: strictUtf8(bytes), path: file.name, format: 'xml' };
}

export async function prepareMusicXmlImport(file) {
  const decoded = await decodeMusicXmlFile(file);
  const doc = parseMusicXml(decoded.xml);
  const parts = listTabParts(doc);
  if (!parts.length) throw new Error('MusicXML 문서에 TAB 파트가 없습니다');

  const candidates = parts.map((part) => {
    const index = buildScoreIndex(doc, part.id);
    return { ...part, diagnostics: index.diagnostics };
  });
  const fatal = candidates.flatMap((part) => part.diagnostics)
    .find((diagnostic) => diagnostic.severity === 'error');
  if (fatal) throw new Error(`MusicXML 구조 오류: ${fatal.message || fatal.code}`);

  return {
    xml: serializeMusicXml(doc),
    title: documentTitle(doc) || fallbackTitle(file.name),
    filename: file.name,
    parts: candidates
  };
}

export function createMusicXmlImportController({
  input, dialog, partsHost, status, confirm, cancel, commit,
  onImported = () => {}, onError = () => {}
}) {
  let staged = null;

  const reset = () => {
    staged = null;
    partsHost.replaceChildren();
    dialog.hidden = true;
    if (input) input.value = '';
  };

  const stage = async (file) => {
    staged = null;
    partsHost.replaceChildren();
    status.textContent = '';
    try {
      const prepared = await prepareMusicXmlImport(file);
      staged = prepared;
      for (const part of prepared.parts) {
        const label = document.createElement('label');
        label.className = 'musicxml-part-choice';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'musicxml-part';
        radio.value = part.id;
        const text = document.createElement('span');
        text.textContent = `${part.name} (${part.id})`;
        label.append(radio, text);
        partsHost.appendChild(label);
      }
      dialog.hidden = false;
      partsHost.querySelector('input')?.focus();
      return prepared;
    } catch (error) {
      status.textContent = error?.message || 'MusicXML 파일을 읽지 못했습니다';
      dialog.hidden = false;
      onError(error);
      return null;
    }
  };

  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) stage(file);
  });
  cancel.addEventListener('click', reset);
  confirm.addEventListener('click', () => {
    if (!staged) return;
    const selectedPartId = partsHost.querySelector('input[name="musicxml-part"]:checked')?.value;
    if (!selectedPartId) {
      status.textContent = '불러올 TAB 파트를 선택하세요';
      return;
    }
    try {
      const imported = commit({ ...staged, selectedPartId });
      reset();
      onImported(imported);
    } catch (error) {
      status.textContent = error?.message || 'MusicXML을 저장하지 못했습니다';
      onError(error);
    }
  });

  return { stage, cancel: reset, getStaged: () => staged };
}

export function sanitizeScoreFilename(title) {
  let name = String(title || '').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!name) return 'score';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `score-${name}`;
  return name.slice(0, 120) || 'score';
}

export function createMusicXmlDownload({
  xml, title, format = 'xml', documentRef = document, urlApi = URL,
  schedule = (callback) => setTimeout(callback, 0)
}) {
  const doc = parseMusicXml(xml);
  const serialized = serializeMusicXml(doc);
  const mxl = format === 'mxl';
  if (!mxl && format !== 'xml') throw new Error(`지원하지 않는 내보내기 형식: ${format}`);
  const blob = new Blob([mxl ? packMxl(serialized) : serialized], {
    type: mxl ? MXL_MIME : XML_MIME
  });
  const filename = `${sanitizeScoreFilename(title)}.${mxl ? 'mxl' : 'musicxml'}`;
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  try {
    documentRef.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove?.();
    schedule(() => urlApi.revokeObjectURL(url));
  }
  return { blob, filename, url };
}
