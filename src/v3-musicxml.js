import { TUNINGS } from './constants.js';
import { emptyMeasure, parse, validMeasures } from './tab.js';
import { parseMusicXml, readScoreMetadata } from './musicxml.js';
import { buildScoreIndex } from './score-index.js';

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
  if (modifiers.has('/') || modifiers.has('\\')) direct.push('<slide type="start" number="1"/>');
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

function attributesXml() {
  const tunings = [40, 45, 50, 55, 59, 64].map((midi, index) => {
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
  const tuningMidi = TUNINGS.standard.midi;
  const measures = song.measures.map((measure, measureIndex) => {
    const body = [];
    if (measureIndex === 0) {
      body.push(attributesXml());
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
    '<part-list><score-part id="P1"><part-name>Guitar</part-name><part-abbreviation>Gt.</part-abbreviation></score-part></part-list>' +
    `<part id="P1">${measures}</part></score-partwise>`;
}

function localChildren(element, name) {
  return [...element.children].filter((child) => child.localName === name);
}

/** Best-effort projection used only by the legacy quick-entry grid. */
export function musicXmlToV3Song(xml, selectedPartId = 'P1') {
  const doc = parseMusicXml(xml);
  const index = buildScoreIndex(doc, selectedPartId);
  const measures = index.measures.map(() => emptyMeasure());
  const eventById = new Map();
  index.measures.forEach((measure, measureIndex) => {
    measure.events.forEach((event) => {
      eventById.set(event.id, { measureIndex, event });
      if (event.kind !== 'notes') return;
      const slot = Math.max(0, Math.min(15, Math.round(event.onset.n * 4 / event.onset.d)));
      event.notes.forEach((note) => {
        if (!Number.isInteger(note.string) || note.string < 1 || note.string > 6) return;
        measures[measureIndex][note.string - 1][slot] = note.dead ? 'x' : String(note.fret ?? 0);
      });
    });
  });
  for (const link of index.links) {
    const start = eventById.get(link.startEventId);
    if (!start) continue;
    const slot = Math.max(0, Math.min(15, Math.round(start.event.onset.n * 4 / start.event.onset.d)));
    const suffix = { 'hammer-on': 'h', 'pull-off': 'p', slide: '/' }[link.type];
    if (!suffix) continue;
    const targetNote = start.event.notes.find((note) => Number.isInteger(note.string));
    if (targetNote) measures[start.measureIndex][targetNote.string - 1][slot] += suffix;
  }
  index.measures.forEach((measure, measureIndex) => {
    measure.events.forEach((event) => {
      if (event.kind !== 'notes') return;
      const slot = Math.max(0, Math.min(15, Math.round(event.onset.n * 4 / event.onset.d)));
      event.notes.forEach((note) => {
        if (!Number.isInteger(note.string)) return;
        if (note.bend) measures[measureIndex][note.string - 1][slot] += 'b';
      });
    });
  });
  const marks = {};
  const part = [...doc.documentElement.children].find((node) => node.localName === 'part' && node.getAttribute('id') === selectedPartId);
  localChildren(part || { children: [] }, 'measure').forEach((measure, measureIndex) => {
    let cursor = 0;
    for (const child of measure.children) {
      if (child.localName === 'direction') {
        const words = child.querySelector('words')?.textContent?.trim();
        if (words) marks[`${measureIndex}:${Math.max(0, Math.min(15, cursor))}`] = words;
      } else if (child.localName === 'note' && !child.querySelector(':scope > chord')) {
        cursor += Number(child.querySelector(':scope > duration')?.textContent) || 0;
      } else if (child.localName === 'forward') {
        cursor += Number(child.querySelector(':scope > duration')?.textContent) || 0;
      } else if (child.localName === 'backup') {
        cursor -= Number(child.querySelector(':scope > duration')?.textContent) || 0;
      }
    }
  });
  const metadata = readScoreMetadata(doc, selectedPartId);
  return {
    title: doc.querySelector('work > work-title')?.textContent || '',
    tuning: 'standard',
    bpm: metadata.tempo || 90,
    measures,
    marks
  };
}
