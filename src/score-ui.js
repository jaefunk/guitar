import { parseMusicXml, serializeMusicXml } from './musicxml.js';
import { buildScoreIndex } from './score-index.js';
import {
  createHistory,
  deleteEventCommand,
  insertEventCommand,
  setEndingCommand,
  setFlagsCommand,
  setFretCommand,
  setRepeatCommand,
  setRhythmCommand,
  setStringCommand,
  setTechniquePairCommand
} from './score-edit.js';

function append(parent, tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value;
    else if (name === 'checked') node.checked = Boolean(value);
    else if (name === 'disabled') node.disabled = Boolean(value);
    else node.setAttribute(name, String(value));
  }
  if (text !== undefined) node.textContent = String(text);
  parent.appendChild(node);
  return node;
}

function field(parent, label, name, value, attributes = {}) {
  const wrapper = append(parent, 'label', { className: 'score-inspector-field' });
  append(wrapper, 'span', {}, label);
  return append(wrapper, 'input', { name, value: value ?? '', ...attributes });
}

function checkbox(parent, label, name, checked) {
  const wrapper = append(parent, 'label', { className: 'score-inspector-check' });
  const input = append(wrapper, 'input', { type: 'checkbox', name, checked });
  append(wrapper, 'span', {}, label);
  return input;
}

function allEvents(index) {
  return index.measures.flatMap((measure, measureIndex) => measure.events.map((event) => ({
    ...event, measureIndex, measureNumber: measure.number
  })));
}

export function createScoreEditorBindings({ inspector, getSong, persistMusicXml, rerender = () => {} }) {
  let doc = null;
  let partId = null;
  let sourceXml = null;
  let songIdentity = null;
  let selectedEventId = null;
  let currentEvent = null;
  let history = null;

  const ensureSession = () => {
    const song = getSong();
    if (!song || typeof song.musicxml !== 'string') throw new Error('현재 MusicXML 곡이 없습니다');
    const identity = song.id || song;
    if (!doc || identity !== songIdentity || (song.musicxml !== sourceXml && song.musicxml !== serializeMusicXml(doc))) {
      doc = parseMusicXml(song.musicxml);
      partId = song.selectedPartId;
      sourceXml = song.musicxml;
      songIdentity = identity;
      selectedEventId = null;
      history = createHistory((measures) => {
        sourceXml = serializeMusicXml(doc);
        persistMusicXml(sourceXml);
        const index = buildScoreIndex(doc, partId);
        if (!allEvents(index).some((event) => event.id === selectedEventId)) {
          selectedEventId = allEvents(index)[0]?.id || null;
        }
        rerender(measures, selectedEventId);
        renderSelected();
      });
    }
    return { song, index: buildScoreIndex(doc, partId) };
  };

  const execute = (command) => history.execute(command);

  const renderEmpty = () => {
    inspector.replaceChildren();
    append(inspector, 'h2', {}, '속성');
    append(inspector, 'p', {}, '음표를 선택하면 세부 속성을 편집할 수 있습니다.');
  };

  const renderSelected = () => {
    let index;
    try {
      ({ index } = ensureSession());
    } catch (error) {
      renderEmpty();
      return;
    }
    currentEvent = allEvents(index).find((event) => event.id === selectedEventId) || null;
    if (!currentEvent) {
      renderEmpty();
      return;
    }
    const note = currentEvent.notes?.[0] || {};
    inspector.replaceChildren();
    append(inspector, 'h2', {}, '속성');
    const header = append(inspector, 'div', { className: 'score-inspector-history' });
    append(header, 'button', { type: 'button', 'data-score-action': 'undo', disabled: !history.canUndo() }, '실행 취소');
    append(header, 'button', { type: 'button', 'data-score-action': 'redo', disabled: !history.canRedo() }, '다시 실행');
    append(inspector, 'p', { className: 'score-inspector-selection', 'data-event-id': currentEvent.id },
      `${currentEvent.measureNumber}마디 · ${currentEvent.id}`);

    const position = append(inspector, 'fieldset');
    append(position, 'legend', {}, 'TAB 위치');
    field(position, '현', 'score-string', note.string, { type: 'number', min: 1, max: 6 });
    field(position, '프렛', 'score-fret', note.fret, { type: 'number', min: 0, max: 36 });

    const rhythm = append(inspector, 'fieldset');
    append(rhythm, 'legend', {}, '리듬');
    field(rhythm, 'duration', 'score-duration', currentEvent.duration.n * (index.measures[currentEvent.measureIndex].divisions || 1) / currentEvent.duration.d,
      { type: 'number', min: 1 });
    field(rhythm, 'type', 'score-type', currentEvent.noteType || 'quarter');
    field(rhythm, '점', 'score-dots', currentEvent.dots || 0, { type: 'number', min: 0, max: 4 });
    field(rhythm, '잇단 실제음', 'score-tuplet-actual', currentEvent.tuplet?.actual || '', { type: 'number', min: 1 });
    field(rhythm, '잇단 기준음', 'score-tuplet-normal', currentEvent.tuplet?.normal || '', { type: 'number', min: 1 });

    const flags = append(inspector, 'fieldset');
    append(flags, 'legend', {}, '음표');
    checkbox(flags, '쉼표', 'score-rest', currentEvent.kind === 'rest');
    checkbox(flags, '데드 노트', 'score-dead', Boolean(note.dead));
    checkbox(flags, '고스트 노트', 'score-ghost', Boolean(note.ghost));

    const technique = append(inspector, 'fieldset');
    append(technique, 'legend', {}, '연결 주법');
    const type = append(technique, 'select', { name: 'score-technique' });
    for (const value of ['hammer-on', 'pull-off', 'slide', 'tie']) append(type, 'option', { value }, value);
    field(technique, '끝 이벤트 ID', 'score-technique-target', '');
    append(technique, 'button', { type: 'button', 'data-score-action': 'technique-add' }, '연결 추가');
    append(technique, 'button', { type: 'button', 'data-score-action': 'technique-remove' }, '연결 제거');

    const form = append(inspector, 'fieldset');
    append(form, 'legend', {}, '마디 형식');
    checkbox(form, '앞 반복', 'score-repeat-forward', currentEvent.measureIndex === 0
      ? index.measures[0].barlines?.some((barline) => barline.repeat === 'forward')
      : index.measures[currentEvent.measureIndex].barlines?.some((barline) => barline.repeat === 'forward'));
    checkbox(form, '뒤 반복', 'score-repeat-backward', index.measures[currentEvent.measureIndex].barlines?.some((barline) => barline.repeat === 'backward'));
    field(form, '엔딩 번호', 'score-ending-number', '1');
    field(form, '엔딩 끝 마디(0부터)', 'score-ending-end', currentEvent.measureIndex, { type: 'number', min: currentEvent.measureIndex });
    append(form, 'button', { type: 'button', 'data-score-action': 'ending-add' }, '엔딩 추가');
    append(form, 'button', { type: 'button', 'data-score-action': 'ending-remove' }, '엔딩 제거');

    const events = append(inspector, 'div', { className: 'score-inspector-events' });
    append(events, 'button', { type: 'button', 'data-score-action': 'insert' }, '뒤에 음표 삽입');
    append(events, 'button', { type: 'button', 'data-score-action': 'delete' }, '이 이벤트 삭제');
  };

  inspector.addEventListener('change', (event) => {
    if (!selectedEventId) return;
    const input = event.target;
    try {
      if (input.name === 'score-fret') execute(setFretCommand(doc, partId, selectedEventId, input.value));
      else if (input.name === 'score-string') execute(setStringCommand(doc, partId, selectedEventId, input.value));
      else if (['score-duration', 'score-type', 'score-dots', 'score-tuplet-actual', 'score-tuplet-normal'].includes(input.name)) {
        const actual = inspector.querySelector('[name="score-tuplet-actual"]').value;
        const normal = inspector.querySelector('[name="score-tuplet-normal"]').value;
        execute(setRhythmCommand(doc, partId, selectedEventId, {
          duration: inspector.querySelector('[name="score-duration"]').value,
          type: inspector.querySelector('[name="score-type"]').value,
          dots: inspector.querySelector('[name="score-dots"]').value,
          tuplet: actual && normal ? { actual, normal } : null
        }));
      } else if (['score-rest', 'score-dead', 'score-ghost'].includes(input.name)) {
        execute(setFlagsCommand(doc, partId, selectedEventId, {
          rest: inspector.querySelector('[name="score-rest"]').checked,
          dead: inspector.querySelector('[name="score-dead"]').checked,
          ghost: inspector.querySelector('[name="score-ghost"]').checked
        }));
      } else if (input.name === 'score-repeat-forward' || input.name === 'score-repeat-backward') {
        const direction = input.name.endsWith('forward') ? 'forward' : 'backward';
        execute(setRepeatCommand(doc, partId, currentEvent.measureIndex, direction, input.checked));
      }
    } catch (error) {
      renderSelected();
    }
  });

  inspector.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-score-action]')?.dataset.scoreAction;
    if (!action) return;
    try {
      if (action === 'undo') history?.undo();
      else if (action === 'redo') history?.redo();
      else if (action === 'delete') execute(deleteEventCommand(doc, partId, selectedEventId));
      else if (action === 'insert') execute(insertEventCommand(doc, partId, {
        measureIndex: currentEvent.measureIndex, afterEventId: selectedEventId,
        event: { duration: 4, type: 'quarter', notes: [{ string: 1, fret: 0 }] }
      }));
      else if (action.startsWith('technique-')) {
        execute(setTechniquePairCommand(
          doc, partId, inspector.querySelector('[name="score-technique"]').value,
          selectedEventId, inspector.querySelector('[name="score-technique-target"]').value,
          action === 'technique-add'
        ));
      } else if (action.startsWith('ending-')) {
        execute(setEndingCommand(
          doc, partId, currentEvent.measureIndex,
          Number(inspector.querySelector('[name="score-ending-end"]').value),
          inspector.querySelector('[name="score-ending-number"]').value,
          action === 'ending-add'
        ));
      }
    } catch (error) {
      renderSelected();
    }
  });

  const select = (eventOrId) => {
    ensureSession();
    selectedEventId = typeof eventOrId === 'string' ? eventOrId : eventOrId?.id || null;
    renderSelected();
  };

  return {
    select,
    render: select,
    clear() { selectedEventId = null; history?.clear(); renderEmpty(); },
    getSelectedEventId() { return selectedEventId; }
  };
}
