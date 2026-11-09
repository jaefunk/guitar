import { describe, it, expect } from 'vitest';
import { toMidi, inspectMidi, PPQ, TICKS_PER_SLOT } from '../src/midi.js';
import { emptyMeasure } from '../src/tab.js';

function song(o) {
  const ms = [];
  for (let k = 0; k < 4; k++) ms.push(emptyMeasure());
  return Object.assign({ title: 'T', tuning: 'standard', bpm: 120, meter: '4/4', measures: ms, marks: {}, pm: {}, rep: {} }, o);
}

describe('MIDI 내보내기', () => {
  it('헤더: 포맷 0, 트랙 1, PPQ 480, 트랙 길이가 맞는다', () => {
    const s = song(); s.measures[0][0][0] = '0';
    const b = toMidi(s), r = inspectMidi(b);
    expect(r.tag).toBe('MThd'); expect(r.format).toBe(0); expect(r.ntracks).toBe(1); expect(r.division).toBe(PPQ);
    expect(r.trackTag).toBe('MTrk');
    expect(r.consumed).toBe(b.length);
    expect(r.metas.find((m) => m.type === 0x2f)).toBeTruthy();
  });
  it('템포·박자 메타와 곡 제목', () => {
    const s = song({ bpm: 100, meter: '6/8', title: '곡' });
    const r = inspectMidi(toMidi(s));
    const tempo = r.metas.find((m) => m.type === 0x51).data;
    expect((tempo[0] << 16) | (tempo[1] << 8) | tempo[2]).toBe(600000);
    const ts = r.metas.find((m) => m.type === 0x58).data;
    expect(ts[0]).toBe(6); expect(ts[1]).toBe(3);
    expect(new TextDecoder().decode(new Uint8Array(r.metas.find((m) => m.type === 0x03).data))).toBe('곡');
  });
  it('음높이·시각·길이: 같은 줄 다음 음까지, 끊기에서 멈춤, 최대 2마디', () => {
    const s = song();
    s.measures[0][0][0] = '5';   // e줄 5프렛 = 69, 0틱, 다음 음(칸 4)까지 480틱
    s.measures[0][0][4] = '7';   // 칸 4 → 칸 8의 끊기까지 480틱
    s.measures[0][0][8] = '.';
    s.measures[0][5][0] = '0';   // E줄 개방 = 40, 2마디 최대 = 32칸*120
    const r = inspectMidi(toMidi(s));
    const on = r.notes.filter((n) => !n.off), off = r.notes.filter((n) => n.off);
    expect(on.length).toBe(3);
    const n1 = on.find((n) => n.note === 69); expect(n1.t).toBe(0); expect(n1.ch).toBe(0);
    const n2 = on.find((n) => n.note === 71); expect(n2.t).toBe(4 * TICKS_PER_SLOT);
    expect(off.find((n) => n.note === 69).t).toBe(4 * TICKS_PER_SLOT - 1);
    expect(off.find((n) => n.note === 71).t).toBe(8 * TICKS_PER_SLOT - 1);
    const low = on.find((n) => n.note === 40); expect(low.ch).toBe(5);
    expect(off.find((n) => n.note === 40 && n.ch === 5).t).toBe(32 * TICKS_PER_SLOT - 1);
  });
  it('뮤트·팜뮤트·해머온은 짧거나 약하게, 벤딩은 피치벤드', () => {
    const s = song();
    s.measures[0][1][0] = 'x'; s.measures[0][2][0] = '3h'; s.measures[0][3][0] = '5b'; s.measures[1][0][0] = '2';
    s.pm['1:0'] = 1;
    const r = inspectMidi(toMidi(s));
    const on = r.notes.filter((n) => !n.off);
    expect(on.find((n) => n.ch === 1).vel).toBe(45);
    expect(r.notes.find((n) => n.ch === 1 && n.off).t).toBe(TICKS_PER_SLOT / 2 - 1);
    expect(on.find((n) => n.ch === 2).vel).toBe(70);
    expect(on.find((n) => n.ch === 0).vel).toBe(80); // 팜뮤트
    expect(r.notes.find((n) => n.ch === 0 && n.off).t).toBe(16 * TICKS_PER_SLOT + 2 * TICKS_PER_SLOT - 1);
    const bends = r.bends.filter((b) => b.ch === 3 && b.t > 0);
    expect(bends.length).toBe(9);
    expect(bends[7].v).toBe(8192 + 2048);
    expect(bends[8].v).toBe(8192);
  });
  it('반복 기호를 펼친다 (끌 수도 있음)', () => {
    const s = song({ rep: { 1: { e: 2 } } });
    s.measures[0][0][0] = '1'; s.measures[1][0][0] = '2'; s.measures[2][0][0] = '3';
    const r = inspectMidi(toMidi(s));
    expect(r.notes.filter((n) => !n.off).map((n) => n.note)).toEqual([65, 66, 65, 66, 67]);
    expect(toMidi(s, { repeats: false }).noteCount).toBe(3);
    expect(toMidi(s).noteCount).toBe(5);
  });
  it('가변 길이 수(VLQ)가 128 이상의 델타도 맞게 쓴다', () => {
    const s = song(); s.measures[3][0][15] = '12';
    const r = inspectMidi(toMidi(s));
    expect(r.notes.find((n) => !n.off).t).toBe(63 * TICKS_PER_SLOT);
  });
});
