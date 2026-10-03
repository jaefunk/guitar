import { defineConfig } from 'vite';

export default defineConfig({
  // 하위 경로(예: GitHub Pages)에 올려도 자산 경로가 깨지지 않도록 상대 경로 사용
  base: './',
  build: { target: 'es2017', outDir: 'dist' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});
