# CLAUDE.md

Gra rytmiczna „click-the-target" nakładana na klip YouTube. Wyłącznie client-side.

**Status:** Faza 1 (plan i decyzje) ukończona. Faza 2 (implementacja) nierozpoczęta —
struktura poniżej opisuje stan docelowy v1.

## Stack

- **Vanilla TypeScript + Vite** (brak frameworka UI)
- **Rendering: DOM + CSS** (bez canvas)
- **Testy: Vitest + jsdom + @testing-library/dom**
- **Hosting: GitHub Pages** (statyczny build Vite)
- Zależności produkcyjne: **zero**. Dev: `vite`, `typescript`, `vitest`, `jsdom`,
  `@testing-library/dom`. **Dodanie czegokolwiek poza tą listą wymaga zapytania.**

## Struktura projektu

```
index.html               # scena + bramka startowa
src/
  main.ts                # bootstrap: player + engine + renderer
  styles.css
  sprites.ts             # rejestr sprite'ów — jedyne miejsce znające assety
  data/beatmap.json      # TIMELINE — dane, nie kod
  engine/
    types.ts             # Beatmap, GameState, Outcome, Stats
    beatmap.ts           # validateBeatmap
    engine.ts            # pętla, maszyna stanów, resync, punktacja
  ui/
    render.ts            # stan -> DOM
    youtube.ts           # IFrame API + adapter TimeSource
tests/                   # engine.test.ts, beatmap.test.ts, smoke.test.ts
docs/
  PLAN.md                # plan wdrożenia v1 + research ograniczeń YouTube API
  DEPLOY.md              # publikacja na GitHub Pages
  decisions/ADR-*.md
```

## Komendy

| Komenda | Do czego |
|---|---|
| `npm run dev` | dev server Vite (HMR) |
| `npm run build` | statyczny build do `dist/` |
| `npm run preview` | podgląd builda lokalnie |
| **`npm test`** | **Vitest — jedyna komenda potrzebna do weryfikacji regresji. Musi być zielona w 100%.** |
| deploy | ręcznie, wg `docs/DEPLOY.md` — nigdy automatycznie |

## Zasady pracy

- **Timeline to dane.** Zmiana rozgrywki = zmiana `src/data/beatmap.json`, nie kodu.
- **Silnik nie zna YouTube ani DOM.** `engine.ts` przyjmuje `TimeSource`; dzięki temu
  testy używają fake clocka i nie potrzebują sieci.
- **Wynik jest funkcją `Map<objectId, Outcome>`**, nigdy inkrementowanym licznikiem —
  dzięki temu seek nie może wygenerować podwójnych punktów.
- **Czas wideo jest jedynym źródłem prawdy.** Żadnych `setTimeout`/`setInterval`
  sterujących rozgrywką.
- Brak backendu, kont, zapisu wyników, analityki. Brak abstrakcji „na przyszłość".
- Małe commity z opisowymi wiadomościami. **Nigdy `git push` ani deploy bez pytania.**
- Assety: **nie pobieramy niczego z internetu.**
- Po ukończonym kroku: jedna linia `✅ [co zrobione]`.

## Decyzje architektoniczne

**Zasada: każda nowa istotna decyzja = nowy plik ADR w `docs/decisions/` + link poniżej.**

- [ADR-0001 — Brak frameworka UI: Vite + TypeScript (vanilla DOM)](docs/decisions/ADR-0001-brak-frameworka-vite-typescript.md)
- [ADR-0002 — Rendering w DOM + CSS zamiast canvas](docs/decisions/ADR-0002-rendering-dom-css.md)
- [ADR-0003 — Źródło czasu, pętla gry i maszyna stanów obiektu](docs/decisions/ADR-0003-zrodlo-czasu-i-maszyna-stanow.md)
- [ADR-0004 — Beatmapa jako osobny plik danych JSON](docs/decisions/ADR-0004-beatmapa-jako-dane-json.md)
- [ADR-0005 — Format assetów i placeholdery proceduralne](docs/decisions/ADR-0005-format-assetow-i-placeholdery.md)
- [ADR-0006 — Testy: Vitest + jsdom, logika na wstrzykiwanym zegarze](docs/decisions/ADR-0006-testy-vitest-fake-clock.md)
- [ADR-0007 — Hosting statyczny: GitHub Pages](docs/decisions/ADR-0007-hosting-github-pages.md)
- [ADR-0008 — ⚠️ Warstwa gry nad playerem a YouTube ToS](docs/decisions/ADR-0008-overlay-a-youtube-tos.md) — **ryzyko zgodności, decyzja warunkowa**
- [ADR-0009 — Bramka startowa i podejście mobile-first](docs/decisions/ADR-0009-start-gate-i-mobile-first.md)
