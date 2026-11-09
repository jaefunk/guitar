import { canEditCurrentSong, save, state } from './state.js';

export function applyTitleInput(input) {
  if (!canEditCurrentSong()) {
    input.value = state.title;
    return false;
  }
  state.title = input.value;
  save();
  return true;
}

export function applyBpmInput(input) {
  if (!canEditCurrentSong()) {
    input.value = String(state.bpm);
    return false;
  }
  const value = Math.max(40, Math.min(240, Math.round(+input.value || 90)));
  input.value = String(value);
  state.bpm = value;
  save();
  return true;
}

export function applyTuningInput(input) {
  if (!canEditCurrentSong()) {
    input.value = state.tuning;
    return false;
  }
  state.tuning = input.value;
  save();
  return true;
}

export function syncQuickEditability() {
  const readOnly = !canEditCurrentSong();
  for (const id of ['title', 'bpm', 'tuning', 'undo', 'addLine', 'measureMenu', 'clearAll', 'chordBtn', 'markBtn', 'doImport']) {
    const element = document.getElementById(id);
    if (element) element.disabled = readOnly;
  }
  document.querySelectorAll('#digits button, [data-mod], #del, #fretboard .fb-cell, #fbClear')
    .forEach((button) => { button.disabled = readOnly; });
  const status = document.getElementById('readOnlyStatus');
  if (status) {
    status.hidden = !readOnly;
    status.textContent = readOnly ? '빠른 격자 읽기 전용 · 전문 TAB 편집 가능' : '';
  }
  return !readOnly;
}
