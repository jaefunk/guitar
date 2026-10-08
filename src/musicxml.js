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

function textNumber(element) {
  const value = Number(element?.textContent?.trim());
  return Number.isFinite(value) ? value : null;
}

function partBody(doc, partId) {
  return childElements(doc.documentElement, 'part')
    .find((part) => part.getAttribute('id') === partId) || null;
}

export function parseMusicXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const parserError = descendantElement(doc, 'parsererror');

  if (parserError || doc.documentElement?.localName !== 'score-partwise') {
    throw new Error('Invalid MusicXML: expected a well-formed score-partwise document');
  }

  return doc;
}

export function serializeMusicXml(doc) {
  const root = new XMLSerializer().serializeToString(doc.documentElement);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${root}`;
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
      staff: Number(tabClef.getAttribute('number')) || 1
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
    tempo: sound ? Number(sound.getAttribute('tempo')) : textNumber(metronomeTempo),
    capo: textNumber(descendantElement(body, 'capo')),
    beats: textNumber(childElement(time, 'beats')),
    beatType: textNumber(childElement(time, 'beat-type'))
  };
}
