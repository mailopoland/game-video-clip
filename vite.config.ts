import { defineConfig } from 'vitest/config';
import { beatmapWritePlugin } from './src/dev/beatmap-write-plugin.js';

export default defineConfig(({ command }) => {
  // Wymuszamy NODE_ENV zgodny z komenda, zamiast polegac na tym, co juz jest
  // w srodowisku: Vite uzywa `process.env.NODE_ENV ||=`, wiec ambientowe
  // NODE_ENV=development (np. z powloki dewelopera) inaczej przetrwaloby
  // `vite build` i uniemozliwilo eliminacje martwego kodu `import.meta.env.DEV`
  // — kod trybu deweloperskiego (src/dev/*) trafilby do bundla produkcyjnego,
  // co jest niedopuszczalne (ADR-0016, krok 9 weryfikacji).
  (globalThis as { process?: { env: Record<string, string> } }).process!.env.NODE_ENV =
    command === 'build' ? 'production' : 'development';

  return {
    // GitHub Pages serwuje z podsciezki /<nazwa-repo>/ (ADR-0007).
    // Dev server dziala z korzenia, wiec podsciezke ustawiamy tylko przy buildzie.
    base: command === 'build' ? '/game-video-clip/' : '/',
    // Endpoint zapisu beatmapy dla trybu dev (ADR-0016) — nigdy w buildzie.
    // `apply: 'serve'` w pluginie to pierwsze zabezpieczenie, to drugie.
    plugins: command === 'serve' ? [beatmapWritePlugin()] : [],
    build: {
      // Build produkcyjny nie ma dynamicznych importow (src/dev/* jest wycinane
      // przez import.meta.env.DEV), wiec Vite nie emituje zadnego <link
      // rel=modulepreload> — polyfill bylby martwym kodem w kazdym bundlu.
      modulePreload: { polyfill: false },
    },
    // Beatmapa (~28 kB) trafia do bundla jako `JSON.parse('...')`, nie jako
    // literal obiektowy JS — parser JSON jest wyraznie szybszy od parsera JS
    // przy takiej ilosci danych, co widac na starcie na telefonie.
    json: { stringify: true },
    server: {
      // YouTube odmawia osadzenia, gdy Referer jest golym adresem IP ("Film
      // niedostepny") — nazwa hosta jest akceptowana. Testujac na telefonie
      // wchodzimy wiec przez nazwe (mDNS `<host>.local`, tunel ngrok itp.),
      // a nie przez `http://192.168.x.y`. Vite od 6.0.9 odrzuca nieznany
      // naglowek Host, stad `allowedHosts: true` — to dev-only serwer.
      allowedHosts: true,
    },
    test: {
      // Logika gry nie potrzebuje DOM (ADR-0006); jsdom wlacza tylko test smoke,
      // przez docblock `@vitest-environment jsdom`.
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
