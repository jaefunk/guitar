import { describe, it, expect } from 'vitest';
import { detectChord, detectColumn, chordDiagramSVG } from '../src/chords.js';
import { emptyMeasure } from '../src/tab.js';

// 운지 'EADGBe' → MIDI 배열 (표준 튜닝)
function fing(f) {
  const open = [40, 45, 50, 55, 59, 64], out = [];
  f.split('').forEach((c, k) => { if (c !== 'x') out.push(open[k] + +c); });
  return out;
}
const name = (f) => (detectChord(fing(f)) || {}).name;

describe('코드 인식', () => {
  it('기본 3화음', () => {
    expect(name('x32010')).toBe('C');
    expect(name('320003')).toBe('G');
    expect(name('x02210')).toBe('Am');
    expect(name('022000')).toBe('Em');
    expect(name('xx0231')).toBe('Dm');
    expect(name('133211')).toBe('F');
  });
  it('7th·maj7·sus·add9·dim·aug·파워코드', () => {
    expect(name('320001')).toBe('G7');
    expect(name('x32000')).toBe('Cmaj7');
    expect(name('x02010')).toBe('Am7');
    expect(name('xx0233')).toBe('Dsus4');
    expect(name('x02200')).toBe('Asus2');
    expect(name('x32030')).toBe('Cadd9');
    expect(name('xx0131')).toBe('Ddim');
    expect(name('xx2110')).toBe('Eaug'); // 증3화음은 대칭이라 베이스(E)를 근음으로
    expect(name('133xxx')).toBe('F5');
    expect(name('xx0212')).toBe('D7');
  });
  it('슬래시 코드: 베이스가 근음과 다르면', () => {
    expect(name('x20003')).toBe('G/B');
    expect(name('2x0232')).toBe('D/F#');
    expect(name('xx2010')).toBe('C/E');
  });
  it('5음 생략 7th는 차선으로 인식', () => {
    expect(detectChord([40, 44, 50]).name).toBe('E7');  // E G# D
  });
  it('음이 1개이거나 인식 불가면 null', () => {
    expect(detectChord([40])).toBeNull();
    expect(detectChord([])).toBeNull();
    expect(detectChord([40, 41])).toBeNull();
  });
  it('detectColumn은 칸의 6줄을 읽는다', () => {
    const m = emptyMeasure();
    // 셀 배열은 e..E 순. C 코드 x32010 → e:0 B:1 G:0 D:2 A:3 E:x
    m[0][4] = '0'; m[1][4] = '1'; m[2][4] = '0h'; m[3][4] = '2'; m[4][4] = '3';
    expect(detectColumn(m, 4, 'standard').name).toBe('C');
    expect(detectColumn(m, 0, 'standard')).toBeNull();
    // 드롭 D 튜닝에서는 6번 줄이 D
    m[5][4] = '0';
    expect(detectColumn(m, 4, 'dropd').name).toBe('Cadd9/D');
  });
});

describe('코드 다이어그램 SVG', () => {
  it('눌린 줄은 점, 개방현은 원, 뮤트는 ×', () => {
    const svg = chordDiagramSVG('x32010');
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<circle[^>]*fill="currentColor"/g) || []).length).toBe(3);
    expect((svg.match(/fill="none"/g) || []).length).toBe(2);
    expect((svg.match(/×/g) || []).length).toBe(1);
    expect(svg).not.toContain('fr<');
  });
  it('5프렛을 넘으면 기준 프렛 표시', () => {
    expect(chordDiagramSVG('x8ax9x'.replace('a', '9'))).toContain('8fr');
    expect(chordDiagramSVG('355333')).not.toContain('fr<');
  });
});
