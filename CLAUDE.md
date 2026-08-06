# CLAUDE.md

Gra rytmiczna „click-the-target" nakładana na klip YouTube. Wyłącznie client-side.

**Status:** v1 zaimplementowane. `npm test` — 34 testy, zielone.

## ⛔ Zanim cokolwiek zrobisz: przeczytaj README.md

**[`README.md`](README.md) jest źródłem prawdy o działaniu aplikacji.** Opisuje model
czasu, maszynę stanów celu, semantykę przewijania, format beatmapy i strukturę DOM —
czyli rzeczy, których nie da się bezpiecznie odgadnąć z samego kodu.

1. **Przeczytaj `README.md` w całości przed wykonaniem jakiegokolwiek promptu** —
   przed edycją kodu, przed odpowiadaniem na pytania o aplikację, przed planowaniem.
   Nie zaczynaj od czytania plików źródłowych.
2. **Aktualizuj `README.md` w tym samym commicie, w którym zmieniasz zachowanie,
   które on opisuje.** README musi zawsze odzwierciedlać aktualny stan projektu.

Zmiana wymaga aktualizacji README, jeśli dotyka któregokolwiek z poniższych:

- model czasu, freeze, `resync`, stałe `SEEK_THRESHOLD_SEC` / `FADE_OUT_MS`
- maszyna stanów celu, reguły trafienia/pudła, sposób liczenia punktów i celności
- schemat `beatmap.json`, reguły `validateBeatmap`, rejestr `SPRITES`
- struktura DOM sceny, sposób obsługi wejścia, zachowanie na mobile
- lista zależności, komendy, konfiguracja builda lub hostingu
- lista testów albo znanych ograniczeń / rzeczy niezweryfikowanych

Jeśli zmiana jest czysto kosmetyczna (refaktor bez zmiany zachowania, literówka,
formatowanie) — README zostaw w spokoju.

Nowa **istotna decyzja** to nadal osobny ADR + link w sekcji „Decyzje architektoniczne"
poniżej **oraz** w tabeli decyzji w README.

## Stack

- **Vanilla TypeScript + Vite** (brak frameworka UI)
- **Rendering: DOM + CSS** (bez canvas)
- **Testy: Vitest + jsdom + @testing-library/dom**
- **Hosting: GitHub Pages** (statyczny build Vite)
- Zależności produkcyjne: **zero**. Dev: `vite`, `typescript`, `vitest`, `jsdom`,
  `@testing-library/dom`. **Dodanie czegokolwiek poza tą listą wymaga zapytania.**
- `jsdom` przypięty do `^25` — wersja 27 wymaga `require(ESM)`, czyli Node ≥ 20.19.
  Po podniesieniu Node można odpiąć.

## Struktura projektu

```
README.md                # ŹRÓDŁO PRAWDY o działaniu aplikacji — czytaj najpierw
index.html               # szkielet strony
src/
  main.ts                # bootstrap: YouTube + montaż gry + pętla rAF
  game.ts                # spięcie silnika z DOM (używane też przez test smoke)
  styles.css
  sprites.ts             # rejestr sprite'ów — jedyne miejsce znające assety
  data/beatmap.json      # TIMELINE — dane, nie kod
  engine/
    types.ts             # Beatmap, GameView, Outcome, Stats, TimeSource
    beatmap.ts           # validateBeatmap
    engine.ts            # maszyna stanów, resync, punktacja
  ui/
    render.ts            # stan -> DOM (scena, obiekty, HUD, wynik)
    youtube.ts           # IFrame API + adapter TimeSource
tests/
  fake-clock.ts          # wstrzykiwane źródło czasu + fabryki beatmap
  engine.test.ts  beatmap.test.ts  smoke.test.ts
docs/
  PLAN.md                # plan wdrożenia v1 + research ograniczeń YouTube API
  DEPLOY.md              # publikacja na GitHub Pages
  decisions/ADR-*.md
.github/workflows/deploy.yml
```

## Komendy

| Komenda | Do czego |
|---|---|
| `npm run dev` | dev server Vite (HMR) |
| `npm run build` | statyczny build do `dist/` |
| `npm run preview` | podgląd builda lokalnie |
| **`npm test`** | **Vitest — jedyna komenda potrzebna do weryfikacji regresji. Musi być zielona w 100%.** |
| deploy | ręcznie, wg [`docs/DEPLOY.md`](docs/DEPLOY.md) — nigdy automatycznie |

Wymaga Node ≥ 20.17.

## Zasady pracy

- **Timeline to dane.** Zmiana rozgrywki = zmiana `src/data/beatmap.json`, nie kodu.
  ⚠️ Czasy w obecnej beatmapie i `endScreenAtSec` są **wartościami roboczymi** —
  wymagają dostrojenia do rytmu i długości realnego klipu.
- **Silnik nie zna YouTube ani DOM.** `engine.ts` przyjmuje `TimeSource`; dzięki temu
  testy używają fake clocka i nie potrzebują sieci.
- **Wynik jest funkcją `Map<objectId, Outcome>`**, nigdy inkrementowanym licznikiem —
  dzięki temu seek nie może wygenerować podwójnych punktów.
- **Czas wideo jest jedynym źródłem prawdy.** Żadnych `setTimeout`/`setInterval`
  sterujących rozgrywką.
- Brak backendu, kont, zapisu wyników, analityki. Brak abstrakcji „na przyszłość".
- **`README.md` idzie w tym samym commicie co zmiana zachowania**, którą opisuje
  (szczegóły w sekcji na górze tego pliku).
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
