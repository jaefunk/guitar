import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

describe('product documentation consistency', () => {
  it('describes the current desktop MusicXML product in package metadata', () => {
    const description = JSON.parse(read('package.json')).description;
    expect(description).toMatch(/데스크톱/);
    expect(description).toMatch(/MusicXML 4\.0/);
    expect(description).toMatch(/전문 TAB/);
    expect(description).toMatch(/레거시 빠른 격자/);
  });

  it('keeps mobile and v3 statements inside legacy migration context', () => {
    const readme = read('README.md');
    const handoff = read('HANDOFF.md');
    expect(handoff).toContain('모바일은 현재 제품 범위 밖');
    expect(handoff).toContain('현재 저장 키는 `gtab-editor-v4`');
    expect(handoff).toContain('`gtab-editor-v3`는 삭제하지 않는 마이그레이션 원본');
    expect(handoff).not.toContain('폰 세로 화면 우선');
    expect(handoff).not.toContain('localStorage 키는 `gtab-editor-v3`');
    expect(`${readme}\n${handoff}`).not.toMatch(/75마디|75-measure/);
  });
});
