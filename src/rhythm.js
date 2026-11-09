// 드럼 패턴과 스윙. AudioContext와 무관한 순수 함수라 격자 재생기와 전문 TAB 재생기가 같이 쓴다.

/**
 * 드럼 패턴: 칸 i에서 울릴 악기 목록. BEAT = 한 박의 칸 수, slots = 한 마디 칸 수.
 *  rock: 하이햇 8분, 킥 홀수 박, 스네어 짝수 박
 *  pop: rock + 3박 뒷박에 킥 하나 더
 *  ballad: 하프타임. 하이햇 박마다, 킥 1박, 스네어 3박
 */
export function drumHits(style, i, BEAT, slots) {
  if (!style || style === 'off') return [];
  const beat = Math.floor(i / BEAT), sub = i % BEAT, beats = slots / BEAT, hits = [];
  const half = Math.floor(BEAT / 2);
  if (style === 'ballad') {
    if (sub === 0 || sub === half) hits.push(sub === 0 ? 'hat!' : 'hat');
    if (beat === 0 && sub === 0) hits.push('kick');
    if (beats >= 3 && beat === Math.floor(beats / 2) && sub === 0) hits.push('snare');
    else if (beats < 3 && beat === 1 && sub === 0) hits.push('snare');
    return hits;
  }
  if (i % 2 === 0) hits.push(sub === 0 ? 'hat!' : 'hat');
  if (sub === 0) hits.push(beat % 2 === 0 ? 'kick' : 'snare');
  if (style === 'pop' && beat === 2 && sub === half && BEAT >= 4) hits.push('kick');
  return hits;
}

/** 스윙: 홀수 16분음표를 한 칸 길이의 swing 비율만큼 늦춘다 */
export function swingDelay(i, swing, dur) { return (swing > 0 && i % 2 === 1) ? swing * dur : 0; }

/**
 * 박자표 → 한 박의 16분음표 칸 수. 4분 계열은 4칸, 8분 계열은 2칸, 복합 박자(6/8·12/8)는 점4분 = 6칸.
 */
export function beatSlots(beats, beatType) {
  if (beatType === 8) return beats % 3 === 0 && beats >= 6 ? 6 : 2;
  if (beatType === 2) return 8;
  return 4;
}
