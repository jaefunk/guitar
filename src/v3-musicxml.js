import { TUNINGS } from './constants.js';
import { emptyMeasure, parse, validMeasures } from './tab.js';
import { parseMusicXml, readScoreMetadata } from './musicxml.js';

const GRID_MARKER_NAME = 'gtab-editor-source';
const GRID_MARKER_VALUE = 'v3-grid-v1';

const PITCHES = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]
];

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pitchXml(midi) {
  const [step, alter] = PITCHES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
}

function modifierSet(value) {
  const parsed = parse(value);
  return { fret: parsed.num ? Number(parsed.num) : null, modifiers: new Set(parsed.mod.split('')) };
}

function pairedTechniqueStops(measures) {
  const stops = new Map();
  const nextOnString = Array(6).fill(null);
  for (let measureIndex = measures.length - 1; measureIndex >= 0; measureIndex -= 1) {
    const measure = measures[measureIndex];
    for (let slot = 15; slot >= 0; slot -= 1) {
      for (let stringIndex = 0; stringIndex < 6; stringIndex += 1) {
        const value = measure[stringIndex][slot];
        if (!value) continue;
        const { fret, modifiers } = modifierSet(value);
        const target = nextOnString[stringIndex];
        const starts = [
          modifiers.has('h') && 'hammer-on',
          modifiers.has('p') && 'pull-off',
          (modifiers.has('/') || modifiers.has('\\')) && 'slide'
        ].filter(Boolean);
        if (fret !== null && target) {
          for (const type of starts) {
            const key = `${target.measureIndex}:${target.slot}:${stringIndex}`;
            if (!stops.has(key)) stops.set(key, []);
            stops.get(key).push(type);
          }
        }
        if (fret !== null || modifiers.has('x')) nextOnString[stringIndex] = { measureIndex, slot };
      }
    }
  }
  return stops;
}

function notationXml(value, stringNumber, fret, stopTypes) {
  const { modifiers } = modifierSet(value);
  const direct = [];
  const technical = [`<string>${stringNumber}</string>`, `<fret>${fret}</fret>`];
  for (const type of stopTypes) {
    if (type === 'slide') direct.push('<slide type="stop" number="1"/>');
    else technical.push(`<${type} type="stop" number="1"/>`);
  }
  if (modifiers.has('h')) technical.push('<hammer-on type="start" number="1">H</hammer-on>');
  if (modifiers.has('p')) technical.push('<pull-off type="start" number="1">P</pull-off>');
  if (modifiers.has('/') || modifiers.has('\\')) {
    direct.push('<slide type="start" number="1"/>');
    technical.push(`<other-technical>${modifiers.has('\\') ? 'gtab-slide-down' : 'gtab-slide-up'}</other-technical>`);
  }
  if (modifiers.has('b')) technical.push('<bend><bend-alter>1</bend-alter></bend>');
  if (modifiers.has('~')) technical.push('<other-technical>vibrato</other-technical>');
  if (modifiers.has('x')) technical.push('<other-technical>dead</other-technical>');
  return `<notations>${direct.join('')}<technical>${technical.join('')}</technical></notations>`;
}

function noteXml(value, stringIndex, chord, stopTypes, tuningMidi) {
  const { fret: parsedFret, modifiers } = modifierSet(value);
  const dead = modifiers.has('x') && parsedFret === null;
  const fret = parsedFret ?? 0;
  const pitch = pitchXml(tuningMidi[stringIndex] + fret);
  return `<note>${chord ? '<chord/>' : ''}${pitch}<duration>1</duration><voice>1</voice><type>16th</type>` +
    `${dead ? '<notehead>x</notehead>' : ''}${notationXml(value, stringIndex + 1, fret, stopTypes)}</note>`;
}

function attributesXml(tuningMidi) {
  const tunings = tuningMidi.slice().reverse().map((midi, index) => {
    const [step, alter] = PITCHES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `<staff-tuning line="${index + 1}"><tuning-step>${step}</tuning-step>` +
      `${alter ? `<tuning-alter>${alter}</tuning-alter>` : ''}<tuning-octave>${octave}</tuning-octave></staff-tuning>`;
  }).join('');
  return `<attributes><divisions>4</divisions><key><fifths>0</fifths></key>` +
    '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef>' +
    `<staff-details><staff-lines>6</staff-lines>${tunings}</staff-details></attributes>`;
}

/** Convert the legacy 16-slot grid into a complete MusicXML 4.0 score. */
export function v3SongToMusicXml(song) {
  if (!song || !validMeasures(song.measures)) throw new Error('Invalid v3 song measures');
  const title = typeof song.title === 'string' ? song.title : '';
  const bpm = Number.isFinite(song.bpm) && song.bpm > 0 ? song.bpm : 90;
  const stops = pairedTechniqueStops(song.measures);
  const tuningId = TUNINGS[song.tuning] ? song.tuning : 'standard';
  const tuningMidi = TUNINGS[tuningId].midi;
  const measures = song.measures.map((measure, measureIndex) => {
    const body = [];
    if (measureIndex === 0) {
      body.push(attributesXml(tuningMidi));
      body.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`);
    }
    for (let slot = 0; slot < 16; slot += 1) {
      const mark = song.marks?.[`${measureIndex}:${slot}`];
      if (typeof mark === 'string' && mark) {
        body.push(`<direction placement="above"><direction-type><words>${escapeXml(mark)}</words></direction-type></direction>`);
      }
      const notes = [];
      for (let stringIndex = 0; stringIndex < 6; stringIndex += 1) {
        const value = measure[stringIndex][slot];
        if (!value) continue;
        const key = `${measureIndex}:${slot}:${stringIndex}`;
        notes.push(noteXml(value, stringIndex, notes.length > 0, stops.get(key) || [], tuningMidi));
      }
      body.push(notes.length ? notes.join('') : '<note><rest/><duration>1</duration><voice>1</voice><type>16th</type></note>');
    }
    return `<measure number="${measureIndex + 1}">${body.join('')}</measure>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<score-partwise version="4.0">' +
    `<work><work-title>${escapeXml(title)}</work-title></work>` +
    `<identification><miscellaneous><miscellaneous-field name="${GRID_MARKER_NAME}">${GRID_MARKER_VALUE}</miscellaneous-field></miscellaneous></identification>` +
    '<part-list><score-part id="P1"><part-name>Guitar</part-name><part-abbreviation>Gt.</part-abbreviation></score-part></part-list>' +
    `<part id="P1">${measures}</part></score-partwise>`;
}

function localChildren(element, name) {
  return [...element.children].filter((child) => child.localName === name);
}

function localChild(element, name) {
  return localChildren(element, name)[0] || null;
}

function hasLegacyGridMarker(doc) {
  const identification = localChild(doc.documentElement, 'identification');
  const miscellaneous = identification && localChild(identification, 'miscellaneous');
  return !!miscellaneous && localChildren(miscellaneous, 'miscellaneous-field').some((field) =>
    field.getAttribute('name') === GRID_MARKER_NAME && field.textContent?.trim() === GRID_MARKER_VALUE);
}

function canonicalNode(node) {
  if (node.nodeType === 1) {
    const name = `${node.namespaceURI || ''}|${node.localName}`;
    const attributes = [...node.attributes]
      .map((attribute) => `${attribute.namespaceURI || ''}|${attribute.localName}=${JSON.stringify(attribute.value)}`)
      .sort()
      .join(';');
    const children = [...node.childNodes]
      .map(canonicalNode)
      .filter((value) => value !== '')
      .join('');
    return `<${name} ${attributes}>${children}</${name}>`;
  }
  if (node.nodeType === 3) return node.data.trim() ? `#text:${JSON.stringify(node.data)}` : '';
  if (node.nodeType === 4) return `#cdata:${JSON.stringify(node.data)}`;
  if (node.nodeType === 8) return `#comment:${JSON.stringify(node.data)}`;
  if (node.nodeType === 7) return `#pi:${node.target}:${JSON.stringify(node.data)}`;
  return `#node:${node.nodeType}`;
}

function finiteTextNumber(element) {
  if (!element) return null;
  const value = Number(element.textContent?.trim());
  return Number.isFinite(value) ? value : null;
}

function slotAt(quarterPosition) {
  return Math.max(0, Math.min(15, Math.round(quarterPosition * 4)));
}

function tuningMidiFromPart(part) {
  const byLine = new Map();
  for (const tuning of part.querySelectorAll('staff-tuning')) {
    const line = Number(tuning.getAttribute('line'));
    const step = localChild(tuning, 'tuning-step')?.textContent?.trim();
    const alter = finiteTextNumber(localChild(tuning, 'tuning-alter')) || 0;
    const octave = finiteTextNumber(localChild(tuning, 'tuning-octave'));
    const pitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step];
    if (Number.isInteger(line) && pitchClass !== undefined && octave !== null) {
      byLine.set(line, (octave + 1) * 12 + pitchClass + alter);
    }
  }
  if (byLine.size !== 6) return null;
  return [6, 5, 4, 3, 2, 1].map((line) => byLine.get(line));
}

function tuningIdFromPart(part) {
  const midi = tuningMidiFromPart(part);
  if (!midi || midi.some((value) => !Number.isFinite(value))) return 'standard';
  return Object.keys(TUNINGS).find((id) => TUNINGS[id].midi.every((value, index) => value === midi[index])) || 'standard';
}

function noteModifier(note) {
  const technicalTexts = [...note.querySelectorAll('other-technical')]
    .map((element) => element.textContent?.trim().toLowerCase());
  if (localChild(note, 'notehead')?.textContent?.trim().toLowerCase() === 'x' || technicalTexts.includes('dead')) return 'x';
  const modifiers = [];
  if (note.querySelector('hammer-on[type="start"]')) modifiers.push('h');
  if (note.querySelector('pull-off[type="start"]')) modifiers.push('p');
  if (note.querySelector('bend > bend-alter')) modifiers.push('b');
  if (note.querySelector('slide[type="start"]')) {
    modifiers.push(technicalTexts.includes('gtab-slide-down') ? '\\' : '/');
  }
  if (technicalTexts.includes('vibrato')) modifiers.push('~');
  return modifiers.join('');
}

/** Best-effort projection used only by the legacy quick-entry grid. */
export function musicXmlToV3Song(xml, selectedPartId = 'P1') {
  const doc = parseMusicXml(xml);
  const part = [...doc.documentElement.children].find((node) => node.localName === 'part' && node.getAttribute('id') === selectedPartId);
  if (!part) throw new Error(`MusicXML part not found: ${selectedPartId}`);
  const measureElements = localChildren(part, 'measure');
  if (!measureElements.length) throw new Error(`MusicXML part has no measures: ${selectedPartId}`);
  const measures = measureElements.map(() => emptyMeasure());
  const marks = {};
  let divisions = 1;
  measureElements.forEach((measure, measureIndex) => {
    let cursor = 0;
    let previousNoteOnset = null;
    let previousWasPitched = false;
    for (const child of measure.children) {
      if (child.localName === 'attributes') {
        const nextDivisions = finiteTextNumber(localChild(child, 'divisions'));
        if (nextDivisions > 0) divisions = nextDivisions;
      } else if (child.localName === 'direction') {
        const words = child.querySelector('words')?.textContent?.trim();
        const offset = finiteTextNumber(localChild(child, 'offset')) || 0;
        if (words) marks[`${measureIndex}:${slotAt(cursor + offset / divisions)}`] = words;
      } else if (child.localName === 'note') {
        const chord = !!localChild(child, 'chord') && previousWasPitched;
        const onset = chord && previousNoteOnset !== null ? previousNoteOnset : cursor;
        const rest = !!localChild(child, 'rest');
        if (!rest) {
          const string = finiteTextNumber(child.querySelector('technical > string'));
          const fret = finiteTextNumber(child.querySelector('technical > fret'));
          if (Number.isInteger(string) && string >= 1 && string <= 6 && fret !== null) {
            const modifier = noteModifier(child);
            measures[measureIndex][string - 1][slotAt(onset)] = modifier === 'x' ? 'x' : `${fret}${modifier}`;
          }
        }
        if (!chord) {
          const duration = finiteTextNumber(localChild(child, 'duration')) || 0;
          previousNoteOnset = onset;
          previousWasPitched = !rest;
          cursor += duration / divisions;
        }
      } else if (child.localName === 'forward') {
        cursor += (finiteTextNumber(localChild(child, 'duration')) || 0) / divisions;
        previousWasPitched = false;
      } else if (child.localName === 'backup') {
        cursor -= (finiteTextNumber(localChild(child, 'duration')) || 0) / divisions;
        previousWasPitched = false;
      }
    }
  });
  const metadata = readScoreMetadata(doc, selectedPartId);
  return {
    title: doc.querySelector('work > work-title')?.textContent || '',
    tuning: tuningIdFromPart(part),
    bpm: metadata.tempo || 90,
    measures,
    marks
  };
}

/**
 * Conservative one-time upgrade check for v4 records written before editorMode existed.
 * A marker is only a prerequisite; the complete MusicXML tree must also equal a fresh
 * projection/regeneration so no unsupported content can be lost by quick-grid editing.
 */
export function isLosslessV3GridMusicXml(xml, selectedPartId = 'P1') {
  try {
    const doc = parseMusicXml(xml);
    if (doc.doctype || !hasLegacyGridMarker(doc)) return false;
    const projection = musicXmlToV3Song(xml, selectedPartId);
    const regenerated = parseMusicXml(v3SongToMusicXml(projection));
    return canonicalNode(doc.documentElement) === canonicalNode(regenerated.documentElement);
  } catch (error) {
    return false;
  }
}
