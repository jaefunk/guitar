// 지판 입력 UI.
import { STRINGS, TUNINGS } from './constants.js';
import { state, ed, save } from './state.js';
import { parse } from './tab.js';
import { $, updatePadH } from './ui.js';
import { setSel } from './render.js';
import { getVal, setVal } from './edit.js';
import { preview } from './audio.js';

let fbCells = [];

export function buildFretboard() {
  const fb = $('fretboard');
  fb.innerHTML = ''; fbCells = [];
  const names = TUNINGS[state.tuning].names;
  const base = state.fretShift;
  const head = document.createElement('div'); head.className = 'fb-row head';
  const hl = document.createElement('div'); hl.className = 'fb-lab'; head.appendChild(hl);
  for (let f = 0; f <= 12; f++) {
    const fr = base + f;
    const h = document.createElement('div'); h.className = 'fb-head';
    const dot = document.createElement('i');
    if ([3, 5, 7, 9, 12, 15, 17, 19, 21, 24].indexOf(fr) < 0) dot.className = 'none';
    const num = document.createElement('span'); num.textContent = fr;
    h.appendChild(num); h.appendChild(dot); head.appendChild(h);
  }
  fb.appendChild(head);
  for (let s = 0; s < STRINGS; s++) {
    const row = document.createElement('div'); row.className = 'fb-row';
    const lab = document.createElement('div'); lab.className = 'fb-lab'; lab.textContent = names[s]; row.appendChild(lab);
    fbCells[s] = [];
    for (let f2 = 0; f2 <= 12; f2++) {
      const fr2 = base + f2;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'fb-cell' + (fr2 === 0 ? ' nut' : '');
      b.dataset.s = s; b.dataset.f = fr2; b.tabIndex = -1;
      b.setAttribute('aria-label', names[s] + '줄 ' + fr2 + '프렛');
      fbCells[s][f2] = b; row.appendChild(b);
    }
    fb.appendChild(row);
  }
  $('fbShift').textContent = base ? '0 ~ 12 프렛 보기' : '12 ~ 24 프렛 보기';
  updateFretboard();
}

export function updateFretboard() {
  if (!fbCells.length || state.padMode !== 'fret') return;
  const sel = ed.sel;
  for (let s = 0; s < STRINGS; s++) {
    const num = sel ? parse(getVal({ m: sel.m, s, i: sel.i })).num : '';
    for (let f = 0; f <= 12; f++) {
      const b = fbCells[s][f];
      b.classList.toggle('on', num !== '' && +num === +b.dataset.f);
    }
  }
}

export function fretTap(s, f) {
  if (!ed.sel) setSel({ m: 0, s, i: 0 }, false);
  const sel = ed.sel;
  const p = { m: sel.m, s, i: sel.i };
  const cur = parse(getVal(p));
  if (cur.num !== '' && +cur.num === f) setVal(p, '');
  else { setVal(p, String(f) + cur.mod); preview([{ s, fret: f }]); }
  setSel({ m: sel.m, s, i: sel.i }, false);
}

export function setPadMode(mode) {
  state.padMode = mode; save();
  const fret = mode === 'fret';
  $('keysBlock').hidden = fret; $('fretBlock').hidden = !fret;
  $('modeKeys').classList.toggle('on', !fret); $('modeFret').classList.toggle('on', fret);
  if (fret) buildFretboard();
  updatePadH();
}

export function setCollapsed(v) {
  state.collapsed = v; save();
  $('pad').classList.toggle('collapsed', v);
  updatePadH();
}
