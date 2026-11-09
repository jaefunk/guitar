import { defineConfig } from 'vite';

export default defineConfig({
  // 하위 경로(예: GitHub Pages)에 올려도 자산 경로가 깨지지 않도록 상대 경로 사용
  base: './',
  build: { target: 'es2017', outDir: 'dist' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // 내장 77마디 악보 파싱 테스트가 느린 러너에서 5초를 넘길 수 있다
    testTimeout: 20000
  }
});
