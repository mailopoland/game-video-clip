import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // GitHub Pages serwuje z podsciezki /<nazwa-repo>/ (ADR-0007).
  // Dev server dziala z korzenia, wiec podsciezke ustawiamy tylko przy buildzie.
  base: command === 'build' ? '/game-video-clip/' : '/',
  server: {
    // YouTube odmawia osadzenia, gdy Referer jest golym adresem IP ("Film
    // niedostepny") — nazwa hosta jest akceptowana. Testujac na telefonie w LAN
    // wchodzimy wiec przez nazwe (mDNS `<host>.local` albo wildcard DNS
    // `<ip-z-myslnikami>.nip.io`), a nie przez `http://192.168.x.y`.
    // Vite od 6.0.9 odrzuca nieznany naglowek Host, stad ta lista.
    allowedHosts: ['.local', '.nip.io', '.sslip.io'],
  },
  test: {
    // Logika gry nie potrzebuje DOM (ADR-0006); jsdom wlacza tylko test smoke,
    // przez docblock `@vitest-environment jsdom`.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
