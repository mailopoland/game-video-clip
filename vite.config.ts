import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serwuje z podsciezki /<nazwa-repo>/ (ADR-0007).
  base: process.env.GITHUB_ACTIONS ? '/game-video-clip/' : '/',
  test: {
    // Logika gry nie potrzebuje DOM (ADR-0006); jsdom wlacza tylko test smoke,
    // przez docblock `@vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
