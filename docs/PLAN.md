# Plan wdrożenia v1

Gra rytmiczna „click-the-target" nad klipem YouTube (`Iz-nC59AIWc`).

---

## 1. Ograniczenia YouTube IFrame Player API istotne dla tej gry

Poniższe spisano z wiedzy własnej — **w tym projekcie nie wykonywano requestów
sieciowych**, więc nic nie zostało zweryfikowane wobec bieżącej dokumentacji.
Punkty niepewne oznaczono `[do weryfikacji]`.

### 1.1 Czas odtwarzania

- **Pewne:** `player.getCurrentTime()` zwraca liczbę zmiennoprzecinkową (sekundy)
  i jest wywołaniem **synchronicznym** — API utrzymuje po stronie strony-hosta
  kopię stanu odtwarzacza aktualizowaną komunikatami `postMessage` z iframe.
  Wywoływanie go co klatkę jest tanie.
- **Pewne:** wartość **nie odświeża się co klatkę**. Odczyty w kolejnych klatkach
  `requestAnimationFrame` potrafią zwrócić tę samą liczbę. Efektywna ziarnistość
  jest grubsza niż 16 ms.
- `[do weryfikacji]` Dokładna częstotliwość aktualizacji (rzędu setek ms) — zależy
  od wersji playera i przeglądarki. **Nie opieramy na niej żadnej stałej**; kod
  interpoluje i wykrywa rozjazd (zob. [ADR-0003](decisions/ADR-0003-zrodlo-czasu-i-maszyna-stanow.md)).
- **Pewne:** **nie istnieje zdarzenie per-frame** ani odpowiednik `timeupdate`
  z `<video>`. Jedyne zdarzenia to `onReady`, `onStateChange`, `onError`,
  `onPlaybackQualityChange`, `onPlaybackRateChange`.
- **Pewne:** **nie istnieje zdarzenie „seek"**. Przewinięcie trzeba wykryć samemu,
  porównując odczyt z przewidywaniem.

**Wniosek dla gry:** czas wideo jest źródłem prawdy, ale musi być interpolowany
między odczytami, a każdy rozjazd > progu traktowany jako seek → `resync()`.

### 1.2 Stany odtwarzacza

- **Pewne:** `getPlayerState()` / `onStateChange` zwracają: `-1` unstarted,
  `0` ended, `1` playing, `2` paused, `3` buffering, `5` video cued.
- **Pewne:** `3 BUFFERING` pojawia się także **w środku** odtwarzania i po każdym
  seeku. Dla gry `1 PLAYING` jest **jedynym** stanem, w którym czas płynie —
  wszystko inne = zamrożenie.
- **Pewne:** `onStateChange` przychodzi z opóźnieniem względem realnej zmiany
  (komunikacja przez `postMessage`), więc **nie może** być jedynym sygnałem
  zamrożenia. Pętla i tak sprawdza stan przy każdym odczycie czasu.

### 1.3 Start, opóźnienia, reklamy

- **Pewne:** załadowanie `https://www.youtube.com/iframe_api` jest asynchroniczne;
  API sygnalizuje gotowość globalnym `onYouTubeIframeAPIReady`, a konkretny player
  — zdarzeniem `onReady`. Do `onReady` żadne metody playera nie są dostępne.
- **Pewne:** między `playVideo()` a faktycznym `PLAYING` mija niezerowy, zmienny
  czas (buforowanie). Dlatego gra startuje na `PLAYING`, nie na kliknięciu
  (zob. [ADR-0009](decisions/ADR-0009-start-gate-i-mobile-first.md)).
- **Pewne:** przed/w trakcie filmu mogą pojawić się reklamy; API **nie udostępnia**
  zdarzeń reklamowych ani sposobu ich pominięcia lub zasłonięcia.
- `[do weryfikacji]` Jak dokładnie zachowują się `getPlayerState()` i
  `getCurrentTime()` w trakcie reklamy (czy stan to `PLAYING`, a czas dotyczy
  reklamy czy głównego wideo). **Wymaga testu ręcznego na realnym wideo** —
  ujęte w checkliście, krok 15.

### 1.4 Autoplay z dźwiękiem na mobile

- **Pewne:** to ograniczenie **przeglądarki**, nie YouTube. Odtwarzanie z dźwiękiem
  wymaga gestu użytkownika (iOS Safari, Chrome na Android, także desktopowy Chrome).
  Autoplay bez gestu działa tylko dla materiału wyciszonego.
- **Pewne:** parametr `autoplay=1` nie omija tej reguły.
- **Konsekwencja:** bramka startowa „Graj" jest wymuszona technicznie, nie jest
  decyzją estetyczną.

### 1.5 Zgodność z YouTube Terms of Service — ⚠️ ryzyko

Nakładanie klikalnych elementów na odtwarzacz jest **w mojej ocenie niezgodne**
z YouTube API Services — Developer Policies (zakaz zasłaniania i modyfikowania
odtwarzacza, wymóg jego pełnej widoczności, zakaz zasłaniania reklam).
Pełna analiza, wariant zgodny (pole gry **wokół** playera) i decyzja warunkowa:
**[ADR-0008](decisions/ADR-0008-overlay-a-youtube-tos.md)** — wymaga potwierdzenia
przed Fazą 2.

---

## 2. Wybrany stack (jawnie)

| Warstwa | Wybór | ADR |
|---|---|---|
| Framework | **brak** — vanilla DOM | [ADR-0001](decisions/ADR-0001-brak-frameworka-vite-typescript.md) |
| Język | **TypeScript** | [ADR-0001](decisions/ADR-0001-brak-frameworka-vite-typescript.md) |
| Build / dev server | **Vite** | [ADR-0001](decisions/ADR-0001-brak-frameworka-vite-typescript.md) |
| Rendering | **DOM + CSS** | [ADR-0002](decisions/ADR-0002-rendering-dom-css.md) |
| Źródło czasu | `getCurrentTime()` + interpolacja + detekcja seeka | [ADR-0003](decisions/ADR-0003-zrodlo-czasu-i-maszyna-stanow.md) |
| Beatmapa | **JSON** (`src/data/beatmap.json`) | [ADR-0004](decisions/ADR-0004-beatmapa-jako-dane-json.md) |
| Assety | placeholdery CSS/SVG w v1; docelowo **animowany WebP** | [ADR-0005](decisions/ADR-0005-format-assetow-i-placeholdery.md) |
| Testy | **Vitest** + jsdom + @testing-library/dom | [ADR-0006](decisions/ADR-0006-testy-vitest-fake-clock.md) |
| Hosting | **GitHub Pages** | [ADR-0007](decisions/ADR-0007-hosting-github-pages.md) |

**Pełna lista zależności (tylko dev, zero produkcyjnych):**
`vite`, `typescript`, `vitest`, `jsdom`, `@testing-library/dom`.
Cokolwiek poza tą listą wymaga zapytania.

---

## 3. Model danych

Zob. [ADR-0004](decisions/ADR-0004-beatmapa-jako-dane-json.md). Typy w `src/engine/types.ts`:

```ts
export interface BeatmapObject {
  id: string;          // unikalny, stabilny — klucz wyników przy seeku
  time: number;        // s, moment trafienia
  duration: number;    // ms fazy approach (obiekt pojawia się w time - duration)
  x: number;           // % szerokości sceny, środek
  y: number;           // % wysokości sceny, środek
  sprite: string;      // klucz w SPRITES
  hitWindowMs: number; // +/- wokół time
}
export interface Beatmap { videoId: string; objects: BeatmapObject[] }

export type Outcome = 'hit' | 'miss' | 'skipped';
export type ObjectPhase = 'pending' | 'active' | 'resolved';

export interface GameState {
  timeSec: number;
  frozen: boolean;
  results: Map<string, Outcome>;   // jedyne źródło punktacji
}
export interface Stats { score: number; hits: number; misses: number; accuracy: number }
```

---

## 4. Struktura plików (docelowa, minimalna)

```
index.html
vite.config.ts
tsconfig.json
package.json
src/
  main.ts              # bootstrap: player + engine + renderer
  styles.css
  sprites.ts           # rejestr sprite'ów (ADR-0005)
  data/beatmap.json    # timeline (ADR-0004)
  engine/
    types.ts
    beatmap.ts         # validateBeatmap
    engine.ts          # pętla, maszyna stanów, resync, punktacja (ADR-0003)
  ui/
    render.ts          # stan -> DOM
    youtube.ts         # ładowanie IFrame API, adapter TimeSource
tests/
  engine.test.ts
  beatmap.test.ts
  smoke.test.ts
docs/
  PLAN.md  DEPLOY.md  decisions/ADR-*.md
CLAUDE.md
```

---

## 5. Kroki wdrożenia (Faza 2)

Każdy krok kończy się osobnym commitem i linią `✅`.

| # | Krok | Sprawdzalne kryterium |
|---|---|---|
| 1 | `npm init`, instalacja 5 zależności z sekcji 2, `tsconfig.json`, `vite.config.ts`, skrypty `dev`/`build`/`preview`/`test` | `npm run build` przechodzi na pustym `index.html` |
| 2 | `src/engine/types.ts` + `src/data/beatmap.json` z 8 obiektami | plik JSON parsuje się i typuje bez błędów |
| 3 | `src/engine/beatmap.ts` — `validateBeatmap` | testy z ADR-0006 pkt 8 zielone |
| 4 | `src/engine/engine.ts` — `TimeSource`, spawn, hit/miss, freeze | testy pkt 1–4 zielone |
| 5 | `resync()` — seek w tył i w przód | testy pkt 5–6 zielone |
| 6 | agregacja `Stats` (score/hits/misses/accuracy) | test pkt 7 zielony |
| 7 | `src/sprites.ts` + placeholdery CSS/SVG | rejestr zawiera ≥2 sprite'y, brak plików binarnych |
| 8 | `src/ui/render.ts` — scena 16:9, obiekty, approach circle, HUD | test smoke renderuje scenę |
| 9 | wejście `pointerdown` + `touch-action: manipulation`, feedback „+1" / „X" | test smoke: tap na obiekcie → punkt |
| 10 | ekran wyniku (punkty / trafienia / pudła / celność) na `ENDED` | test jednostkowy stanu końcowego |
| 11 | `src/ui/youtube.ts` — ładowanie API, `onReady`, `onStateChange`, adapter `TimeSource` | `npm run dev` — wideo startuje po kliknięciu „Graj" |
| 12 | `src/main.ts` — spięcie całości + bramka startowa (ADR-0009) | gra przechodzi cały klip |
| 13 | `npm test` zielone w 100%, komenda opisana w `CLAUDE.md` | `npm test` → 0 failed |
| 14 | `docs/DEPLOY.md` + workflow GitHub Pages (bez uruchamiania deployu) | plik istnieje, `base` ustawione w `vite.config.ts` |
| 15 | **Ręczna checklista weryfikacyjna** (poniżej) | wszystkie punkty odhaczone |

### Checklista ręczna (krok 15 — nie da się zautomatyzować bez realnego playera)

- [ ] 375 px szerokości: scena mieści się, obiekty klikalne palcem, brak zoomu przy double-tap
- [ ] 1440 px szerokości: scena skalowana, pozycje obiektów identyczne względnie
- [ ] pion i poziom na telefonie — scena nie wyjeżdża poza ekran
- [ ] **pauza** → obiekty zamierają, approach circle stoi, kliknięcia nic nie robią
- [ ] **bufferowanie** (throttling sieci) → jak wyżej
- [ ] **seek do tyłu** → wcześniejsze obiekty grywalne od nowa, wynik nie rośnie podwójnie
- [ ] **seek do przodu** → brak lawiny pudeł, licznik celności nienaruszony
- [ ] koniec klipu → ekran wyniku z poprawnymi liczbami
- [ ] zachowanie w trakcie reklamy (uzupełnia `[do weryfikacji]` z sekcji 1.3)

---

## 6. Świadomie poza zakresem v1

Leaderboard, konta, zapis wyników, dźwięki gry, edytor beatmap, tryb ciemny,
combo/mnożniki, wsparcie dla `playbackRate` ≠ 1, sprite sheety, i18n.
