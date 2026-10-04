// 샘플 악기: 사용자가 올린 줄별 개방현 녹음을 IndexedDB에 저장하고 playbackRate로 음높이를 맞춘다.
// 비유하면 "줄 여섯 개짜리 샘플러": 줄마다 원본 한 음을 두고 프렛만큼 빠르게/느리게 튼다.
import { STRINGS } from './constants.js';

const DB = 'gtab-samples', STORE = 'samples';
/** 메모리 캐시: slot[s] = {midi, name, buffer(AudioBuffer)} */
export const slots = new Array(STRINGS).fill(null);
let dbp = null;

function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('no idb')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return openDB().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}

/** 저장된 샘플을 모두 읽어 디코드한다. decode: (ArrayBuffer) => Promise<AudioBuffer> */
export function loadAll(decode) {
  return tx('readonly', (st) => st.getAll()).then((rows) => {
    rows = rows || [];
    return tx('readonly', (st) => st.getAllKeys()).then((keys) => Promise.all(rows.map((r, k) => {
      const s = +keys[k];
      return decode(r.data.slice(0)).then((buffer) => { slots[s] = { midi: r.midi, name: r.name, buffer }; }).catch(() => { slots[s] = null; });
    })));
  }).catch(() => {});
}

/** 파일을 s번 줄 샘플로 저장(개방현 MIDI 번호 midi). decode는 검증 겸 캐시용 */
export function putSample(s, file, midi, decode) {
  return file.arrayBuffer().then((data) => decode(data.slice(0)).then((buffer) => {
    slots[s] = { midi, name: file.name, buffer };
    return tx('readwrite', (st) => st.put({ name: file.name, midi, data }, s));
  }));
}
export function removeSample(s) { slots[s] = null; return tx('readwrite', (st) => st.delete(s)).catch(() => {}); }
export function clearSamples() { for (let s = 0; s < STRINGS; s++) slots[s] = null; return tx('readwrite', (st) => st.clear()).catch(() => {}); }
export function loadedCount() { return slots.filter(Boolean).length; }

/**
 * midi 음을 낼 샘플 고르기: 자기 줄 샘플이 있으면 그것, 없으면 음높이가 가장 가까운 줄의 샘플.
 * @returns {{buffer, rate}|null}
 */
export function pick(s, midi) {
  let best = slots[s] || null;
  if (!best) {
    let bd = Infinity;
    slots.forEach((sl) => { if (!sl) return; const d = Math.abs(sl.midi - midi); if (d < bd) { bd = d; best = sl; } });
  }
  if (!best) return null;
  return { buffer: best.buffer, rate: Math.pow(2, (midi - best.midi) / 12) };
}
