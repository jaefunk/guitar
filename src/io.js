// 텍스트 타브(왕복 가능)와 PNG 이미지. toText/parseText/renderImage는 곡 객체를 인자로 받는 순수 함수.
import { STRINGS, PER_LINE, TUNINGS, METERS, DEFAULT_METER } from './constants.js';
import { parse, slotsOf, beatOf } from './tab.js';

/**
 * song: {title, bpm, meter, tuning, measures, marks} → 텍스트 타브.
 * 메모는 해당 칸의 열에 쓴다. 앞 메모와 겹치면 두 칸 띄우고 이어 쓰므로 그만큼 뒤 칸으로 밀린다.
 */
export function toText(song) {
  let w = 2;
  song.measures.forEach((m) => { m.forEach((r) => { r.forEach((v) => { if (v.length > w) w = v.length; }); }); });
  const names = TUNINGS[song.tuning].names;
  const labelW = Math.max.apply(null, names.map((n) => n.length));
  const SLOTS = slotsOf(song), BEAT = beatOf(song), meter = METERS[song.meter] ? song.meter : DEFAULT_METER;
  const out = [];
  if (song.title) out.push(song.title, '');
  out.push('(BPM ' + song.bpm + ', ' + meter + ', 한 칸 = 16분음표)', '');
  const lines = song.measures.length / PER_LINE;
  for (let L = 0; L < lines; L++) {
    let mline = '', any = false, pos = labelW + 1;
    for (let k0 = 0; k0 < PER_LINE; k0++) {
      for (let j = 0; j < SLOTS; j++) {
        const t = song.marks[(L * PER_LINE + k0) + ':' + j];
        if (t) { any = true; while (mline.length < pos) mline += ' '; if (mline.length > pos) mline += '  '; mline += t; }
        pos += w;
      }
      pos += 1;
    }
    if (any) out.push(mline);
    let ruler = new Array(labelW + 2).join(' ');
    for (let k = 0; k < PER_LINE; k++) {
      for (let b = 0; b < SLOTS / BEAT; b++) { let lab = String(b + 1); while (lab.length < w * BEAT) lab += ' '; ruler += lab; }
      ruler += ' ';
    }
    out.push(ruler.replace(/\s+$/, ''));
    for (let s = 0; s < STRINGS; s++) {
      let row = names[s]; while (row.length < labelW) row = ' ' + row; row += '|';
      for (let k2 = 0; k2 < PER_LINE; k2++) {
        const m = song.measures[L * PER_LINE + k2];
        for (let i = 0; i < SLOTS; i++) { let v = m[s][i] || ''; while (v.length < w) v += '-'; row += v; }
        row += '|';
      }
      out.push(row);
    }
    out.push('');
  }
  return out.join('\n');
}

const ROW_RE = /^(\s*[A-Ga-g][b#]?\s*)\|(.*)$/;

/**
 * 이 에디터가 내보낸 텍스트 → {measures, marks, meter, bpm, title}. 실패하면 null.
 * 헤더가 없는 옛 텍스트는 4/4로 읽는다. 다른 사이트의 타브는 정렬이 달라 대부분 실패한다.
 */
export function parseText(txt) {
  const lines = txt.split(/\r?\n/);
  let meter = null, bpm = null, title = '', headerIdx = -1;
  for (let idx = 0; idx < lines.length && headerIdx < 0; idx++) {
    const h = /^\s*\(BPM\s+(\d+)(?:,\s*(\d+\/\d+))?/.exec(lines[idx]);
    if (h) { headerIdx = idx; bpm = +h[1]; if (h[2] && METERS[h[2]]) meter = h[2]; }
  }
  if (headerIdx > 0) {
    for (let idx = 0; idx < headerIdx; idx++) { if (lines[idx].trim()) { title = lines[idx].trim(); break; } }
  }
  const SLOTS = METERS[meter || DEFAULT_METER].slots;

  // 6줄 묶음 찾기. 묶음의 첫 줄 번호와 '|' 열(label 폭)을 같이 기억한다.
  let rows = [], start = -1, col0 = 0;
  const groups = [];
  lines.forEach((l, idx) => {
    const m = ROW_RE.exec(l);
    if (m) {
      if (!rows.length) { start = idx; col0 = m[1].length + 1; }
      rows.push(m[2]);
      if (rows.length === STRINGS) { groups.push({ rows, start, col0 }); rows = []; }
    } else rows = [];
  });
  if (!groups.length) return null;

  const measures = [], marks = {};
  for (let gI = 0; gI < groups.length; gI++) {
    const g = groups[gI];
    const parts = g.rows.map((r) => r.replace(/\|\s*$/, '').split('|'));
    const n = parts[0].length;
    if (!parts.every((p) => p.length === n)) return null;
    const firstM = measures.length;
    const widths = [];
    for (let k = 0; k < n; k++) {
      const len = parts[0][k].length;
      if (!len || len % SLOTS) return null;
      const w = len / SLOTS, meas = [];
      widths.push(w);
      for (let s = 0; s < STRINGS; s++) {
        const str = parts[s][k];
        if (str.length !== len) return null;
        const r = [];
        for (let i = 0; i < SLOTS; i++) {
          const cell = str.substr(i * w, w).replace(/-+$/, '').replace(/^-+/, '').trim();
          if (cell.length > 3) return null;
          r.push(cell);
        }
        meas.push(r);
      }
      measures.push(meas);
    }
    // 메모 줄: 눈금 줄(숫자와 공백만) 바로 위 줄
    const rulerLine = lines[g.start - 1], markLine = lines[g.start - 2];
    if (rulerLine !== undefined && /^\s*\d[\d\s]*$/.test(rulerLine) && markLine && markLine.trim() && !ROW_RE.test(markLine)) {
      const re = /\S+(?: \S+)*/g; // 토큰 = 공백 두 칸 이상으로 구분
      let t;
      while ((t = re.exec(markLine))) {
        let c = t.index - g.col0;
        if (c < 0) c = 0;
        let k = 0;
        while (k < n - 1 && c >= SLOTS * widths[k] + 1) { c -= SLOTS * widths[k] + 1; k++; }
        const i = Math.min(SLOTS - 1, Math.floor(c / widths[k]));
        marks[(firstM + k) + ':' + i] = t[0];
      }
    }
  }
  return { measures, marks, meter: meter || DEFAULT_METER, bpm, title };
}

/** 캔버스에 악보를 그려 돌려준다. */
export function renderImage(song) {
  const P = { bg: '#ffffff', ink: '#1b2230', muted: '#6c7684', line: '#9aa3b1', bar: '#2a3342', mod: '#8a5a00', accent: '#2457d6' };
  const scale = 2, slot = 22, row = 22, labelW = 34, left = 14, top = 14, markH = 16, rulerH = 18, gap = 26;
  const names = TUNINGS[song.tuning].names, lines = song.measures.length / PER_LINE;
  const SLOTS = slotsOf(song), BEAT = beatOf(song);
  const titleH = song.title ? 30 : 0;
  const W = left + labelW + PER_LINE * SLOTS * slot + 24, H = top + titleH + lines * (markH + rulerH + STRINGS * row + gap) + 6;
  const cv = document.createElement('canvas'); cv.width = W * scale; cv.height = H * scale;
  const c = cv.getContext('2d'); c.scale(scale, scale);
  c.fillStyle = P.bg; c.fillRect(0, 0, W, H);
  const monoB = '700 11px "Red Hat Mono", Menlo, Consolas, monospace', monoR = '500 11px "Red Hat Mono", Menlo, Consolas, monospace';
  let y = top;
  if (song.title) { c.fillStyle = P.ink; c.font = '700 16px "Red Hat Mono", Menlo, Consolas, monospace'; c.textBaseline = 'top'; c.fillText(song.title, left, y); y += titleH; }
  const x0 = left + labelW;
  for (let L = 0; L < lines; L++) {
    const my = y, ry = my + markH, sy = ry + rulerH;
    for (let k = 0; k < PER_LINE; k++) {
      const m = L * PER_LINE + k, mx = x0 + k * SLOTS * slot;
      c.textBaseline = 'alphabetic'; c.textAlign = 'left';
      for (let j = 0; j < SLOTS; j++) {
        const t = song.marks[m + ':' + j];
        if (t) { c.fillStyle = P.accent; c.font = '600 11px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'; c.fillText(t, mx + j * slot + 1, my + 12); }
      }
      c.fillStyle = P.muted; c.font = '700 9px "Red Hat Mono", Menlo, Consolas, monospace'; c.fillText(String(m + 1), mx + 3, ry + 8);
      c.font = '500 10px "Red Hat Mono", Menlo, Consolas, monospace'; c.textAlign = 'center';
      for (let bb = 0; bb < SLOTS / BEAT; bb++) c.fillText(String(bb + 1), mx + bb * BEAT * slot + slot / 2, ry + rulerH - 2);
      c.textAlign = 'left';
      for (let j2 = 0; j2 < SLOTS; j2++) { if (j2 % BEAT) { c.fillStyle = P.line; c.fillRect(mx + j2 * slot + slot / 2, ry + rulerH - 5, 1, 3); } }
    }
    const xEnd = x0 + PER_LINE * SLOTS * slot;
    for (let s = 0; s < STRINGS; s++) {
      const ly = sy + s * row + row / 2;
      c.fillStyle = P.line; c.fillRect(x0, Math.round(ly), xEnd - x0, 1);
      c.fillStyle = P.muted; c.font = monoB; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(names[s], x0 - 7, ly);
    }
    const yTop = sy + row / 2, yBot = sy + (STRINGS - 1) * row + row / 2;
    c.fillStyle = P.bar;
    for (let k2 = 0; k2 <= PER_LINE; k2++) c.fillRect(x0 + k2 * SLOTS * slot - (k2 === PER_LINE ? 2 : 0), yTop, 2, yBot - yTop);
    c.textBaseline = 'middle';
    for (let k3 = 0; k3 < PER_LINE; k3++) {
      const meas = song.measures[L * PER_LINE + k3];
      for (let s2 = 0; s2 < STRINGS; s2++) {
        for (let i = 0; i < SLOTS; i++) {
          const v = meas[s2][i]; if (!v) continue;
          const p = parse(v), cx = x0 + k3 * SLOTS * slot + i * slot + slot / 2, cy = sy + s2 * row + row / 2;
          c.font = monoB; const wn = p.num ? c.measureText(p.num).width : 0;
          c.font = monoR; const wm = p.mod ? c.measureText(p.mod).width : 0;
          const tw = wn + wm;
          c.fillStyle = P.bg; c.fillRect(cx - tw / 2 - 1, cy - 7, tw + 2, 14);
          let tx = cx - tw / 2; c.textAlign = 'left';
          if (p.num) { c.fillStyle = P.ink; c.font = monoB; c.fillText(p.num, tx, cy); tx += wn; }
          if (p.mod) { c.fillStyle = P.mod; c.font = monoR; c.fillText(p.mod, tx, cy); }
        }
      }
    }
    y = sy + STRINGS * row + gap;
  }
  return cv;
}
