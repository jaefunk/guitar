// 코드 자동 인식(피치클래스 템플릿 매칭)과 코드 다이어그램(SVG).
import { STRINGS, TUNINGS } from './constants.js';
import { parse } from './tab.js';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// [접미사, 근음 기준 반음 간격]. 앞에 있을수록 같은 점수에서 우선.
const TEMPLATES = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['m7', [0, 3, 7, 10]], ['maj7', [0, 4, 7, 11]],
  ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['add9', [0, 2, 4, 7]],
  ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]], ['7sus4', [0, 5, 7, 10]], ['dim7', [0, 3, 6, 9]], ['m7b5', [0, 3, 6, 10]],
  ['mmaj7', [0, 3, 7, 11]], ['9', [0, 2, 4, 7, 10]], ['m9', [0, 2, 3, 7, 10]], ['maj9', [0, 2, 4, 7, 11]], ['5', [0, 7]]
];

function sameSet(a, b) { return a.length === b.length && a.every((x) => b.indexOf(x) >= 0); }

/**
 * MIDI 번호 배열(또는 피치클래스) → {name, root, quality, bass} 또는 null.
 * 정확히 일치하는 템플릿을 우선하고, 없으면 5음을 생략한 7th류를 허용한다.
 * 베이스가 근음과 다르면 슬래시 코드(G/B)로 적는다.
 */
export function detectChord(midis) {
  if (!midis || midis.length < 2) return null;
  const sorted = midis.slice().sort((a, b) => a - b);
  const bass = sorted[0] % 12;
  const pcs = []; sorted.forEach((n) => { const pc = n % 12; if (pcs.indexOf(pc) < 0) pcs.push(pc); });
  if (pcs.length < 2) return null;
  let best = null;
  pcs.forEach((root) => {
    const rel = pcs.map((pc) => (pc - root + 12) % 12);
    TEMPLATES.forEach((tpl, idx) => {
      const [q, iv] = tpl;
      let score = null;
      if (sameSet(rel, iv)) score = 0;
      else if (iv.length >= 4 && iv.indexOf(7) >= 0 && sameSet(rel, iv.filter((x) => x !== 7))) score = 10; // 5음 생략
      if (score === null) return;
      if (root !== bass) score += 3;
      score += idx * 0.01;
      if (!best || score < best.score) best = { score, root, quality: q, bass };
    });
  });
  if (!best) return null;
  const name = NOTE_NAMES[best.root] + best.quality + (best.bass !== best.root ? '/' + NOTE_NAMES[best.bass] : '');
  return { name, root: best.root, quality: best.quality, bass: best.bass };
}

/** 선택한 칸(한 세로 줄)의 음들 → 코드 인식. measure: 6줄 배열, i: 칸, tuning 키 */
export function detectColumn(measure, i, tuning) {
  const midis = TUNINGS[tuning].midi, notes = [];
  for (let s = 0; s < STRINGS; s++) {
    const p = parse(measure[s][i]);
    if (p.num) notes.push(midis[s] + +p.num);
  }
  return detectChord(notes);
}

/**
 * 운지 문자열(EADGBe 순, 'x32010') → 6×5 격자 SVG 문자열.
 * 1~5프렛 안에 들어가면 너트를 그리고, 아니면 가장 낮은 프렛을 기준으로 'nfr' 표시.
 */
export function chordDiagramSVG(fing, opts) {
  opts = opts || {};
  const W = opts.width || 56, H = opts.height || 66, left = 8, top = 16, right = W - 6, bottom = H - 4;
  const sw = (right - left) / 5, fh = (bottom - top) / 5;
  const frets = fing.split('').map((c) => (c === 'x' ? -1 : +c));
  const pressed = frets.filter((f) => f > 0);
  const maxF = pressed.length ? Math.max.apply(null, pressed) : 0, minF = pressed.length ? Math.min.apply(null, pressed) : 1;
  const base = maxF <= 5 ? 1 : minF;
  const parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" class="cd" aria-hidden="true">');
  // 프렛(가로)과 줄(세로)
  for (let f = 0; f <= 5; f++) {
    const y = top + f * fh;
    parts.push('<line x1="' + left + '" y1="' + y + '" x2="' + right + '" y2="' + y + '" stroke="currentColor" stroke-width="' + (f === 0 && base === 1 ? 2.5 : 0.8) + '"/>');
  }
  for (let s = 0; s < 6; s++) {
    const x = left + s * sw;
    parts.push('<line x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + bottom + '" stroke="currentColor" stroke-width="0.8"/>');
  }
  if (base > 1) parts.push('<text x="' + (right + 1) + '" y="' + (top + fh * 0.75) + '" font-size="7" text-anchor="end" fill="currentColor" font-family="ui-monospace,monospace">' + base + 'fr</text>');
  frets.forEach((f, s) => {
    const x = left + s * sw;
    if (f < 0) parts.push('<text x="' + x + '" y="' + (top - 4) + '" font-size="8" text-anchor="middle" fill="currentColor" font-family="ui-monospace,monospace">×</text>');
    else if (f === 0) parts.push('<circle cx="' + x + '" cy="' + (top - 7) + '" r="2.4" fill="none" stroke="currentColor" stroke-width="0.9"/>');
    else {
      const y = top + (f - base + 0.5) * fh;
      parts.push('<circle cx="' + x + '" cy="' + y + '" r="' + (sw * 0.36) + '" fill="currentColor"/>');
    }
  });
  parts.push('</svg>');
  return parts.join('');
}
