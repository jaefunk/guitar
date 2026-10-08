function childElements(element, name) {
  return Array.from(element?.children || []).filter((child) => child.localName === name);
}

function childElement(element, name) {
  return childElements(element, name)[0] || null;
}

function descendantElements(element, name) {
  if (!element) return [];
  return Array.from(element.getElementsByTagName('*')).filter((child) => child.localName === name);
}

function descendantElement(element, name) {
  return descendantElements(element, name)[0] || null;
}

function numberValue(rawValue) {
  const normalized = rawValue?.trim();
  if (!normalized) return null;

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function textNumber(element) {
  return numberValue(element?.textContent);
}

function partBody(doc, partId) {
  return childElements(doc.documentElement, 'part')
    .find((part) => part.getAttribute('id') === partId) || null;
}

export function parseMusicXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  const parserError = root?.localName === 'parsererror'
    || doc.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length > 0;

  if (parserError || root?.localName !== 'score-partwise' || root.getAttribute('version') !== '4.0') {
    throw new Error('Invalid MusicXML: expected a well-formed score-partwise 4.0 document');
  }

  return doc;
}

export function serializeMusicXml(doc) {
  const serialized = new XMLSerializer().serializeToString(doc)
    .replace(/^\s*<\?xml\s+[^?]*\?>\s*/i, '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

export function listTabParts(doc) {
  const partList = childElement(doc.documentElement, 'part-list');

  return childElements(partList, 'score-part').flatMap((scorePart) => {
    const id = scorePart.getAttribute('id');
    const body = partBody(doc, id);
    const tabClef = descendantElements(body, 'clef').find((clef) => (
      childElement(clef, 'sign')?.textContent?.trim() === 'TAB'
    ));

    if (!id || !tabClef) return [];

    return [{
      id,
      name: childElement(scorePart, 'part-name')?.textContent?.trim() || id,
      staff: tabClef.hasAttribute('number')
        ? numberValue(tabClef.getAttribute('number'))
        : 1
    }];
  });
}

export function readScoreMetadata(doc, partId) {
  const body = partBody(doc, partId);
  const sound = descendantElements(body, 'sound')
    .find((element) => element.hasAttribute('tempo'));
  const metronomeTempo = descendantElement(descendantElement(body, 'metronome'), 'per-minute');
  const time = descendantElement(body, 'time');

  return {
    tempo: sound ? numberValue(sound.getAttribute('tempo')) : textNumber(metronomeTempo),
    capo: textNumber(descendantElement(body, 'capo')),
    beats: textNumber(childElement(time, 'beats')),
    beatType: textNumber(childElement(time, 'beat-type'))
  };
}
