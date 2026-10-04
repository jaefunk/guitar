// 악보 DOM 생성과 선택 표시. 값 변경은 전체 재렌더 없이 paintCell/paintMark로.
import { STRINGS, PER_LINE, TUNINGS } from './constants.js';
import { state, ed } from './state.js';
import { parse, slotsOf, beatOf } from './tab.js';
import { $ } from './ui.js';
import { pb, applyLoopMarks } from './audio.js';
import { updateFretboard } from './fretboard.js';

/** 셀 캐시: cells[m][s][i], marks[m][i], rulers[m] */
export const dom = { cells: [], marks: [], rulers: [] };

export function cellAt(p) {
  return dom.cells[p.m] && dom.cells[p.m][p.s] && dom.cells[p.m][p.s][p.i];
}

export function paintCell(c, v) {
  c.innerHTML = '';
  if (!v) return;
  const p = parse(v);
  const span = document.createElement('span'); span.className = 'v';
  if (p.num) { const a = document.createElement('span'); a.textContent = p.num; span.appendChild(a); }
  if (p.mod) { const b = document.createElement('span'); b.className = 'mod'; b.textContent = p.mod; span.appendChild(b); }
  c.appendChild(span);
}

export function paintMark(m, i) {
  const el = dom.marks[m] && dom.marks[m][i];
  if (!el) return;
  el.innerHTML = '';
  const t = state.marks[m + ':' + i];
  el.classList.toggle('empty', !t);
  if (t) { const s = document.createElement('span'); s.className = 't'; s.textContent = t; el.appendChild(s); }
}

export function render() {
  const sheet = $('sheet');
  sheet.innerHTML = '';
  dom.cells = []; dom.marks = []; dom.rulers = [];
  const names = TUNINGS[state.tuning].names;
  const lines = state.measures.length / PER_LINE;
  const SLOTS = slotsOf(state), BEAT = beatOf(state);
  for (let L = 0; L < lines; L++) {
    const sys = document.createElement('div'); sys.className = 'system';

    const marks = document.createElement('div'); marks.className = 'marks';
    const sp0 = document.createElement('div'); sp0.className = 'spacer'; marks.appendChild(sp0);
    for (let k0 = 0; k0 < PER_LINE; k0++) {
      const m0 = L * PER_LINE + k0;
      dom.marks[m0] = [];
      const wrap = document.createElement('div'); wrap.className = 'measure'; wrap.style.display = 'flex';
      for (let j = 0; j < SLOTS; j++) {
        const mk = document.createElement('button');
        mk.type = 'button'; mk.className = 'mk'; mk.dataset.m = m0; mk.dataset.i = j; mk.tabIndex = -1;
        mk.setAttribute('aria-label', '마디 ' + (m0 + 1) + ' ' + (j + 1) + '번째 칸 메모');
        dom.marks[m0][j] = mk; wrap.appendChild(mk); paintMark(m0, j);
      }
      marks.appendChild(wrap);
    }
    sys.appendChild(marks);

    const ruler = document.createElement('div'); ruler.className = 'ruler';
    const sp = document.createElement('div'); sp.className = 'spacer'; ruler.appendChild(sp);
    for (let k = 0; k < PER_LINE; k++) {
      const m = L * PER_LINE + k;
      const md = document.createElement('div'); md.className = 'measure'; md.dataset.m = m; md.title = '마디 ' + (m + 1) + ' 처음으로 이동';
      const mn = document.createElement('span'); mn.className = 'mnum'; mn.textContent = m + 1; md.appendChild(mn);
      for (let i = 0; i < SLOTS; i++) {
        const t = document.createElement('div'); t.className = 'tick' + (i % BEAT ? ' sub' : '');
        if (i % BEAT === 0) t.textContent = (i / BEAT + 1);
        md.appendChild(t);
      }
      dom.rulers[m] = md; ruler.appendChild(md);
    }
    sys.appendChild(ruler);

    const strings = document.createElement('div'); strings.className = 'strings';
    for (let s = 0; s < STRINGS; s++) {
      const row = document.createElement('div'); row.className = 'srow';
      const lab = document.createElement('div'); lab.className = 'label'; lab.textContent = names[s]; row.appendChild(lab);
      for (let k2 = 0; k2 < PER_LINE; k2++) {
        const m2 = L * PER_LINE + k2;
        const md2 = document.createElement('div'); md2.className = 'measure' + (k2 === 0 ? ' m0' : '');
        dom.cells[m2] = dom.cells[m2] || [];
        dom.cells[m2][s] = dom.cells[m2][s] || [];
        for (let i2 = 0; i2 < SLOTS; i2++) {
          const c = document.createElement('button');
          c.type = 'button'; c.className = 'cell';
          c.dataset.m = m2; c.dataset.s = s; c.dataset.i = i2; c.tabIndex = -1;
          c.setAttribute('aria-label', '마디 ' + (m2 + 1) + ' ' + names[s] + '줄 ' + (i2 + 1) + '번째 칸');
          dom.cells[m2][s][i2] = c;
          paintCell(c, state.measures[m2][s][i2]);
          md2.appendChild(c);
        }
        row.appendChild(md2);
      }
      strings.appendChild(row);
    }
    sys.appendChild(strings);
    sheet.appendChild(sys);
  }
  if (ed.sel && ed.sel.m >= state.measures.length) ed.sel = null;
  applySel(); updateInfo(); updateFretboard(); applyLoopMarks();
}

export function eachCol(fn) {
  const sel = ed.sel;
  if (!sel) return;
  for (let s = 0; s < STRINGS; s++) {
    const c = cellAt({ m: sel.m, s, i: sel.i });
    if (c) fn(c, s);
  }
}
export function clearSel() {
  eachCol((c) => { c.classList.remove('col', 'sel', 'pending'); });
  const sel = ed.sel;
  if (sel) {
    const mk = dom.marks[sel.m] && dom.marks[sel.m][sel.i]; if (mk) mk.classList.remove('col');
    const r = dom.rulers[sel.m]; if (r) r.classList.remove('cur');
  }
}
export function applySel() {
  const sel = ed.sel;
  eachCol((c, s) => { c.classList.add('col'); if (s === sel.s) c.classList.add('sel'); });
  if (sel) {
    const mk = dom.marks[sel.m] && dom.marks[sel.m][sel.i]; if (mk) mk.classList.add('col');
    const r = dom.rulers[sel.m]; if (r) r.classList.add('cur');
  }
}
export function setPending(v) {
  ed.pending = v;
  if (ed.sel) { const c = cellAt(ed.sel); if (c) c.classList.toggle('pending', v); }
  updateInfo();
}
export function setSel(n, scroll) {
  clearSel();
  ed.sel = n; ed.pending = false;
  applySel(); updateInfo(); updateFretboard();
  if (ed.sel && scroll) {
    const c = cellAt(ed.sel);
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
export function updateInfo() {
  const selInfo = $('selInfo');
  const sel = ed.sel;
  selInfo.classList.remove('hint', 'pend');
  if (pb.playing && pb.lastHL !== null) {
    selInfo.textContent = '재생 중: 마디 ' + (pb.lastHL.m + 1) + ' / ' + state.measures.length;
    return;
  }
  if (!sel) { selInfo.textContent = '악보의 칸을 탭해서 선택하세요'; selInfo.classList.add('hint'); return; }
  const names = TUNINGS[state.tuning].names;
  if (ed.pending) { selInfo.textContent = '두 자리 프렛? 다음 숫자를 누르세요 (아니면 → 로 이동)'; selInfo.classList.add('pend'); return; }
  const BEAT = beatOf(state);
  selInfo.textContent = '마디 ' + (sel.m + 1) + '의 ' + (Math.floor(sel.i / BEAT) + 1) + '박 ' + (sel.i % BEAT + 1) + '번째, ' + names[sel.s] + '줄';
}
