// 시트/대화상자/토스트/테마·크기 등 UI 공통.
import { PER_LINE } from './constants.js';
import { state } from './state.js';
import { slotsOf } from './tab.js';

export function $(id) { return document.getElementById(id); }

export const MODALS = ['menuModal', 'settingsModal', 'modal', 'importModal', 'imgModal', 'chordModal', 'helpModal', 'coachModal', 'songsModal', 'trainerModal', 'dlg'];

export function openMenu(title, items) {
  $('menuTitle').textContent = title;
  const list = $('menuList');
  list.innerHTML = '';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item' + (it.danger ? ' danger' : '');
    if (it.disabled) b.disabled = true;
    const k = document.createElement('span'); k.className = 'k'; k.textContent = it.k || '';
    const tx = document.createElement('span');
    const l = document.createElement('div'); l.className = 'l'; l.textContent = it.label; tx.appendChild(l);
    if (it.desc) { const d = document.createElement('div'); d.className = 'd'; d.textContent = it.desc; tx.appendChild(d); }
    b.appendChild(k); b.appendChild(tx);
    b.addEventListener('click', () => { $('menuModal').hidden = true; it.action(); });
    list.appendChild(b);
  });
  $('menuModal').hidden = false;
}

let dlgResolve = null;
/** confirm/prompt 대체. 확인→true 또는 입력값, 취소→false 또는 null */
export function ask(o) {
  return new Promise((res) => {
    dlgResolve = res;
    $('dlgTitle').textContent = o.title || '';
    $('dlgMsg').textContent = o.msg || '';
    $('dlgMsg').hidden = !o.msg;
    const inp = $('dlgInput');
    inp.hidden = !o.input; inp.value = o.value || ''; inp.placeholder = o.placeholder || '';
    $('dlgOk').textContent = o.ok || '확인';
    $('dlg').hidden = false;
    if (o.input) setTimeout(() => { inp.focus(); inp.select(); }, 40);
  });
}
export function closeDlg(val) {
  $('dlg').hidden = true;
  const r = dlgResolve; dlgResolve = null;
  if (r) r(val);
}
export function dlgCancelValue() { return $('dlgInput').hidden ? false : null; }
export function dlgOkValue() { return $('dlgInput').hidden ? true : $('dlgInput').value; }

let toastT;
export function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.classList.remove('show'); }, 1700);
}

export function anyModalOpen() { return MODALS.some((id) => !$(id).hidden); }
export function closeModals() {
  MODALS.forEach((id) => {
    if (id === 'dlg') { if (!$(id).hidden) closeDlg(dlgCancelValue()); } else $(id).hidden = true;
  });
}

export function updatePadH() {
  const h = $('pad').offsetHeight;
  if (h) document.documentElement.style.setProperty('--padH', h + 'px');
}
export function applyTheme() {
  const r = document.documentElement;
  if (state.theme === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', state.theme);
}
export function applyZoom() {
  const r = document.documentElement;
  r.setAttribute('data-zoom', state.zoom);
  if (state.zoom !== 'fit') {
    r.style.removeProperty('--slot'); r.style.removeProperty('--row'); r.style.removeProperty('--fs');
    return;
  }
  const wrapW = $('sheetWrap').clientWidth || window.innerWidth;
  let slot = Math.floor((wrapW - 36 - 26) / (PER_LINE * slotsOf(state)));
  slot = Math.max(14, Math.min(40, slot));
  const row = Math.max(20, Math.min(30, slot + 2));
  const fs = slot < 18 ? 10 : (slot < 28 ? 11 : 13);
  r.style.setProperty('--slot', slot + 'px'); r.style.setProperty('--row', row + 'px'); r.style.setProperty('--fs', fs + 'px');
}
