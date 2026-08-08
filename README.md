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
npm test        # 62 testy, ~1 s, bez sieci — jedyna komenda weryfikacji regresji
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
- Przejście do `hit` dodatkowo: podmienia grafikę sprite'a na wariant `hitSrc` (jeśli
  zarejestrowany) i odtwarza dźwięk trafienia — zobacz sekcję [Sprite'y](#sprite-y).
  `miss` nie zmienia grafiki. Dźwięk leci **wyłącznie** z tej ścieżki (`onHit` w
  `src/game.ts`), nigdy z `resync`/`sweepMisses` — patrz [ADR-0011](docs/decisions/ADR-0011-dwuwariantowy-sprite-i-dzwiek-trafienia.md).
- **Klasa `is-armed`** na `.obj`: cel jest w oknie tolerancji (`|timeSec − time| ≤ hitWindowMs`)
  i jeszcze nierozstrzygnięty. Renderer (`render.ts`) liczy to co klatkę z `GameView`,
  silnik o tym nie wie. CSS zmienia wtedy kolor okręgu na zielony (`#6ef58f`) — sygnał
  „ten klik trafi", zanim gracz w ogóle kliknie. Patrz [ADR-0012](docs/decisions/ADR-0012-wyrownanie-okregu-i-sygnal-uzbrojenia.md).
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
  "videoId": "5OyTxEbT-fM",
  "endScreenAtSec": 56,
  "objects": [
    { "id": "o1", "time": 12.0, "duration": 1100, "x": 60, "y": 41,
      "sprite": "hand", "hitWindowMs": 200 }
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
> realnego rytmu ani długości klipu `5OyTxEbT-fM`. Jeśli klip jest krótszy niż ~54 s,
> ostatnie cele nie zdążą się pojawić, zanim player wejdzie w `ENDED`.

---

## Sprite'y

`src/sprites.ts` to **jedyne miejsce w kodzie znające assety**:

```ts
const asset = (file: string) => `${import.meta.env.BASE_URL}sprites/${file}`;

export const SPRITES: Record<string, Sprite> = {
  hand: { kind: 'image', src: asset('hand-idle.gif'), hitSrc: asset('hand-hit.gif') },
};

export const HIT_SOUND_SRC = `${import.meta.env.BASE_URL}sounds/clap.mp3`;
```

Wariant `kind: 'image'` ma opcjonalne `hitSrc` — grafikę pokazywaną wyłącznie w stanie
`outcome === 'hit'` (ADR-0011); `miss` zostawia `src` bez zmian. To jedyny dodatkowy
stan wizualny, jakiego wymaga maszyna stanów celu, więc zamiast pełnej mapy
`Record<Outcome, src>` jest jedno opcjonalne pole. `render.ts` podmienia `img.src` na
`hitSrc`, gdy `visible.outcome === 'hit'` — idempotentnie, bo `render()` leci co klatkę
przez cały `FADE_OUT_MS`. `hitSrc` jest wstępnie ładowany (`new Image().src = hitSrc`)
przy montażu obiektu, żeby podmiana nie dała pustej klatki.

Pliki leżą w `public/sprites/` (`hand-idle.gif`, `hand-hit.gif`) — animowane GIF-y,
nie WebP: GIF ma 1-bitową przezroczystość (możliwa widoczna obwódka na krawędziach
dłoni na tle wideo) i większy rozmiar (~200–224 kB zamiast ~20–60 kB), ale animowany
WebP wymagałby narzędzia konwersji, którego projekt nie ma, i pobierania z internetu —
poza ograniczeniami projektu. Świadomy kompromis, opisany w ADR-0011.

Rejestr wspiera też `kind: 'css'` (czyste CSS, `clip-path` + gradient, zero plików
binarnych) — to ścieżka z v1 (ADR-0005), obecnie nieużywana, ale renderer (`render.ts`)
obsługuje oba warianty bez zmian. **Podmiana obrazka = jedna linia w `SPRITES`.**

### Dźwięk trafienia

`src/ui/sound.ts` (`createHitSound`) trzyma pulę **4 elementów `HTMLAudioElement`** na
tym samym `src` (`HIT_SOUND_SRC`), używanych round-robin — jeden element restartowany
przez `currentTime = 0` ucinałby poprzedni klaps przy dwóch szybkich trafieniach.
Wszystkie mają `preload = 'auto'`, więc plik jest w cache przed pierwszym trafieniem.

- **`unlock()`** — wywoływane raz w `onStart` (`src/game.ts`), w obrębie gestu „Graj":
  na każdym elemencie puli wyciszony `play()`, a **dopiero po ustabilizowaniu się
  jego `Promise`** — `pause()` → `currentTime = 0` → zdjęcie wyciszenia. Wywołanie
  `pause()` synchronicznie zaraz po `play()`, zanim przeglądarka faktycznie ruszyła
  odtwarzanie, przerywa `play()` błędem, który na części przeglądarek (Safari) liczy
  się jako niedokończone odblokowanie elementu — stąd `.then()`, nie kolejna linijka.
  iOS/WebKit odblokowuje *konkretny element* `<audio>`, na którym padł `play()`
  w obrębie gestu — nie „stronę" — stąd pula jest odblokowywana cała naraz, a nie
  klonowana później.
- **`play()`** — wywoływane wyłącznie w `onHit`, gdy `engine.hit(id)` zwróci `true`.
  Ponieważ `resync()`/`sweepMisses()` nie przechodzą przez tę ścieżkę, przewinięcie
  (w tył czy w przód) **konstrukcyjnie** nie ma jak wywołać dźwięku — tak samo jak wynik
  jest funkcją mapy, a nie licznikiem. Drugi klik w rozstrzygnięty cel nie daje drugiego
  dźwięku, bo `engine.hit()` zwraca `false` przy `results.has(id)`. Każdy element puli
  ma `volume = 1` (głośno, bez przycinania).
- Błędy `play()`/`pause()` (odrzucona `Promise`, środowisko bez pełnej implementacji
  `HTMLMediaElement`) są połykane, żeby brak dźwięku nie mógł wywrócić rozgrywki —
  ale nieudane trafienie loguje `console.warn` z przyczyną, żeby dało się to
  zdiagnozować w devtoolsach zamiast zgadywać.

---

## Warstwa gry i DOM

```html
<div class="frame">           <!-- cel requestFullscreen: scena + HUD razem -->
  <main class="stage">        <!-- aspect-ratio: 16/9, wspólne dla playera i gry -->
    <div class="player">…</div> <!-- iframe wstawiany przez IFrame API -->
    <div class="overlay">     <!-- pointer-events: none -->
      <button class="obj">    <!-- pointer-events: auto -->
        <img class="sprite">  <!-- src podmieniany na hitSrc przy outcome === 'hit' -->
        <span class="approach"><span class="feedback">
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
- **Approach circle jest wycentrowany na okręgu CSS-ową właściwością `translate: 9.8% -0.9%`**
  (`.approach` w `styles.css`), niezależną od `transform`, które JS nadpisuje co klatkę.
  Rysunek dłoni w `hand-idle.gif` nie jest wyśrodkowany w swoim kwadratowym płótnie
  (bbox treści zmierzony narzędziowo: 1254×1254 px płótno, treść w x 360–1140,
  y 295–937) — bez tej korekty okrąg wizualnie otaczał puste miejsce obok dłoni,
  nie samą dłoń. Patrz [ADR-0012](docs/decisions/ADR-0012-wyrownanie-okregu-i-sygnal-uzbrojenia.md).
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
- Ten sam gest „Graj" odblokowuje dźwięk trafienia (`sound.unlock()` w `src/game.ts`) —
  patrz sekcja „Dźwięk trafienia" w sekcji [Sprite'y](#sprite-y).

---

## Testy

`npm test` — **62 testy, jedyna komenda potrzebna do weryfikacji regresji.** Bez sieci,
bez prawdziwego YouTube, deterministyczne.

| Plik | Zakres |
|---|---|
| `tests/fake-clock.ts` | `FakeClock` — czas wideo i zegar ścienny sterowane **niezależnie**: `advance()` (odtwarzanie), `advanceWallOnly()` (pauza/buffering), `seekTo()` (przewinięcie). |
| `tests/engine.test.ts` | 30 testów logiki: spawn, okno tolerancji i jego skraj, klik przed oknem, brak kliku, pauza (10 s zegara ściennego → zero zmian), wznowienie bez fałszywego seeka, seek w tył i w przód, celność, interpolacja, odporność na szum odczytu. |
| `tests/beatmap.test.ts` | Walidacja + sprawdzenie beatmapy produkcyjnej wobec rejestru sprite'ów, że produkcyjna beatmapa faktycznie używa każdego sprite'a z rejestru, że wskazuje `5OyTxEbT-fM` i że nie odwołuje się już do usuniętych kluczy `guy`/`girl`. |
| `tests/smoke.test.ts` | jsdom: bramka startowa, tap → `+1` i HUD, tap poza oknem → `✕`, sprite obrazkowy renderuje się jako `<img>` ze źródłem z rejestru, trafienie podmienia `img.src` na wariant `hitSrc`, pudło zostawia wariant idle, `is-armed` włącza się tylko w oknie tolerancji i gaśnie po trafieniu, pauza → zero celów w DOM, ekran wyniku z liczbami, `.frame` obejmuje scenę i HUD, przycisk pełnego ekranu. |
| `tests/fullscreen.test.ts` | jsdom + atrapa Fullscreen API (jsdom go nie implementuje): pełny ekran bierze `.frame`, toggle w obie strony, odebranie pełnego ekranu przejętego przez iframe, `onLost` gdy odzyskanie zawiedzie, brak API → tryb zastępczy `css` w obie strony. |
| `tests/sound.test.ts` | jsdom + atrapa `HTMLAudioElement` wstrzyknięta przez `make`: trafienie → dokładnie jedno `play()`, pudło i wygaśnięcie bez kliknięcia → zero `play()`, drugi tap w ten sam cel → nadal jedno, seek w tył przez trafiony cel + seek w przód → zero dodatkowych, dwa szybkie trafienia → dwa różne elementy puli (round-robin), `unlock()` dotyka każdego elementu puli. |

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
- **Długość klipu `5OyTxEbT-fM` nie została programowo zweryfikowana** — YouTube nie
  oddaje `lengthSeconds` przez zwykły fetch. Jeśli klip jest krótszy niż ~54 s, ostatnie
  cele beatmapy nigdy się nie pojawią. Wymaga jednego ręcznego uruchomienia `npm run dev`.
- **Obwódka GIF-a na krawędziach dłoni** — 1-bitowa przezroczystość `hand-idle.gif` /
  `hand-hit.gif` może dać widoczną krawędź na tle konkretnego wideo. Niezweryfikowane
  wizualnie.
- **Głośność klapsa** względem ścieżki wideo nie jest regulowana — brak `el.volume`
  w `src/ui/sound.ts`. Do dodania jedną linią, jeśli w praktyce okaże się za głośny.

---

## Gdzie co zmieniać

| Chcę… | Plik |
|---|---|
| zmienić momenty/pozycje celów | `src/data/beatmap.json` |
| podmienić sprite / dodać wariant hit | `src/sprites.ts` (+ plik w `public/sprites/`) |
| podmienić dźwięk trafienia | `src/sprites.ts` (`HIT_SOUND_SRC`) + plik w `public/sounds/` |
| zmienić rozmiar puli / logikę odtwarzania dźwięku | `src/ui/sound.ts` |
| zmienić zasady trafiania/punktacji | `src/engine/engine.ts` |
| zmienić wygląd | `src/styles.css` |
| zmienić układ DOM / HUD / ekran wyniku / podmianę grafiki na trafieniu | `src/ui/render.ts` |
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
| [0011](docs/decisions/ADR-0011-dwuwariantowy-sprite-i-dzwiek-trafienia.md) | Dwuwariantowy sprite i dźwięk trafienia w warstwie UI |
| [0012](docs/decisions/ADR-0012-wyrownanie-okregu-i-sygnal-uzbrojenia.md) | Wyrównanie approach circle do treści sprite'a i sygnał „można trafić" |
