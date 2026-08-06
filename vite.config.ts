import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // GitHub Pages serwuje z podsciezki /<nazwa-repo>/ (ADR-0007).
  // Dev server dziala z korzenia, wiec podsciezke ustawiamy tylko przy buildzie.
  base: command === 'build' ? '/game-video-clip/' : '/',
  test: {
    // Logika gry nie potrzebuje DOM (ADR-0006); jsdom wlacza tylko test smoke,
    // przez docblock `@vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
