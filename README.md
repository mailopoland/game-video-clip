# Click the target — gra rytmiczna na klipie YouTube

Prosta gra rytmiczna nałożona na odtwarzany klip z YouTube. W momentach zapisanych
w beatmapie pojawiają się klikalne cele z kurczącym się okręgiem (approach circle).
Trafienie w oknie tolerancji daje punkt, spóźnienie lub klik poza oknem — pudło.
Na końcu klipu pokazuje się ekran wyniku.

Wyłącznie client-side: bez backendu, kont, zapisu wyników i analityki.

> **Ten plik jest źródłem kontekstu o działaniu aplikacji.** Musi zawsze odzwierciedlać
> aktualny stan kodu — każda zmiana wpływająca na opisane tu zachowanie wymaga
> aktualizacji README w tym samym commicie.

---

## Uruchomienie

```bash
npm ci
npm run dev     # http://localhost:5173/
npm test        # 46 testów, ~1 s, bez sieci — jedyna komenda weryfikacji regresji
npm run build   # tsc --noEmit + vite build -> dist/
```

Wymaga Node ≥ 20.17.

### Test na telefonie w tej samej sieci

```bash
npm run dev -- --host
```

⚠️ **Wejdź przez nazwę hosta, nie przez `http://192.168.x.y:5173`.** YouTube odmawia
osadzenia, gdy `Referer` jest gołym adresem IP — player pokazuje wtedy „Film
niedostępny", mimo że na `localhost` ten sam klip działa. Sprawdzone: `127.0.0.1`
i adresy LAN są blokowane (także po https), a `localhost`, `<host>.local` oraz
`<ip-z-myślnikami>.nip.io` przechodzą.

Działające warianty: `http://<nazwa-komputera>.local:5173/` (mDNS, iOS obsługuje
natywnie) albo `http://192-168-0-94.nip.io:5173/`. Oba hosty są dopuszczone
w `server.allowedHosts` w `vite.config.ts` — Vite od 6.0.9 odrzuca nieznany `Host`.

---

## Stack

Vanilla **TypeScript + Vite**, rendering w **DOM + CSS** (bez canvas), testy w
**Vitest + jsdom**, hosting **GitHub Pages**. Zależności produkcyjne: **zero**.

Uzasadnienia w `docs/decisions/` — patrz sekcja [Decyzje](#decyzje).

---

## Jak to działa — przepływ

```
YouTube IFrame API
      │  getCurrentTime() + getPlayerState()
      ▼
src/ui/youtube.ts ──── implementuje TimeSource ────┐
                                                   ▼
                                          src/engine/engine.ts
                                          (stan gry, punktacja)
                                                   │ GameView
                                                   ▼
                                          src/ui/render.ts ──> DOM
                                                   ▲
                                          pointerdown na celu
                                                   │
                                          src/game.ts (spina to w pętlę)
```

**Kluczowa zasada:** silnik nie zna ani YouTube, ani DOM. Dostaje czas przez interfejs
`TimeSource` i zwraca `GameView` do wyrenderowania. Dzięki temu testy podstawiają fake
clock i grają całą grę bez przeglądarki i bez sieci.

`src/main.ts` uruchamia pętlę `requestAnimationFrame`, w której każda klatka to
`engine.tick()` → `ui.render(engine.getView())`.

---

## Model czasu — sedno projektu

Cała rozgrywka jest sterowana **wyłącznie** czasem odtwarzania wideo. Nie ma żadnego
`setTimeout` ani `setInterval` sterującego grą.

### Dlaczego to nie jest trywialne

YouTube IFrame API ma trzy ograniczenia, wokół których zbudowany jest silnik:

1. `getCurrentTime()` **nie odświeża się co klatkę** — kolejne odczyty w `rAF` potrafią
   zwrócić tę samą wartość. Bez zaradzenia approach circle by się zacinał.
2. **Nie ma zdarzenia per-frame** ani odpowiednika `timeupdate`.
3. **Nie ma zdarzenia „seek"** — przewinięcie trzeba wykryć samemu.

### Rozwiązanie (`Engine.tick`, `src/engine/engine.ts`)

Każda klatka pobiera `TimeSource.sample()` → `{ timeSec, playing, ended }` i:

- **`playing === false`** (pauza, buffering, cued, ended) → **freeze**: czas gry nie
  płynie, nic nie spawnuje, nic nie jest oceniane, kliknięcia są ignorowane.
  `PLAYING` to jedyny stan playera, w którym gra żyje.
- **wznowienie po freeze** → adoptujemy odczyt bez przewidywania (brak wiarygodnego
  punktu odniesienia dla zegara ściennego), z resyncem jeśli w międzyczasie ktoś przewinął.
- **normalne odtwarzanie** → porównujemy odczyt z przewidywaniem
  `timeSec + Δ(performance.now())`:
  - rozjazd > **`SEEK_THRESHOLD_SEC = 0.35`** → to przewinięcie → `resync()`;
  - inaczej `timeSec = max(odczyt, przewidywanie)` — interpolacja wygładza ziarnistość
    `getCurrentTime()` i nigdy nie cofa czasu o szum odczytu.

Zegar ścienny wchodzi przez wstrzykiwany `now()` (domyślnie `performance.now()`), więc
testy sterują nim ręcznie.

---

## Maszyna stanów celu

```
pending  ──(t ≥ time − duration)──▶  active
active   ──(klik w [time−hw, time+hw])──▶  hit
active   ──(klik poza oknem)──▶  miss
active   ──(t > time + hw, brak kliku)──▶  miss
(seek do przodu)  ──▶  skipped
```

- `duration` (ms) = **faza approach**: cel pojawia się w `time − duration`, a okrąg
  kurczy się do zera dokładnie w `time`.
- `hitWindowMs` = tolerancja ± wokół `time`.
- Po rozstrzygnięciu cel zostaje na ekranie jeszcze **`FADE_OUT_MS = 500`** — tyle trwa
  animacja `+1` / `✕`.
- Klik w cel, który jeszcze nie spawnował, jest **ignorowany** (nie tworzy pudła).
- Drugi klik w ten sam cel nic nie zmienia.

Stany nie są mutowane w miejscu — są wyliczane z beatmapy i mapy wyników przy każdym
`getView()`.

---

## Przewijanie i punktacja

To jest miejsce, w którym gra spełnia wymaganie „żadnych duchów ani podwójnych punktów".

**Punktacja jest funkcją mapy `Map<objectId, { outcome, atSec }>`, nie licznikiem.**
Nie ma żadnego `score++`. Dzięki temu ponowne zagranie fragmentu **nadpisuje** wynik
zamiast go dodawać — podwójne punktowanie jest niemożliwe konstrukcyjnie, a nie dzięki
uważności.

`resync(T)` — jedyne miejsce obsługujące przewijanie:

| Sytuacja | Zachowanie |
|---|---|
| **Seek w tył** | Wyniki celów o `time ≥ T` są **usuwane** → fragment można zagrać od nowa. Wyniki celów pozostających w przeszłości zostają nietknięte. |
| **Seek w przód** | Cele, którym całe okno minęło przed `T`, dostają `skipped` → **zero fałszywych pudeł**. |
| **Seek w trakcie pauzy** | Też resynchronizuje — ekran pokazuje prawdę, ale nic nie jest oceniane. |

`skipped` **nie wchodzi do mianownika celności** i nie jest renderowany (brak „duchów").

Statystyki (`getStats()`): `score` = liczba trafień, `hits`, `misses`,
`accuracy = hits / (hits + misses) × 100` (0 gdy nic nie oceniono).

Ekran wyniku pokazuje się gdy `ended === true` **lub** `timeSec ≥ endScreenAtSec`.
Przewinięcie z powrotem chowa go.

---

## Beatmapa — timeline to dane, nie kod

`src/data/beatmap.json`, importowany statycznie i walidowany przy starcie.

```json
{
  "videoId": "Iz-nC59AIWc",
  "endScreenAtSec": 56,
  "objects": [
    { "id": "o1", "time": 12.0, "duration": 1100, "x": 60, "y": 41,
      "sprite": "guy", "hitWindowMs": 200 }
  ]
}
```

| Pole | Znaczenie |
|---|---|
| `id` | Unikalny, **stabilny** — to klucz wyników przy przewijaniu. Zmiana `id` = zerowanie wyniku celu. |
| `time` | Sekunda wideo: moment idealnego trafienia. |
| `duration` | Ms fazy approach — cel pojawia się w `time − duration`. |
| `x`, `y` | Procent szerokości/wysokości **warstwy gry** (środek celu). |
| `sprite` | Klucz w rejestrze `src/sprites.ts`. |
| `hitWindowMs` | Tolerancja ± wokół `time`. |

`validateBeatmap` (`src/engine/beatmap.ts`) rzuca czytelnym błędem przy: pustej liście,
duplikacie `id`, celach nieposortowanych po `time`, `x`/`y` poza 0–100, niedodatnim
`duration`/`hitWindowMs`, `hitWindowMs > duration` (okno otwierałoby się, zanim cel się
pojawi) i nieznanym `sprite`. Błąd = komunikat na stronie zamiast cichego pominięcia.

> ⚠️ **Obecne czasy i `endScreenAtSec` to wartości robocze** — nie były strojone do
> realnego rytmu ani długości klipu.

---

## Sprite'y

`src/sprites.ts` to **jedyne miejsce w kodzie znające assety**:

```ts
const asset = (file: string) => `${import.meta.env.BASE_URL}sprites/${file}`;

export const SPRITES: Record<string, Sprite> = {
  guy:  { kind: 'image', src: asset('guy.webp') },
  girl: { kind: 'image', src: asset('girl.webp') },
};
```

Pliki leżą w `public/sprites/` (`guy.webp`, `girl.webp`) — statyczne WebP z pełną
8-bitową alfą, przycięte do faktycznego kadru postaci (bez przezroczystych marginesów),
480×480 px. Ścieżka liczy się od `import.meta.env.BASE_URL`, bo GitHub Pages serwuje
spod podścieżki `/game-video-clip/` (ADR-0007) — bez tego obrazki nie ładowałyby się
na buildzie produkcyjnym.

Rejestr wspiera też `kind: 'css'` (czyste CSS, `clip-path` + gradient, zero plików
binarnych) — to ścieżka z v1 (ADR-0005), obecnie nieużywana, ale renderer (`render.ts`)
obsługuje oba warianty bez zmian. **Podmiana obrazka = jedna linia w `SPRITES`.**

---

## Warstwa gry i DOM

```html
<div class="frame">           <!-- cel requestFullscreen: scena + HUD razem -->
  <main class="stage">        <!-- aspect-ratio: 16/9, wspólne dla playera i gry -->
    <div class="player">…</div> <!-- iframe wstawiany przez IFrame API -->
    <div class="overlay">     <!-- pointer-events: none -->
      <button class="obj">    <!-- pointer-events: auto -->
        <span class="sprite …"><span class="approach"><span class="feedback">
    <div class="gate">…</div> <!-- bramka startowa "Graj" -->
    <section class="results">… <!-- ekran wyniku -->
  </main>
  <div class="hud">…</div>    <!-- licznik + "pauza" + przycisk pełnego ekranu -->
</div>
```

Istotne szczegóły:

- **`.overlay` kończy się 3,5 rem nad dołem sceny**, żeby pasek kontrolek YouTube
  pozostał widoczny i klikalny (mitygacja z ADR-0008). W konsekwencji `y%` z beatmapy
  jest liczone względem **warstwy gry**, nie całej sceny.
- **`.frame` istnieje wyłącznie po to, by pełny ekran obejmował scenę razem z HUD-em**
  (ADR-0010). Szerokość sceny i HUD-u pochodzi ze wspólnej zmiennej `--stage-width`.
- **Approach circle jest skalowany imperatywnie co klatkę**
  (`transform: scale(1 + approach × 2.2)`), a **nie** przez CSS `@keyframes` — animacja
  CSS nie zamarłaby razem z wideo przy pauzie i nie zresynchronizowałaby się po seeku.
  `transform` jest kompozytowany na GPU, więc nie ma reflow.
- Cała geometria w **procentach**, więc skalowanie 375 px ↔ 1440 px jest darmowe.

---

## Pełny ekran

Przycisk pełnego ekranu YouTube rozszerza **sam element `<iframe>`**, a ten trafia do
*top layer* przeglądarki — ponad wszystkie konteksty układania, poza zasięgiem
`z-index`. Warstwa gry, bramka, ekran wyniku i HUD są jego rodzeństwem, więc znikały
pod wideo, przestawały być klikalne, a gra tykała dalej i zamieniała niewidoczne cele
w pudła. Stąd (ADR-0010):

- **`fs: 0`** w `playerVars` — przycisk YouTube jest wyłączony.
- **Pełny ekran bierze `.frame`** (scena + HUD), nie iframe. Geometria w procentach,
  więc skalowanie jest darmowe; w pełnym ekranie `100dvh` odnosi się do ekranu, więc
  `--stage-width` sam dobiera rozmiar sceny.
- **Własny przycisk w HUD** — zawsze widoczny, w dwóch trybach (`FullscreenMode`).
- **Strażnik przejęcia** (`src/ui/fullscreen.ts`): jeśli element pełnoekranowy znajdzie
  się mimo wszystko wewnątrz `.player` (klawisz `f`, dwuklik), wychodzimy i żądamy
  pełnego ekranu dla `.frame`.
- **Gdy odzyskanie się nie uda → pauza wideo.** Silnik zamarza poza stanem `PLAYING`,
  więc gra czeka zamiast naliczać pudła w ciemno.

### iPhone — trzy poziomy, bo Fullscreen API tam nie istnieje

`Element.requestFullscreen` nie ma na iPhonie w żadnej przeglądarce (wszystkie
używają WebKitu). Zweryfikowane na urządzeniu: detekcja zwraca `false`. Stąd:

| Tryb | Kiedy | Efekt |
|---|---|---|
| `native` | desktop, Android | prawdziwy pełny ekran przez Fullscreen API |
| `css` | iPhone | `.frame` dostaje `position: fixed; inset: 0` — znika reszta strony, **paski przeglądarki zostają** |
| PWA | iPhone, „Dodaj do ekranu początkowego" | **prawdziwy** pełny ekran, bez pasków |

Tryb `css` nie jest emulacją pełnego ekranu i nie udaje, że nią jest — po prostu
oddaje grze cały viewport. Pełny ekran na iPhonie daje wyłącznie uruchomienie
z ekranu początkowego: `public/manifest.webmanifest` (`display: fullscreen`)
plus `apple-mobile-web-app-capable` w `index.html`. Manifest **nie ma ikon** —
iOS użyje wtedy zrzutu strony zamiast ikony.

---

## Wejście i mobile

- Nasłuchujemy **`pointerdown`** — jedno zdarzenie dla myszy, dotyku i pióra. Nie
  `click`, bo po dotyku odpaliłby się drugi raz.
- `touch-action: manipulation` na scenie → brak 300 ms opóźnienia i brak double-tap-zoom.
- **Bramka startowa „Graj" jest wymuszona technicznie:** przeglądarki blokują
  odtwarzanie z dźwiękiem bez gestu użytkownika, a `autoplay=1` tego nie omija.
  Przycisk jest wyłączony („Ladowanie…") do `onReady` playera.
- Gra rusza dopiero gdy player wejdzie w `PLAYING` — nie w momencie kliknięcia. Dzięki
  temu buforowanie i ewentualna reklama nie zjadają pierwszych celów.

---

## Testy

`npm test` — **46 testów, jedyna komenda potrzebna do weryfikacji regresji.** Bez sieci,
bez prawdziwego YouTube, deterministyczne.

| Plik | Zakres |
|---|---|
| `tests/fake-clock.ts` | `FakeClock` — czas wideo i zegar ścienny sterowane **niezależnie**: `advance()` (odtwarzanie), `advanceWallOnly()` (pauza/buffering), `seekTo()` (przewinięcie). |
| `tests/engine.test.ts` | 30 testów logiki: spawn, okno tolerancji i jego skraj, klik przed oknem, brak kliku, pauza (10 s zegara ściennego → zero zmian), wznowienie bez fałszywego seeka, seek w tył i w przód, celność, interpolacja, odporność na szum odczytu. |
| `tests/beatmap.test.ts` | Walidacja + sprawdzenie beatmapy produkcyjnej wobec rejestru sprite'ów + że produkcyjna beatmapa faktycznie używa obu sprite'ów z rejestru. |
| `tests/smoke.test.ts` | jsdom: bramka startowa, tap → `+1` i HUD, tap poza oknem → `✕`, sprite obrazkowy renderuje się jako `<img>` ze źródłem z rejestru, pauza → zero celów w DOM, ekran wyniku z liczbami, `.frame` obejmuje scenę i HUD, przycisk pełnego ekranu. |
| `tests/fullscreen.test.ts` | jsdom + atrapa Fullscreen API (jsdom go nie implementuje): pełny ekran bierze `.frame`, toggle w obie strony, odebranie pełnego ekranu przejętego przez iframe, `onLost` gdy odzyskanie zawiedzie, brak API → tryb zastępczy `css` w obie strony. |

Test smoke montuje **tę samą grę** co produkcja (`mountGame` z `src/game.ts`), tylko
z podstawionym `TimeSource`.

Domyślne środowisko Vitest to `node`; jsdom włącza wyłącznie `smoke.test.ts` przez
docblock `@vitest-environment jsdom`.

---

## Build i deploy

`npm run build` → `dist/` (~9 kB JS + 3 kB CSS przed gzipem). Przy buildzie
`vite.config.ts` ustawia `base: '/game-video-clip/'` pod GitHub Pages — **zmień to,
jeśli repozytorium nazywa się inaczej**, bo inaczej wyjdzie biała strona z 404 na assetach.

Workflow `.github/workflows/deploy.yml` (push na `master` lub ręcznie) uruchamia
`npm ci` → `npm test` → `npm run build` → deploy. Instrukcja krok po kroku:
[`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Znane ograniczenia i rzeczy niezweryfikowane

- **⚠️ Zgodność z YouTube ToS:** nakładanie klikalnych elementów na odtwarzacz jest
  prawdopodobnie niezgodne z YouTube API Services — Developer Policies. Ryzyko zostało
  przedstawione i świadomie przyjęte. Wariant zgodny (pole gry **wokół** playera) to
  zmiana CSS + jednego rodzica, opisana w [ADR-0008](docs/decisions/ADR-0008-overlay-a-youtube-tos.md).
- **Integracja z realnym YouTube nie została przetestowana w przeglądarce.** Testy
  pokrywają logikę i DOM, ale nie faktyczne ładowanie iframe. Checklista ręczna:
  [`docs/PLAN.md`](docs/PLAN.md) krok 15.
- **Zachowanie w trakcie reklamy** — niezweryfikowane. API nie udostępnia zdarzeń
  reklamowych; nie wiadomo z pewnością, jak raportuje wtedy stan i czas.
- **`SEEK_THRESHOLD_SEC = 0.35`** nie było kalibrowane na realnym urządzeniu mobilnym.
- **`playbackRate ≠ 1` nie jest wspierany.** Przy zmianie tempa interpolacja wykryje
  rozjazd i zresynchronizuje się — gra pozostanie poprawna, ale szarpnie.
- `jsdom` przypięty do `^25`; wersja 27 wymaga `require(ESM)`, czyli Node ≥ 20.19.

---

## Gdzie co zmieniać

| Chcę… | Plik |
|---|---|
| zmienić momenty/pozycje celów | `src/data/beatmap.json` |
| podmienić placeholder na GIF/WebP | `src/sprites.ts` (+ plik w `public/`) |
| zmienić zasady trafiania/punktacji | `src/engine/engine.ts` |
| zmienić wygląd | `src/styles.css` |
| zmienić układ DOM / HUD / ekran wyniku | `src/ui/render.ts` |
| zmienić integrację z playerem | `src/ui/youtube.ts` |
| zmienić zachowanie pełnego ekranu | `src/ui/fullscreen.ts` |
| zmienić hosting / ścieżkę bazową | `vite.config.ts` + `docs/DEPLOY.md` |

---

## Decyzje

Każda istotna decyzja ma ADR w `docs/decisions/`:

| ADR | Temat |
|---|---|
| [0001](docs/decisions/ADR-0001-brak-frameworka-vite-typescript.md) | Brak frameworka — Vite + TypeScript |
| [0002](docs/decisions/ADR-0002-rendering-dom-css.md) | Rendering w DOM + CSS zamiast canvas |
| [0003](docs/decisions/ADR-0003-zrodlo-czasu-i-maszyna-stanow.md) | Źródło czasu, pętla gry, maszyna stanów |
| [0004](docs/decisions/ADR-0004-beatmapa-jako-dane-json.md) | Beatmapa jako plik danych JSON |
| [0005](docs/decisions/ADR-0005-format-assetow-i-placeholdery.md) | Format assetów i placeholdery |
| [0006](docs/decisions/ADR-0006-testy-vitest-fake-clock.md) | Testy: Vitest + fake clock |
| [0007](docs/decisions/ADR-0007-hosting-github-pages.md) | Hosting: GitHub Pages |
| [0008](docs/decisions/ADR-0008-overlay-a-youtube-tos.md) | ⚠️ Overlay a YouTube ToS |
| [0009](docs/decisions/ADR-0009-start-gate-i-mobile-first.md) | Bramka startowa i mobile-first |
| [0010](docs/decisions/ADR-0010-pelny-ekran-ramki-gry.md) | Pełny ekran obejmuje ramkę gry, nie odtwarzacz |
