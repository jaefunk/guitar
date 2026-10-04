// 전역 상수. SLOTS/PER_LINE은 나중에 박자표(로드맵 5번)를 위해 곡 속성으로 옮길 후보.
export const STRINGS = 6;
export const SLOTS = 16;      // 한 마디 = 16분음표 16칸
export const PER_LINE = 4;    // 한 줄 = 4마디
export const MAX_FRET = 24;
export const DEFAULT_MEASURES = 8;

// localStorage 키. v3부터 곡 여러 개를 저장한다.
export const KEY = 'gtab-editor-v3';
export const LEGACY_KEYS = ['gtab-editor-v2', 'gtab-editor-v1'];

export const TUNINGS = {
  standard: { name: '표준 (E A D G B e)', names: ['e', 'B', 'G', 'D', 'A', 'E'], midi: [64, 59, 55, 50, 45, 40] },
  dropd: { name: '드롭 D', names: ['e', 'B', 'G', 'D', 'A', 'D'], midi: [64, 59, 55, 50, 45, 38] },
  half: { name: '반음 내림', names: ['eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb'], midi: [63, 58, 54, 49, 44, 39] },
  full: { name: '온음 내림', names: ['d', 'A', 'F', 'C', 'G', 'D'], midi: [62, 57, 53, 48, 43, 38] },
  openg: { name: '오픈 G', names: ['d', 'B', 'G', 'D', 'G', 'D'], midi: [62, 59, 55, 50, 43, 38] },
  dadgad: { name: 'DADGAD', names: ['d', 'A', 'G', 'D', 'A', 'D'], midi: [62, 57, 55, 50, 45, 38] }
};

// 운지 문자열은 EADGBe 순(낮은 줄부터). 셀 배열은 e..E(높은 줄부터)라 insertChord에서 뒤집는다.
export const CHORDS = [
  ['C', 'x32010'], ['G', '320003'], ['D', 'xx0232'], ['A', 'x02220'], ['E', '022100'], ['F', '133211'],
  ['Am', 'x02210'], ['Em', '022000'], ['Dm', 'xx0231'], ['Bm', 'x24432'], ['F#m', '244222'], ['Gm', '355333'],
  ['A7', 'x02020'], ['B7', 'x21202'], ['C7', 'x32310'], ['D7', 'xx0212'], ['E7', '020100'], ['G7', '320001'],
  ['Am7', 'x02010'], ['Em7', '022030'], ['Dm7', 'xx0211'], ['Cmaj7', 'x32000'], ['Fmaj7', 'xx3210'], ['Gmaj7', '320002'],
  ['Cadd9', 'x32030'], ['Dsus4', 'xx0233'], ['Asus2', 'x02200'], ['Esus4', '022200'], ['G/B', 'x20003'], ['D/F#', '2x0232']
];

export const MODS = ['h', 'p', 'b', '/', '\\', '~', 'x'];

export const INSTR = {
  acoustic: { name: '어쿠스틱 (스틸)', g: 0.9965, S: 0.45, bright: 0.8, pick: 0.16, len: 3.0 },
  nylon: { name: '클래식 (나일론)', g: 0.994, S: 0.5, bright: 0.35, pick: 0.22, len: 2.6 },
  clean: { name: '일렉 클린', g: 0.998, S: 0.3, bright: 0.6, pick: 0.12, len: 3.5 },
  drive: { name: '일렉 드라이브', g: 0.9985, S: 0.22, bright: 0.5, pick: 0.12, len: 4.0 }
};

export const ZOOMS = ['s', 'm', 'l', 'fit'];
export const THEMES = ['system', 'light', 'dark'];
export const LOOPS = ['none', 'measure', 'line', 'all'];
