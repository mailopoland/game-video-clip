# Click the target — gra rytmiczna na klipie YouTube

Prosta gra rytmiczna nałożona na odtwarzany klip z YouTube. Ścieżka ruchu w beatmapie
wyznacza, kiedy i gdzie pojawia się klikalna dłoń — klikalna przez cały czas, w którym
jest widoczna. Klik w tym czasie daje punkt, brak kliku do końca ścieżki — pudło.
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
npm test        # 130 testy, ~2 s, bez sieci — jedyna komenda weryfikacji regresji
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
   zwrócić tę samą wartość. Bez zaradzenia ruch obiektów po ścieżce by się zacinał.
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
  `timeSec + Δ(performance.now()) * rate`:
  - rozjazd > **`SEEK_THRESHOLD_SEC = 0.35`** → to przewinięcie → `resync()`;
  - inaczej `timeSec = max(odczyt, przewidywanie)` — interpolacja wygładza ziarnistość
    `getCurrentTime()` i nigdy nie cofa czasu o szum odczytu.

Zegar ścienny wchodzi przez wstrzykiwany `now()` (domyślnie `performance.now()`), więc
testy sterują nim ręcznie.

**Tempo odtwarzania (`playbackRate`) skaluje predykcję (ADR-0016).**
`TimeSample.rate?: number` — opcjonalne, brak/niedodatnie/nieskończone traktowane jak `1`
(zachowuje zgodność wsteczną z `FakeClock` i testami, które go nie ustawiają).
`src/ui/youtube.ts` odczytuje `player.getPlaybackRate()` **w każdym `sample()`**, bez
cache'a — reset tempa po reklamie czy zmianie z menu ⚙ playera jest widoczny w następnej
klatce, bez cichego rozjazdu. Dzięki temu 0,25×/2× nie wywołują fałszywych `resync()`
(wcześniej defekt: predykcja przy 0,25× uciekała 4× szybciej niż realny czas wideo i
przekraczała `SEEK_THRESHOLD_SEC` po ~0,12 s zegara ściennego).

---

## Maszyna stanów celu

```
pending  ──(t ≥ path[0].t)──▶  active
active   ──(dowolny klik)──▶  hit
active   ──(t > path[ostatni].t, brak kliku)──▶  miss
(seek do przodu)  ──▶  skipped
```

Od [ADR-0015](docs/decisions/ADR-0015-usuniecie-okregu-i-pol-czasowych-obiektu.md) `path`
jest **jedynym** źródłem prawdy o tym, kiedy obiekt istnieje — nie ma już osobnych pól
czasowych ani okna tolerancji:

- **`path[0].t`** = spawn (obiekt staje się widoczny i klikalny).
- **`path[ostatni].t`** = despawn — do tego momentu włącznie obiekt jest klikalny.
- **Reka jest klikalna przez cały ten czas.** Nie ma pojęcia „poza oknem" ani spóźnienia —
  klik w dowolnym momencie między spawnem a despawnem to zawsze trafienie. Brak kliku do
  despawnu (włącznie) to pudło.
- Po rozstrzygnięciu cel zostaje na ekranie jeszcze **`FADE_OUT_MS = 500`** — tyle trwa
  animacja `+1` / `✕`.
- Przejście do `hit` dodatkowo: podmienia grafikę sprite'a na wariant `hitSrc` (jeśli
  zarejestrowany) i odtwarza dźwięk trafienia — zobacz sekcję [Sprite'y](#sprite-y).
  `miss` nie zmienia grafiki. Dźwięk leci **wyłącznie** z tej ścieżki (`onHit` w
  `src/game.ts`), nigdy z `resync`/`sweepMisses` — patrz [ADR-0011](docs/decisions/ADR-0011-dwuwariantowy-sprite-i-dzwiek-trafienia.md).
- Klik w cel, który jeszcze nie spawnował, jest **ignorowany** (nie tworzy pudła).
- Drugi klik w ten sam cel nic nie zmienia.

**Nie ma już approach circle.** Sam sprite dłoni jest celem, bez żadnego dodatkowego
sygnału wizualnego „można trafić" przed kliknięciem — usunięty razem z klasą `is-armed`
(ADR-0015; wcześniej opisane w ADR-0012/ADR-0013).

Stany nie są mutowane w miejscu — są wyliczane z beatmapy i mapy wyników przy każdym
`getView()`.

---

## Przewijanie i punktacja

To jest miejsce, w którym gra spełnia wymaganie „żadnych duchów ani podwójnych punktów".

**Punktacja jest funkcją mapy `Map<objectId, { outcome, atSec }>`, nie licznikiem.**
Nie ma żadnego `score++`. Dzięki temu ponowne zagranie fragmentu **nadpisuje** wynik
zamiast go dodawać — podwójne punktowanie jest niemożliwe konstrukcyjnie, a nie dzięki
uważności.

`resync(T)` — jedyne miejsce obsługujące przewijanie. Pivot to `path[ostatni].t`
(despawn) każdego obiektu — jeden spójny warunek zamiast osobnych reguł dla „w przyszłości"
i „poza oknem" sprzed ADR-0015:

| Sytuacja | Zachowanie |
|---|---|
| **Seek w tył** | Wyniki celów, których despawn jest ≥ `T`, są **usuwane** → fragment można zagrać od nowa. Wyniki celów pozostających w przeszłości zostają nietknięte. |
| **Seek w przód** | Cele, których despawn jest < `T` i nie mają jeszcze wyniku, dostają `skipped` → **zero fałszywych pudeł**. |
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
    { "id": "o1", "sprite": "hand",
      "path": [
        { "t": 11.5, "x": 60, "y": 41, "size": 100 },
        { "t": 12.5, "x": 60, "y": 41, "size": 100 }
      ] }
  ]
}
```

| Pole | Znaczenie |
|---|---|
| `id` | Unikalny, **stabilny** — to klucz wyników przy przewijaniu. Zmiana `id` = zerowanie wyniku celu. |
| `sprite` | Klucz w rejestrze `src/sprites.ts`. |
| `path` | **Wymagane, min. 2 punkty** (start i koniec). Ścieżka ruchu — jedyne źródło prawdy o tym, kiedy i gdzie obiekt istnieje. Patrz niżej. |

**`path` — jedyne źródło prawdy o obecności obiektu (ADR-0014, ADR-0015).** Lista
punktów `PathPoint`, ściśle rosnąco po `t`. `path[0].t` to spawn obiektu,
`path[ostatni].t` to despawn — **nie ma już osobnych pól `time`/`duration`/`hitWindowMs`**.
Cały przedział `[path[0].t, path[ostatni].t]` jest jednocześnie oknem klikalności
(patrz [Maszyna stanów celu](#maszyna-stanów-celu)). Obiekt statyczny (bez ruchu) to
`path` z dwoma punktami o tych samych `x`/`y`/`size` i różnym `t`.

| Pole punktu | Znaczenie |
|---|---|
| `t` | Sekunda wideo, absolutna. |
| `x`, `y` | Procent szerokości/wysokości **warstwy gry** (środek celu). |
| `size` | Procent bazowego rozmiaru obiektu (bazowe `width: 16%` z `styles.css`). `100` = obecny rozmiar, `50` = połowa, `200` = dwa razy większy. Musi być dodatnie, bez górnego limitu. |

Pozycja i rozmiar w danej sekundzie wideo to `samplePath(path, timeSec)`
(`src/engine/path.ts`) — czysta funkcja, czytana przez silnik, nie renderer:
**interpolacja liniowa** między sąsiednimi punktami; poza zakresem ścieżki
(przed pierwszym punktem, po ostatnim) — **przytrzymanie skrajnej wartości**.
Dzięki temu ruch zamarza na pauzie i resynchronizuje się po przewinięciu bez
żadnego dodatkowego kodu — to ten sam mechanizm co zamrażanie `timeSec` w silniku.

`validateBeatmap` (`src/engine/beatmap.ts`) rzuca czytelnym błędem przy: pustej liście,
duplikacie `id`, celach nieposortowanych po `path[0].t`, nieznanym `sprite`, `path` z mniej
niż dwoma punktami, punkcie `path` z `t` nieskończonym/nierosnącym względem poprzedniego,
`x`/`y` punktu poza 0–100 lub niedodatnim `size` punktu. Błąd = komunikat na stronie
zamiast cichego pominięcia.

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
przez cały `FADE_OUT_MS`.

**Wszystkie warianty graficzne (`src` i `hitSrc`) są preładowane raz, przy montażu UI**
— `preloadSprites()` z `src/sprites.ts`, wołane na początku `createUi()`, czyli jeszcze
przed bramką startową i odtwarzaniem. Wcześniej preładowany był wyłącznie `hitSrc`, a
`src` pobierał się dopiero przy pierwszym montażu obiektu: `hand-idle.gif` waży ~200 kB,
a pierwszy cel żyje ~2 s, więc na pierwszym przebiegu widać było pusty (ale klikalny)
obiekt, a dłoń pojawiała się dopiero po przewinięciu w tył — gdy plik był już w cache.

Pliki leżą w `public/sprites/` (`hand-idle.gif`, `hand-hit.gif`) — animowane GIF-y,
nie WebP: GIF ma 1-bitową przezroczystość (możliwa widoczna obwódka na krawędziach
dłoni na tle wideo) i większy rozmiar (~200–224 kB zamiast ~20–60 kB), ale animowany
WebP wymagałby narzędzia konwersji, którego projekt nie ma, i pobierania z internetu —
poza ograniczeniami projektu. Świadomy kompromis, opisany w ADR-0011.

Rejestr wspiera też `kind: 'css'` (czyste CSS, `clip-path` + gradient, zero plików
binarnych) — to ścieżka z v1 (ADR-0005), obecnie nieużywana, ale renderer (`render.ts`)
obsługuje oba warianty bez zmian. **Podmiana obrazka = jedna linia w `SPRITES`.**

### Dźwięk trafienia

`src/ui/sound.ts` (`createHitSound`) odtwarza klaps przez **Web Audio na zdekodowanym
buforze** ([ADR-0017](docs/decisions/ADR-0017-dzwiek-przez-web-audio-na-buforze.md)):
`fetch` → `decodeAudioData` → `AudioBuffer`, a każde trafienie to nowy
`AudioBufferSourceNode` → `GainNode` → `destination`.

**Dlaczego nie `<audio>`:** iOS/WebKit utrzymuje sesję audio dla **jednego elementu
medialnego naraz**, więc po starcie `<video>` YouTube'a każdy nasz `<audio>` milknie —
zaobserwowane na urządzeniu (klaps słyszalny przed startem filmu, niesłyszalny po).
`AudioBufferSourceNode` nie jest elementem medialnym, więc tego ograniczenia nie dotyka.
Węzeł źródłowy jest jednorazowy z definicji, więc nakładanie się dwóch szybkich klapsów
jest darmowe.

- **`unlock()`** — wywoływane raz w `onStart` (`src/game.ts`), w obrębie gestu „Graj",
  bo `AudioContext` rodzi się `suspended` i tylko gest pozwala go wznowić. Tam startuje
  też pobranie i dekodowanie pliku. Powtórne wywołanie nie tworzy drugiego kontekstu.
- **Droga zapasowa: pula 4 elementów `HTMLAudioElement`** (`preload = 'auto'`,
  round-robin), używana **wyłącznie** gdy nie ma `AudioContext` albo dekodowanie
  zawiodło — czyli w `jsdom` (testy) i w starszych przeglądarkach. Na tej drodze
  wzmocnienie jest przycięte do `1.0`. `unlock()` odblokowuje ją tak jak dawniej:
  wyciszony `play()`, a **dopiero po ustabilizowaniu się jego `Promise`** —
  `pause()` → `currentTime = 0` → zdjęcie wyciszenia (synchroniczne `pause()` zaraz
  po `play()` przerywa je błędem, co na Safari liczy się jako nieudane odblokowanie).
- **`play()`** — wywoływane wyłącznie w `onHit`, gdy `engine.hit(id)` zwróci `true`.
  Ponieważ `resync()`/`sweepMisses()` nie przechodzą przez tę ścieżkę, przewinięcie
  (w tył czy w przód) **konstrukcyjnie** nie ma jak wywołać dźwięku — tak samo jak wynik
  jest funkcją mapy, a nie licznikiem. Drugi klik w rozstrzygnięty cel nie daje drugiego
  dźwięku, bo `engine.hit()` zwraca `false` przy `results.has(id)`.
- Błędy `play()`/`pause()` (odrzucona `Promise`, środowisko bez pełnej implementacji
  `HTMLMediaElement`) są połykane, żeby brak dźwięku nie mógł wywrócić rozgrywki —
  ale nieudane trafienie loguje `console.warn` z przyczyną, żeby dało się to
  zdiagnozować w devtoolsach zamiast zgadywać.
- **`describe()`** — jednolinijkowy stan ścieżki dźwięku (`tryb=bufor|pula`, stan
  `AudioContext`, aktualny `gain`, licznik odtworzeń z bufora, liczba odblokowanych
  elementów puli, `readyState`, `currentTime`/`paused`/`volume` ostatniego elementu
  puli, ostatni błąd). Wyłącznie diagnostyka — nie wpływa na odtwarzanie; konsument to guzik
  „Test dzwieku" w pasku dev (patrz [Tryb deweloperski](#tryb-deweloperski--nagrywanie-ścieżki-ręki)).

**Głośność jest proporcjonalna do aktualnej głośności YouTube i wzmocniona
(ADR-0013, ADR-0017):** `play()` liczy `gain = getReferenceVolume() * LOUDNESS_BOOST`
tuż przed każdym odtworzeniem, gdzie `LOUDNESS_BOOST = 2` — dobrane na słuch na
urządzeniu (`4` i `3` były za głośne) (`getReferenceVolume`
domyślnie `() => 1`, w produkcji `PlayerHandle.getVolume()` z `src/ui/youtube.ts` —
`isMuted() ? 0 : getVolume() / 100`). Na ścieżce buforowej `GainNode` przekracza `1.0`
bez przeszkód, więc wzmocnienie **działa naprawdę** — wcześniej (ADR-0013) szło przez
`MediaElementAudioSourceNode`, czyli nadal przez element medialny, i na iOS nie miało
szans zadziałać. Na drodze zapasowej zostaje `el.volume = min(1, getReferenceVolume())`
— proporcja do YouTube zostaje, ale bez wzmocnienia ponad naturalny poziom pliku.
**Chcesz głośniej/ciszej: `LOUDNESS_BOOST` w `src/ui/sound.ts`, jedna stała.**

---

## Warstwa gry i DOM

```html
<div class="frame">           <!-- cel requestFullscreen: scena + HUD razem -->
  <main class="stage">        <!-- aspect-ratio: 16/9, wspólne dla playera i gry -->
    <div class="player">…</div> <!-- iframe wstawiany przez IFrame API -->
    <div class="overlay">     <!-- pointer-events: none -->
      <button class="obj">    <!-- pointer-events: auto -->
        <img class="sprite">  <!-- src podmieniany na hitSrc przy outcome === 'hit' -->
        <span class="feedback">
    <div class="gate">…</div> <!-- bramka startowa "Graj" -->
    <section class="results">… <!-- ekran wyniku -->
  </main>
  <div class="hud">…</div>    <!-- licznik + "pauza" + przycisk pełnego ekranu -->
</div>
```

Istotne szczegóły:

- **`.overlay` kończy się 8% wysokości sceny nad dołem**, żeby pasek kontrolek YouTube
  pozostał widoczny i klikalny (mitygacja z ADR-0008). W konsekwencji `y%` z beatmapy
  jest liczone względem **warstwy gry**, nie całej sceny. Wartość jest w **procentach**,
  nie w `rem` — poprzednia stała `3,5rem` dawała inny udział wysokości sceny na
  telefonie (27%) niż w pełnym ekranie (5%), więc ten sam `y` z beatmapy lądował
  w innym miejscu kadru (ADR-0014).
- **Grubość obwódki okręgu, cień sprite'a i rozmiar fontu feedbacku są w jednostkach
  `cqw`** (`container-type: inline-size` na `.stage`, 1cqw = 1% szerokości sceny) —
  z tego samego powodu co wyżej: `rem`/`vw` nie skalują się razem z rozmiarem sceny
  w kontenerze, `cqw` tak (ADR-0014).
- **`.frame` istnieje wyłącznie po to, by pełny ekran obejmował scenę razem z HUD-em**
  (ADR-0010). Szerokość sceny i HUD-u pochodzi ze wspólnej zmiennej `--stage-width`.
- **Nie ma już approach circle** (usunięty w ADR-0015; historia w ADR-0012/ADR-0013).
  `.obj` renderuje tylko `.sprite` i `.feedback` — sam sprite dłoni jest celem, klikalny
  przez cały czas trwania jego `path`.
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
- **Prawy przycisk myszy nigdy nie liczy się jako trafienie** (`event.button !== 0` w
  `src/ui/render.ts` przerywa obsługę `onHit` przed `preventDefault()`) — prawy przycisk
  jest zarezerwowany dla trybu deweloperskiego (patrz niżej).

---

## Tryb deweloperski — nagrywanie ścieżki ręki

**Wyłącznie w `npm run dev`, wycięte z buildu produkcyjnego** przez
`import.meta.env.DEV` (`src/main.ts` importuje `src/dev/*` dynamicznie, tylko pod tym
warunkiem — Rollup eliminuje całą gałąź razem z importem przy `vite build`).
`vite.config.ts` dodatkowo wymusza `process.env.NODE_ENV` zgodny z komendą (`build` →
`production`), bo Vite domyślnie **nie nadpisuje** już ustawionego `NODE_ENV` — ambientowe
`NODE_ENV=development` w powłoce dewelopera inaczej przetrwałoby `vite build` i wpuściło
kod dev (razem z endpointem zapisu) do bundla produkcyjnego. Szczegóły:
[ADR-0016](docs/decisions/ADR-0016-tryb-deweloperski-nagrywania-sciezki.md).

**Jak używać:** `npm run dev`, kliknij „Graj", zaznacz checkbox „Developer: edycja
grafiki na osi czasu" pod HUD-em — tempo wideo spada automatycznie do najniższego
dostępnego (`player.getAvailablePlaybackRates()`, fallback `1`). Przeciągnij **prawym
przyciskiem myszy** po scenie — dłoń podąża za kursorem (podgląd, `pointer-events: none`),
menu kontekstowe przeglądarki nie pojawia się. Puść przycisk — ścieżka trafia do
**beatmapy w pamięci silnika natychmiast** (`Engine.setObjects`, bez restartu gry ani
przeładowania strony) i jest zapisywana na dysk w tle (`POST /__beatmap`, dev-only
endpoint w `vite.config.ts`). Możesz od razu przewinąć wideo, żeby obejrzeć efekt.
Prawy klik **w istniejącą rękę** usuwa ten obiekt (z pamięci i z pliku) zamiast
rozpoczynać nagranie. Odznaczenie checkboxa wraca do tempa 1× i przerywa trwające
nagranie bez zapisu.

Obok checkboxa znajdują się przyciski **„-100ms"/„+100ms"** — przesuwają czas wideo
o 100 ms w tył/przód (`player.seekTo(currentTime ± 0.1, true)`) do precyzyjnego
dostrojenia klatki. Działają niezależnie od stanu checkboxa (przydatne do
pozycjonowania przed włączeniem edycji) oraz niezależnie od tego, czy wideo jest
odtwarzane — na pauzie samo `seekTo()` nie odświeża wyświetlanej klatki (znany quirk
IFrame API), więc `seekBy` dokleja krótkie `playVideo()`/`pauseVideo()`, żeby wymusić
przemalowanie bez faktycznego wznowienia odtwarzania.

Dalej w pasku są przyciski **„Stop"/„Play"** — wywołują wprost `player.pause()`/
`player.play()`, niezależnie od stanu checkboxa. Ostatni przycisk, **„Reload
beatmap.json"**, wczytuje plik z dysku (`fetch('/src/data/beatmap.json')`),
waliduje go (`validateBeatmap`) i podmienia obiekty w silniku
(`Engine.setObjects`) — **odrzucając niezapisane zmiany w pamięci**. Przydaje się
po ręcznej edycji `beatmap.json` w edytorze tekstu, gdy trzeba wczytać zmiany bez
przeładowania strony.

Ostatni przycisk paska, **„Test dzwieku"**, odtwarza klaps **tą samą instancją
`HitSound` co trafienie w rękę** (`game.sound.play()` — nie druga pula obok), a po
400 ms wypisuje w pasku statusu wynik `HitSound.describe()`. Powstał do diagnostyki
braku dźwięku na iOS, gdzie `console.warn` jest nie do odczytania (Chrome i Brave na
iPhonie to WKWebView bez devtoolsów). Działa niezależnie od checkboxa trybu dev.
Interpretacja: `paused=false` i rosnące `t` przy ciszy oznaczają, że dźwięk płynie,
ale nie dociera do głośnika (kategoria sesji audio / przełącznik Dzwonek-Cisza);
`paused=true` z wypełnionym `blad=` oznacza odrzucone `play()` (brak odblokowania
gestem); `odblokowane=0/4` po kliknięciu „Graj" oznacza, że `unlock()` nie zadziałał.

Źródłem prawdy jest **beatmapa w pamięci**, nie plik na dysku — zapis jest efektem
ubocznym. Reload przez Vite HMR jest zablokowany dla `beatmap.json`
(`handleHotUpdate` zwraca `[]`), więc edycja nie zeruje stanu gry; przycisk „Reload
beatmap.json" to jedyny sposób na ręczne wczytanie pliku z dysku w trakcie sesji.

Szczegóły projektowe (metryka RDP, format `id`, limity zapisu, brak `@types/node`,
znane ograniczenia jak `FADE_OUT_MS` przy tempie ≠ 1) — w
[ADR-0016](docs/decisions/ADR-0016-tryb-deweloperski-nagrywania-sciezki.md).

| Plik | Rola |
|---|---|
| `src/dev/rdp.ts` | `simplifyPath` — uproszczenie nagranej ścieżki, metryka odchylenia od interpolacji **po czasie** (nie klasyczna odległość do prostej), tolerancja 1,0. |
| `src/dev/record.ts` | Czyste funkcje: `toOverlayPercent` (px → % względem `.overlay`), `pushSample`, `buildPath` (RDP + dosyntetyzowanie 2. punktu dla gestów krótszych niż 0,25 s), `nextObjectId`, `insertObject`, `removeObject`. |
| `src/dev/recorder.ts` | `mountDevRecorder` — spina nasłuchy DOM, `onFrame()` (próbkowanie z czasu gry, wołane z pętli `rAF`), zapis przez `fetch`. |
| `src/dev/beatmap-write-plugin.ts` | Plugin Vite (`apply: 'serve'`) — `POST /__beatmap`, walidacja strukturalna (bez rejestru sprite'ów — patrz ADR-0016), zapis atomowy `.tmp` → `renameSync`. |
| `src/dev/node-shims.d.ts` | Minimalny `declare module 'node:fs'` — projekt celowo nie ma `@types/node`. |

**Poza zakresem (świadomie):** undo/redo, edycja/przeciąganie istniejących punktów
ścieżki, timeline, wybór sprite'a inny niż `hand`, zmiana `size` w trybie dev.

---

## Testy

`npm test` — **130 testy, jedyna komenda potrzebna do weryfikacji regresji.** Bez sieci,
bez prawdziwego YouTube, deterministyczne.

| Plik | Zakres |
|---|---|
| `tests/fake-clock.ts` | `FakeClock` — czas wideo i zegar ścienny sterowane **niezależnie**: `advance()` (odtwarzanie), `advanceWallOnly()` (pauza/buffering), `seekTo()` (przewinięcie), `advanceAtRate(sec, rate)` (odtwarzanie przy zadanym tempie — `sec` to sekundy wideo, zegar ścienny płynie proporcjonalnie). Fabryka `obj()` tworzy domyślnie dwupunktową `path` (spawn `t = time`, despawn `t = time + 1`). |
| `tests/playback-rate.test.ts` | 4 testy tempa odtwarzania (`node`, ADR-0016): 0,25× i 2× przez kilka sekund wideo bez fałszywego `resync`, prawdziwy seek nadal wykrywany przy 0,25×, brak pola `rate` w próbce zachowuje się jak dotychczas (domyślnie 1×). |
| `tests/path.test.ts` | 7 testów `samplePath` (środowisko `node`, bez jsdom): jeden punkt, przytrzymanie przed pierwszym/za ostatnim punktem, trafienie dokładnie w punkt (też środkowy), lerp `x`/`y`/`size` naraz w połowie segmentu, wybór właściwego segmentu przy 3 punktach, segmenty o różnej długości czasowej liczone względem własnej długości. |
| `tests/engine.test.ts` | 24 testy logiki: spawn dokładnie od `path[0].t`, klik w dowolnym momencie okna aktywności (start/środek/tuż przed despawnem) = trafienie, brak kliku do despawnu = pudło, drugi klik bez efektu, klik przed spawnem ignorowany, pauza (10 s zegara ściennego → zero zmian), wznowienie bez fałszywego seeka, seek w tył i w przód, celność, interpolacja czasu, odporność na szum odczytu, interpolacja ścieżki ruchu (`getView()` w połowie segmentu, zamrożenie pozycji na pauzie, pozycja po seeku w tył bez dryfu). |
| `tests/beatmap.test.ts` | Walidacja (w tym `path` z mniej niż dwoma punktami, pusta/brak `path`, `t` nierosnące/zduplikowane/`NaN`, `x`/`y`/`size` poza zakresem w punkcie ścieżki, sortowanie po `path[0].t`) + sprawdzenie beatmapy produkcyjnej wobec rejestru sprite'ów, że produkcyjna beatmapa faktycznie używa każdego sprite'a z rejestru, że wskazuje `5OyTxEbT-fM`, że nie odwołuje się już do usuniętych kluczy `guy`/`girl` i że każdy obiekt ma `path` z co najmniej dwoma punktami. |
| `tests/smoke.test.ts` | jsdom: bramka startowa, tap → `+1` i HUD, sprite obrazkowy renderuje się jako `<img>` ze źródłem z rejestru, trafienie podmienia `img.src` na wariant `hitSrc`, pudło (despawn bez kliku) zostawia wariant idle i pokazuje `✕`, `size` z punktu ścieżki skaluje `width` obiektu względem bazowych 16%, `left`/`top`/`width` zmieniają się między klatkami wraz z upływem czasu wideo, ścieżka statyczna (dwa punkty w tym samym miejscu) trzyma pozycję mimo upływu czasu, pauza → zero celów w DOM, preload obu wariantów sprite'a przy montażu UI (przed startem odtwarzania), ekran wyniku z liczbami, `.frame` obejmuje scenę i HUD, przycisk pełnego ekranu. |
| `tests/fullscreen.test.ts` | jsdom + atrapa Fullscreen API (jsdom go nie implementuje): pełny ekran bierze `.frame`, toggle w obie strony, odebranie pełnego ekranu przejętego przez iframe, `onLost` gdy odzyskanie zawiedzie, brak API → tryb zastępczy `css` w obie strony. |
| `tests/sound.test.ts` | jsdom + atrapa `HTMLAudioElement` wstrzyknięta przez `make`: trafienie → dokładnie jedno `play()`, klik przed spawnem i despawn bez kliknięcia → zero `play()`, drugi tap w ten sam cel → nadal jedno, seek w tył przez trafiony cel + seek w przód → zero dodatkowych, dwa szybkie trafienia → dwa różne elementy puli (round-robin), `unlock()` dotyka każdego elementu puli, głośność proporcjonalna do `getReferenceVolume()` w ścieżce zapasowej bez Web Audio (jsdom go nie implementuje, więc podwojenie przez `GainNode` nie jest pokryte testem — wymaga weryfikacji w przeglądarce), `describe()` raportuje tryb i stan elementu, przyczynę odrzuconego `play()` oraz licznik odblokowanych elementów puli. Osobny blok na ścieżkę Web Audio z ADR-0017 (podstawiony `AudioContext`, bo jsdom go nie ma): `unlock()` wznawia kontekst i dekoduje bufor, po zdekodowaniu `play()` nie dotyka już puli `<audio>`, `gain` przekracza 1.0, każde trafienie dostaje własny `AudioBufferSourceNode`, nieudane dekodowanie spada na drogę zapasową z przyczyną w `describe()`, powtórny `unlock()` nie tworzy drugiego kontekstu. |
| `tests/rdp.test.ts` | 7 testów `simplifyPath` (`node`, ADR-0016): dwupunktowa ścieżka bez zmian, redukcja punktów kolinearnych, pierwszy/ostatni punkt zawsze zachowane, **przystanek w środku odcinka prostego nie jest usuwany** (metryka czasowa, nie przestrzenna — to kluczowa różnica względem klasycznego RDP), tolerancja respektowana w obie strony, pojedynczy punkt bez zmian. |
| `tests/dev-record.test.ts` | `node`, ADR-0016: `toOverlayPercent` (konwersja px→%, round-trip z formułą renderera, clamping poza rectem, rect zerowy z jsdom), `pushSample` (odrzucanie `t` nierosnącego), `buildPath` (bardzo krótki klik → 2 punkty odległe o 0,25 s, brak próbek → `null`, dłuższa ścieżka upraszczana przez RDP), `nextObjectId` (kolizje z sufiksem), `insertObject`/`removeObject` (sortowanie po `path[0].t`, wynik przechodzi `validateBeatmap`), `Engine.setObjects` (dodany obiekt z przeszłości trafialny po seeku bez ruszania statystyk, usunięcie kasuje wynik ze statystyk). |
| `tests/dev-mode.test.ts` | jsdom, ADR-0016: zaznaczenie checkboxa ustawia najniższe dostępne tempo i z powrotem 1× po odznaczeniu, prawy-drag przez kilka klatek tworzy obiekt o rosnących `t` którego payload przechodzi `validateBeatmap` i trafia do podstawionego `fetch`, podgląd ręki w DOM w trakcie nagrania i zniknięcie po puszczeniu, prawy klik w istniejący obiekt usuwa go bez startu nagrania i bez punktu, lewy klik nadal trafia (brak regresji na `button !== 0`), `contextmenu` jest `preventDefault` tylko przy aktywnym trybie, guzik „Test dzwieku" woła `playHitSound` i po 400 ms wpisuje `describeHitSound()` do paska statusu — także przy odznaczonym checkboxie. |

Test smoke montuje **tę samą grę** co produkcja (`mountGame` z `src/game.ts`), tylko
z podstawionym `TimeSource`.

Domyślne środowisko Vitest to `node`; jsdom włącza wyłącznie `smoke.test.ts` przez
docblock `@vitest-environment jsdom` — `path.test.ts` też jest `node`, bo `samplePath`
nie dotyka DOM.

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
- `jsdom` przypięty do `^25`; wersja 27 wymaga `require(ESM)`, czyli Node ≥ 20.19.
- **`FADE_OUT_MS` przy tempie ≠ 1 (tryb dev, ADR-0016) jest świadomie niespójny.**
  `engine.ts` porównuje sekundy wideo ze stałą wyrażoną w ms zegara ściennego; przy
  0,25× animacja `+1`/`✕` (0,5 s ściennej) kończy się 4× wcześniej niż obiekt zniknie
  z DOM — pusty `.obj` wisi ~1,5 s dłużej. Dotyczy wyłącznie trybu deweloperskiego.
- **Tolerancja RDP `1,0` (tryb dev, ADR-0016) jest dobrana analitycznie**, nie
  z obserwacji nagrania — może wymagać strojenia po pierwszym realnym użyciu.
- **`getAvailablePlaybackRates()`/`setPlaybackRate()` i to, czy player faktycznie
  utrzymuje zwolnione tempo (reklama, zmiana jakości) — niezweryfikowane z prawdziwym
  YouTube**, pokryte wyłącznie atrapami w testach.
- **Długość klipu `5OyTxEbT-fM` nie została programowo zweryfikowana** — YouTube nie
  oddaje `lengthSeconds` przez zwykły fetch. Jeśli klip jest krótszy niż ~54 s, ostatnie
  cele beatmapy nigdy się nie pojawią. Wymaga jednego ręcznego uruchomienia `npm run dev`.
- **Obwódka GIF-a na krawędziach dłoni** — 1-bitowa przezroczystość `hand-idle.gif` /
  `hand-hit.gif` może dać widoczną krawędź na tle konkretnego wideo. Niezweryfikowane
  wizualnie.
- **Wzmocnienie głośności klapsa przez `GainNode` (ADR-0013, ADR-0017) jest
  niezweryfikowane w prawdziwej przeglądarce.** `jsdom` nie implementuje Web Audio
  API, więc `AudioContext` w testach jest **podstawiony** — pokryte jest to, że
  `play()` idzie buforem i jaką wartość dostaje `gain`, ale nie realny poziom
  dźwięku. Wymaga ręcznego sprawdzenia w `npm run dev`: zmień głośność playera
  YouTube i porównaj głośność klapsu.
- **Dźwięk na iOS (ADR-0017) — potwierdzony ręcznie na iPhonie**, po starcie filmu,
  guzikiem „Test dzwieku" w trybie dev. Automatycznie **niepokryty**: jsdom nie ma
  Web Audio, więc testy sprawdzają logikę wyboru ścieżki i wartość `gain`, nie realne
  wyjście dźwięku — regresja tutaj nie wywali `npm test`.
- **Jednostki `cqw` i `container-type: inline-size` (ADR-0014) nie są pokryte
  testami** — `jsdom` nie liczy layoutu, więc niezmienniczość pozycji celu
  względem rozmiaru sceny wymaga jednego ręcznego sprawdzenia w `npm run dev`:
  ten sam cel na telefonie i w pełnym ekranie musi lądować w tym samym miejscu
  kadru.

---

## Gdzie co zmieniać

| Chcę… | Plik |
|---|---|
| zmienić momenty/ścieżkę/rozmiar celów | `src/data/beatmap.json` |
| zmienić sposób interpolacji ścieżki (np. Catmull-Rom) | `src/engine/path.ts` |
| podmienić sprite / dodać wariant hit | `src/sprites.ts` (+ plik w `public/sprites/`) |
| podmienić dźwięk trafienia | `src/sprites.ts` (`HIT_SOUND_SRC`) + plik w `public/sounds/` |
| zmienić rozmiar puli / logikę odtwarzania dźwięku | `src/ui/sound.ts` |
| zmienić zasady trafiania/punktacji | `src/engine/engine.ts` |
| zmienić wygląd | `src/styles.css` |
| zmienić układ DOM / HUD / ekran wyniku / podmianę grafiki na trafieniu | `src/ui/render.ts` |
| zmienić integrację z playerem | `src/ui/youtube.ts` |
| zmienić zachowanie pełnego ekranu | `src/ui/fullscreen.ts` |
| zmienić hosting / ścieżkę bazową | `vite.config.ts` + `docs/DEPLOY.md` |
| zmienić tryb deweloperski nagrywania ścieżki (RDP, zapis, DOM) | `src/dev/*` (patrz [ADR-0016](docs/decisions/ADR-0016-tryb-deweloperski-nagrywania-sciezki.md)) |
| zmienić endpoint zapisu beatmapy dla trybu dev | `vite.config.ts` + `src/dev/beatmap-write-plugin.ts` |

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
| [0013](docs/decisions/ADR-0013-zanikanie-okregu-i-glosnosc-wzgledem-youtube.md) | Zanikanie okręgu po rozstrzygnięciu i głośność względem YouTube |
| [0014](docs/decisions/ADR-0014-sciezka-ruchu-i-niezmiennicza-geometria.md) | Ścieżka ruchu w beatmapie i niezmiennicza geometria |
| [0015](docs/decisions/ADR-0015-usuniecie-okregu-i-pol-czasowych-obiektu.md) | Usunięcie approach circle i pól czasowych obiektu na rzecz `path` |
| [0016](docs/decisions/ADR-0016-tryb-deweloperski-nagrywania-sciezki.md) | Tryb deweloperski nagrywania ścieżki ręki na osi czasu wideo |
| [0017](docs/decisions/ADR-0017-dzwiek-przez-web-audio-na-buforze.md) | Dźwięk trafienia przez Web Audio na zdekodowanym buforze (naprawa ciszy na iOS) |
