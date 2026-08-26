# CLAUDE.md

Gra rytmiczna „click-the-target" nakładana na klip YouTube. Wyłącznie client-side.

**Status:** v1 zaimplementowane, sprite dłoni (dwuwariantowy: idle/hit) + dźwięk trafienia.
Obiekty beatmapy mają wyłącznie `path` (min. 2 punkty `t/x/y/size`, interpolacja liniowa
w silniku) — `path[0].t`/`path[ostatni].t` to spawn/despawn, bez osobnych pól czasowych.
Reka jest klikalna przez cały czas trwania ścieżki: klik w tym oknie = trafienie, brak
kliku do despawnu = pudło. Approach circle i `is-armed` zostały usunięte (ADR-0015).
Pas dawnych kontrolek YouTube pod sceną jest wyrażony w procentach (`8%`), nie w `rem`, więc
pozycja celu jest niezmiennicza względem rozmiaru sceny (ADR-0014); zostaje mimo utraty
uzasadnienia po ADR-0019 (koszt migracji beatmapy).
Kontrolki YouTube są wyłączone (`controls: 0`, `disablekb: 1`) i player nie reaguje na
wskaźnik — całe sterowanie (play/pauza, przewijanie, czas, wyciszenie) idzie przez własny
pasek transportu — pionową kolumnę po prawej stronie sceny, wewnątrz `.frame` (ADR-0023),
więc działa też w zmaksymalizowanej ramce
(ADR-0019, unieważnia mitygację z ADR-0008). Sama blokada wskaźnika **nie ukrywa** brandingu
YouTube'a — poza stanem `PLAYING` player rysuje własny overlay (tytuł, avatar, logo,
miniatury, duży przycisk), którego nie wyłącza żaden `playerVar` (`modestbranding`
i `showinfo` są martwe, `rel: 0` tylko zawęża propozycje). Branding jest widoczny też
**w trakcie odtwarzania**, więc potrzebne są trzy środki naraz: `--player-overscan: 15%`
robi `.player` wyższym niż scena, przez co pasek tytułu i dolny rząd wyjeżdżają poza
`overflow: hidden` (wideo, ograniczone szerokością, zostaje na miejscu — **beatmapa bez
migracji**); Duży przycisk play/pauza na środku **zostaje widoczny** — jest wyśrodkowany razem
z obrazem, a iframe jest cross-origin, więc każdy sposób jego ukrycia (czarna maska,
`backdrop-filter`) ukrywa tam też wideo; oba wdrożono i odrzucono. W zamian jest
klikalny przez `.yt-button-proxy` — przezroczysty przycisk w tym samym miejscu, spięty
z `TransportControls` (zdarzeń nie wpuszczamy do iframe'a, bo pudło obok dłoni znów
pauzowałoby wideo). `.shield` jest przezroczystą, **bezstanową** blokadą wskaźnika —
kadr nie jest już czerniony na pauzie. Letterbox potwierdzony na urządzeniu — obraz nie
jest przybliżony, cele pokrywają się z wideo; w razie czego `--player-overscan: 0%` cofa.
Tryb deweloperski (`npm run dev`, wyłącznie) nagrywa ścieżkę ręki prawym przyciskiem
myszy przy zwolnionym tempie i zapisuje `beatmap.json` na dysku bez przeładowania
strony (ADR-0016); wycięty z buildu produkcyjnego.
Dźwięk trafienia idzie przez Web Audio na zdekodowanym buforze, nie przez `<audio>`
(ADR-0017) — na iOS `<video>` YouTube'a przejmuje sesję audio i wycisza elementy medialne.
Drugi tryb deweloperski pozwala edytować punkty już nagranej ścieżki (przesunięcie,
zmiana `size`) i zapisuje przez ten sam mechanizm co nagrywanie; oba tryby dev dzielą
jedną beatmapę w pamięci (`BeatmapStore`) i wzajemnie się wykluczają (ADR-0018).
`.frame` jest na stałe `position: fixed; inset: 0` — zajmuje cały viewport od pierwszej
klatki strony, bez Fullscreen API i bez gestu użytkownika (ADR-0021, unieważnia
ADR-0010); na dotyku w orientacji pionowej jest dodatkowo obrócona o 90° przez CSS
(`@media (orientation: portrait) and (pointer: coarse)`), żeby wideo zawsze zajmowało
maksimum ekranu bez oczekiwania na fizyczny obrót telefonu.
Dopóki bramka startowa jest widoczna, przycisk play w pasku transportu (i `.yt-button-proxy`)
nie steruje odtwarzaniem, tylko startuje grę tak samo jak klik w bramkę. Bramka nie ma
napisu ani podpowiedzi — jest nią jedna grafika `public/sprites/start-manual.gif`
w klikalnym, przezroczystym przycisku. Ikony transportu to
inline SVG (`ICONS` + `setIcon` w `render.ts`, stan w `data-icon`), nie glify Unicode —
iOS nie ma `❚❚`/`🕪` w foncie i rysował puste kwadraty; ikona dźwięku pokazuje stan
(głośnik / przekreślony), nie akcję przycisku.
Reklamy YouTube (pre-roll/mid-roll) są dla IFrame API nieodróżnialne od filmu, więc
adapter wykrywa je po rozjeździe `getDuration()` z `videoDurationSec` w beatmapie
i melduje silnikowi freeze (`playing: false`) z ostatnim czasem treści zamiast czasu
reklamy — silnik nie wie o reklamach nic (ADR-0022). Brak `videoDurationSec` wyłącza
detekcję i loguje podpowiedź z realną długością.
⚠️ Wykrywanie reklam jeszcze NIE dziala poprawnie — w kodzie siedzi tymczasowa
sonda diagnostyczna (`src/debug-probe.ts`), jedyny kod dev-owy jadacy celowo na
produkcje; instrukcja usuniecia w naglowku tego pliku i w README.
`npm test` — 230 testów, zielone.

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
    types.ts             # Beatmap, PathPoint, GameView, Outcome, Stats, TimeSource
    beatmap.ts           # validateBeatmap
    engine.ts            # maszyna stanów, resync, punktacja
    path.ts              # samplePath — interpolacja pozycji/rozmiaru wzdluz path
  ui/
    render.ts            # stan -> DOM (scena, obiekty, HUD, wynik)
    youtube.ts           # IFrame API + adapter TimeSource
    sound.ts             # pula Audio na dzwiek trafienia (unlock + round-robin)
  dev/                   # tryb deweloperski — wycinany z buildu produkcyjnego (ADR-0016)
    rdp.ts                # simplifyPath — uproszczenie sciezki, metryka czasowa
    record.ts             # czyste funkcje: px<->%, buildPath, insert/removeObject
    recorder.ts           # mountDevRecorder — nasluchy DOM + zapis
    beatmap-write-plugin.ts # plugin Vite (dev-only): POST /__beatmap
    node-shims.d.ts        # minimalny declare module 'node:fs' (brak @types/node)
tests/
  fake-clock.ts          # wstrzykiwane źródło czasu + fabryki beatmap
  engine.test.ts  beatmap.test.ts  path.test.ts  smoke.test.ts  sound.test.ts
  playback-rate.test.ts  rdp.test.ts  dev-record.test.ts  dev-mode.test.ts
public/
  manifest.webmanifest   # PWA — jedyna droga do pelnego ekranu bez paskow Safari (iOS)
  icons/                 # ikony PWA, generowane przez scripts/make-icons.mjs
scripts/
  make-icons.mjs         # proceduralny generator ikon PNG (node:zlib, zero zaleznosci)
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
- **Nowa funkcjonalność albo zmiana zachowania = pokrycie testami.** Jeśli logika
  daje się przetestować bez przeglądarki, testuj jak `engine.test.ts`/`beatmap.test.ts`;
  jeśli dotyczy DOM, testuj jak `smoke.test.ts`.
- **Po każdej implementacji uruchom `npm test` i potwierdź 100% zielone** przed
  zgłoszeniem zadania jako ukończone — również gdy zmiana wydaje się niezwiązana
  z istniejącymi testami.
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
- [ADR-0010 — Pełny ekran obejmuje ramkę gry, nie odtwarzacz](docs/decisions/ADR-0010-pelny-ekran-ramki-gry.md)
- [ADR-0011 — Dwuwariantowy sprite i dźwięk trafienia w warstwie UI](docs/decisions/ADR-0011-dwuwariantowy-sprite-i-dzwiek-trafienia.md)
- [ADR-0012 — Wyrównanie approach circle do treści sprite'a i sygnał „można trafić"](docs/decisions/ADR-0012-wyrownanie-okregu-i-sygnal-uzbrojenia.md)
- [ADR-0013 — Zanikanie okręgu po rozstrzygnięciu i głośność względem YouTube](docs/decisions/ADR-0013-zanikanie-okregu-i-glosnosc-wzgledem-youtube.md)
- [ADR-0014 — Ścieżka ruchu w beatmapie i niezmiennicza geometria](docs/decisions/ADR-0014-sciezka-ruchu-i-niezmiennicza-geometria.md)
- [ADR-0015 — Usunięcie approach circle i pól czasowych obiektu na rzecz path](docs/decisions/ADR-0015-usuniecie-okregu-i-pol-czasowych-obiektu.md)
- [ADR-0016 — Tryb deweloperski nagrywania ścieżki ręki na osi czasu wideo](docs/decisions/ADR-0016-tryb-deweloperski-nagrywania-sciezki.md)
- [ADR-0017 — Dźwięk trafienia przez Web Audio na zdekodowanym buforze](docs/decisions/ADR-0017-dzwiek-przez-web-audio-na-buforze.md)
- [ADR-0018 — Tryb deweloperski edycji punktów ścieżki](docs/decisions/ADR-0018-tryb-deweloperski-edycji-punktow-sciezki.md)
- [ADR-0019 — Własne kontrolki zamiast kontrolek YouTube](docs/decisions/ADR-0019-wlasne-kontrolki-zamiast-kontrolek-youtube.md)
- [ADR-0020 — Ikonowy pasek transportu i automatyczny pełny ekran](docs/decisions/ADR-0020-ikonowy-transport-i-automatyczny-pelny-ekran.md) — punkt 3 unieważniony przez ADR-0021
- [ADR-0021 — Ramka zawsze zmaksymalizowana na viewport bez Fullscreen API](docs/decisions/ADR-0021-zawsze-zmaksymalizowana-ramka-bez-fullscreen-api.md) — unieważnia ADR-0010
- [ADR-0022 — Wykrywanie reklam po długości wideo i zamrażanie gry](docs/decisions/ADR-0022-wykrywanie-reklam-po-dlugosci-wideo.md)
- [ADR-0023 — Pionowy pasek transportu po prawej stronie sceny](docs/decisions/ADR-0023-pionowy-pasek-transportu.md)
