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
npm test        # 224 testy, ~2 s, bez sieci — jedyna komenda weryfikacji regresji
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

### Uruchomienie bez trybu deweloperskiego (build produkcyjny)

`npm run dev` zawsze ładuje tryb deweloperski (nagrywanie/edycję ścieżki prawym
przyciskiem myszy). Żeby zobaczyć grę tak, jak wygląda na GitHub Pages — bez kodu
`src/dev/*` — trzeba zbudować i zaserwować `dist/`:

```bash
npm run build     # dist/, base = /game-video-clip/ (ADR-0007)
npm run preview   # http://localhost:4173/game-video-clip/  — UWAGA na tej maszynie nie działa (patrz niżej)
```

⚠️ **`npm run preview` (Vite) na tym Windowsie jest zepsuty** — serwer zwraca
`index.html` dla każdego zapytania, także o realnie istniejące pliki w
`dist/assets/` (błąd `NS_ERROR_CORRUPTED_CONTENT` / zły `Content-Type` w
konsoli przeglądarki). Obejście — zaserwuj `dist/` prostym serwerem statycznym
pod strukturą katalogów odpowiadającą `base: /game-video-clip/`:

```bash
mkdir -p /tmp/preview-root/game-video-clip
cp -r dist/. /tmp/preview-root/game-video-clip/
cd /tmp/preview-root && python -m http.server 4174
# otwórz http://localhost:4174/game-video-clip/
```

### Udostępnienie na zewnątrz przez ngrok

Serwer z powyższego obejścia działa na porcie **4174**:

```bash
ngrok http 4174
```

Wejdź pod link, który wypisze ngrok, dopisując ścieżkę: `https://<losowy-subdomain>.ngrok-free.app/game-video-clip/`
(sam adres bazowy pokaże pustą stronę — `index.html` żyje pod `/game-video-clip/`, nie pod `/`).

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

### Reklamy — zegar reklamy nie dociera do silnika (ADR-0024)

Reklama YouTube ma **własny zegar**. Zmierzone na iOS Safari w trakcie pre-rolla:
`getCurrentTime()` odlicza czas kreacji, `getPlayerState()` siedzi na `-1` (`UNSTARTED`)
i **nigdy** nie zwraca `PLAYING`, a `getDuration()` oraz `getVideoData().video_id`
przez cały czas dotyczą **filmu**, nie reklamy.

Objaw był mylący: silnik był poprawnie **zamrożony**, a mimo to rysował cele nad reklamą.
Powodem jest `adopt()` w gałęzi freeze (`Engine.tick`) — czas gry ma śledzić player także
na pauzie, żeby przewinięcie było widać na ekranie (ADR-0003). Skoro player podawał czas
reklamy, czas gry wędrował po jej osi i `getView()` zwracał cele, które o tej sekundzie
istnieją. **Wadą był czas, nie flaga `playing`.**

Adapter (`src/ui/youtube.ts`) wpuszcza więc odczyt zegara do silnika tylko wtedy, gdy
należy on do treści: film musiał raz ruszyć (`PLAYING` zaobserwowane przez `sample()`)
**i** player nie może być w `UNSTARTED`. Inaczej `sample()` zwraca `playing: false`
oraz **ostatni znany czas treści** (na starcie `0`) — pre-roll trzyma grę na zerze,
mid-roll na ostatniej sekundzie filmu. Silnik nie wie o reklamach nic.

Wcześniejsza detekcja po rozjeździe `getDuration()` z `videoDurationSec`
([ADR-0022](docs/decisions/ADR-0022-wykrywanie-reklam-po-dlugosci-wideo.md)) została
**usunięta** — pomiar pokazał, że nie miała jak zadziałać, a zła wartość w beatmapie
zamrażała grę na cały film. `videoDurationSec` zostaje wyłącznie jako stabilna
długość suwaka transportu.

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
- Po rozstrzygnięciu cel zostaje na ekranie jeszcze **`FADE_OUT_MS = 500`**. Trafienie
  pokazuje animację `+1`; pudło nie pokazuje żadnego feedbacku tekstowego (dłoń po
  prostu znika bez oznaczenia).
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
  "videoDurationSec": 150,
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
| `videoDurationSec` | **Opcjonalne, całe pole beatmapy** (nie obiektu): długość filmu w sekundach. Od ADR-0024 wpływa **tylko** na długość suwaka transportu — rozgrywki nie dotyka. Brak pola = suwak bierze długość z playera i leci `console.warn` z realną wartością. |
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
`x`/`y` punktu poza 0–100, niedodatnim `size` punktu lub niedodatnim/nieskończonym
`videoDurationSec` (gdy pole w ogóle jest). Błąd = komunikat na stronie
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

- **`prefetch()`** — wywoływane przy montażu gry (`mountGame`), **przed bramką
  startową**, tak samo jak `preloadSprites()`. Pobiera plik do pamięci, ale **nie**
  tworzy `AudioContext` (ten wymaga gestu). Bez tego pobranie startowałoby dopiero
  w `unlock()` i pierwsze trafienie mogło wypaść, zanim bufor był gotowy — czyli
  w ciszę. Nieudane pobranie zeruje się, więc `unlock()` ponawia próbę.
- **`unlock()`** — wywoływane raz w `onStart` (`src/game.ts`), w obrębie gestu startowego,
  bo `AudioContext` rodzi się `suspended` i tylko gest pozwala go wznowić. Dekoduje
  **kopię** pobranych bajtów (`decodeAudioData` bywa destrukcyjne dla przekazanego
  `ArrayBuffer`, a ponowna próba nie miałaby wtedy czego dekodować). Powtórne
  wywołanie nie tworzy drugiego kontekstu.
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
- **`describe()`** — jednolinijkowy stan ścieżki dźwięku (`tryb=bufor|pula`,
  `pobrane=tak|trwa|nie`, stan
  `AudioContext`, aktualny `gain`, licznik odtworzeń z bufora, liczba odblokowanych
  elementów puli, `readyState`, `currentTime`/`paused`/`volume` ostatniego elementu
  puli, ostatni błąd). Wyłącznie diagnostyka — nie wpływa na odtwarzanie; konsument to guzik
  „Test dzwieku" w pasku dev (patrz [Tryb deweloperski](#tryb-deweloperski--nagrywanie-ścieżki-ręki)).

**Głośność jest proporcjonalna do aktualnej głośności YouTube i wzmocniona
(ADR-0013, ADR-0017):** `play()` liczy `gain = getReferenceVolume() * LOUDNESS_BOOST`
tuż przed każdym odtworzeniem, gdzie `LOUDNESS_BOOST = 1.5` — dobrane na słuch na
urządzeniu (`4`, `3` i `2` były za głośne) (`getReferenceVolume`
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
<div class="frame">           <!-- position: fixed; inset: 0 na stale — scena + transport zawsze na caly viewport (ADR-0021) -->
  <main class="stage">        <!-- aspect-ratio: 16/9, wspólne dla playera i gry -->
    <div class="player">…</div> <!-- iframe; WYZSZY niz scena o --player-overscan (ADR-0019) -->
    <div class="shield">…</div> <!-- przezroczysta blokada wskaznika, bez stanu -->
    <button class="yt-button-proxy"> <!-- przezroczysty, nad przyciskiem YouTube'a -->
    <div class="overlay">     <!-- pointer-events: none -->
      <button class="obj">    <!-- pointer-events: auto -->
        <img class="sprite">  <!-- src podmieniany na hitSrc przy outcome === 'hit' -->
        <span class="feedback">
    <div class="gate">…</div> <!-- bramka startowa: <button.gate-button> z <img.gate-image> (sprites/start-manual.gif) -->
    <section class="results">… <!-- ekran wyniku -->
  </main>
  <div class="transport">     <!-- PIONOWA kolumna po PRAWEJ stronie sceny: play/pauza, pionowy suwak, (ukryty czas), wyciszenie, punkty, dlon (ADR-0023) -->
    <button id="transport-play" data-icon="play|pause"><svg class="icon">…</svg></button>
    <input id="transport-seek" type="range">
    <span id="transport-time">…</span>
    <button id="transport-mute" data-icon="sound-on|sound-off"><svg class="icon">…</svg></button> <!-- ikona = STAN dzwieku -->
    <span id="hud-score">…</span>
    <span id="hud-hand"><img></span> <!-- statyczna grafika dloni w wariancie "hit" -->
  </div>
</div>
```

Istotne szczegóły:

- **Odtwarzacz nie reaguje na wskaźnik** (`.player iframe { pointer-events: none; }`)
  i nie renderuje własnych kontrolek (`controls: 0`, `disablekb: 1` w `playerVars`,
  `src/ui/youtube.ts`) — klik obok celu nic nie robi, wideo się nie pauzuje. Całe
  sterowanie (play/pauza, przewijanie, wyciszenie) idzie przez pasek
  `.transport` — pionową kolumnę po **prawej** stronie sceny, wewnątrz `.frame`,
  więc działa też w trybie zmaksymalizowanym na viewport (ADR-0021, ADR-0019, ADR-0023). Patrz sekcja
  [Pasek transportu](#pasek-transportu).
- **`.shield` (między `.player` a `.overlay` w DOM) jest przezroczystą, bezstanową
  blokadą wskaźnika.** Ma `pointer-events: auto` i jest malowana nad playerem, ale pod
  `.overlay`/`.gate`/`.results` (kolejność w DOM), więc cele, bramka i ekran
  wyniku zostają klikalne bez zmian; zdarzenia trybu dev (`pointerdown`/
  `contextmenu`, nasłuchiwane na `.stage`) nadal działają, bo bąbelkują z tarczy
  w górę. Szczegóły zasłaniania: sekcja [Pasek transportu](#pasek-transportu)
  i [ADR-0019](docs/decisions/ADR-0019-wlasne-kontrolki-zamiast-kontrolek-youtube.md).
- **`.overlay` kończy się 8% wysokości sceny nad dołem** mimo że kontrolki YouTube
  już nie istnieją — usunięcie tego pasa przesunęłoby wszystkie nagrane `y` o ~8%
  w beatmapie, więc zostaje bez zmian (ADR-0019). W konsekwencji `y%` z beatmapy
  jest liczone względem **warstwy gry**, nie całej sceny. Wartość jest w **procentach**,
  nie w `rem` — poprzednia stała `3,5rem` dawała inny udział wysokości sceny na
  telefonie (27%) niż w pełnym ekranie (5%), więc ten sam `y` z beatmapy lądował
  w innym miejscu kadru (ADR-0014).
- **Grubość obwódki okręgu, cień sprite'a i rozmiar fontu feedbacku są w jednostkach
  `cqw`** (`container-type: inline-size` na `.stage`, 1cqw = 1% szerokości sceny) —
  z tego samego powodu co wyżej: `rem`/`vw` nie skalują się razem z rozmiarem sceny
  w kontenerze, `cqw` tak (ADR-0014).
- **`.frame` jest na stałe `position: fixed; inset: 0`**, żeby scena razem z paskiem
  transportu zawsze zajmowała cały viewport, od pierwszej klatki strony (ADR-0021).
  `.frame` układa dzieci **w wiersz**: scena, a po jej prawej kolumna `.transport`
  o szerokości `--hud-width` (ADR-0023). Szerokość sceny to `--stage-width`.
  ⚠️ Konsekwencja dla trybu dev: `.dev-bar` jest pozycjonowany absolutnie na dole
  ramki — jako zwykłe dziecko `.frame` stałby się trzecią kolumną.
- **Nie ma już approach circle** (usunięty w ADR-0015; historia w ADR-0012/ADR-0013).
  `.obj` renderuje tylko `.sprite` i `.feedback` — sam sprite dłoni jest celem, klikalny
  przez cały czas trwania jego `path`.
- Cała geometria w **procentach**, więc skalowanie 375 px ↔ 1440 px jest darmowe.
- **Wyłącznie w trybie dev**, po zamontowaniu edytora punktów ścieżki
  (`mountDevHandEditor`, ADR-0018): `#frame` zostaje przeniesiony do nowego kontenera
  `.dev-edit-layout` wstawionego obok niego w DOM, a drugim dzieckiem kontenera jest
  panel `.dev-edit-panel` z listą punktów wybranego obiektu. Ta re-parentyzacja nigdy
  nie zachodzi w buildzie produkcyjnym — cały moduł jest wycinany tak jak reszta
  `src/dev/*` (ADR-0016).

---

## Pasek transportu

Własne sterowanie odtwarzaniem zamiast kontrolek YouTube (ADR-0019). Player nie
reaguje na wskaźnik (`.player iframe { pointer-events: none; }`) i nie renderuje
własnych kontrolek (`controls: 0`, `disablekb: 1` w `playerVars`) — klik obok celu
w kadrze nic nie robi, wideo się nie pauzuje i nie pokazuje paska YouTube.

Player nie reaguje na wskaźnik przez dwie warstwy: `.player iframe {
pointer-events: none; }` oraz `.shield` — warstwa `inset: 0` między `.player`
a `.overlay` w DOM z `pointer-events: auto`, która przechwytuje dotyk zanim
dotrze do iframe'a.

### Dlaczego kadr jest zasłaniany poza odtwarzaniem

**Blokada wskaźnika nie ukrywa niczego wizualnie** — to była pierwsza, błędna
próba. Poza stanem `PLAYING` YouTube rysuje własny overlay: pasek tytułu, avatar
kanału, ikonę udostępniania, miniatury powiązanych filmów, logo i duży przycisk
na środku. **Żaden `playerVar` tego nie wyłącza:** `controls: 0` usuwa wyłącznie
dolny pasek kontrolek, `modestbranding` jest martwe od sierpnia 2023, `showinfo`
od 2018, a `rel: 0` od 2018 tylko zawęża propozycje do tego samego kanału,
zamiast je wyłączać.

Branding jest widoczny **także w trakcie odtwarzania** — potwierdzone w
przeglądarce (`0:01 / 2:30`, przycisk „Pauza", pełny branding na ekranie).
Dlatego potrzebne są dwa niezależne środki:

| Środek | Co robi |
|---|---|
| `--player-overscan: max(24%, 120px)` na `.stage` | wypycha poza kadr pasek tytułu, avatar, udostępnianie, „More videos" i logo |
| `.yt-button-proxy` | duży przycisk play/pauza **zostaje widoczny**, ale klik w niego obsługuje nasz transport |

### `--player-overscan` — player wyższy niż scena

YouTube kotwiczy pasek tytułu (góra) oraz ikony i logo (dół) do krawędzi
**playera**, a wideo 16:9 wpisuje w niego z letterboxem. `.player` jest więc
o `--player-overscan` wyższy u góry i u dołu — branding wyjeżdża poza `.stage`
(`overflow: hidden`), a samo wideo, ograniczone szerokością, ląduje **dokładnie
tam, gdzie było**. Dzięki temu **współrzędne beatmapy zostają nietknięte** i 73
nagrane pozycje ręki nie wymagają migracji.

Wartość to `max(24%, 120px)`, nie samo `15%`: branding YouTube'a ma również
**minimalną wysokość w pikselach**, więc na iOS Safari (scena ~520 px, 15% ≈
78 px) u góry zostawał skrawek paska tytułu z avatarem, a u dołu skrawek rzędu
„Więcej filmów" i logo — widoczne na zrzucie z urządzenia. Procent rządzi na
dużym ekranie, próg px na telefonie.

Potwierdzone na urządzeniu: obraz nie jest przybliżony, a cele nadal pokrywają
się z wideo. Gdyby kiedyś przestało — `--player-overscan: 0%` cofa to jedną
linią; gdyby skrawek brandingu wrócił — zwiększ oba człony `max()`.

### `.yt-button-proxy` — duży przycisk na środku zostaje, ale działa

**Tego przycisku nie da się usunąć.** Jest wyśrodkowany **razem z obrazem**:
wideo jest w playerze wycentrowane, więc środek playera to zawsze środek
obrazu — żadne przesunięcie ani skalowanie ich nie rozdzieli. Stylami też nie,
bo iframe jest cross-origin. Każdy CSS ukrywający ten obszar ukrywa tam również
**wideo**, więc do wyboru są tylko trzy warianty: widoczna ikona, zakryty
fragment albo zniekształcony fragment. Zakrycie (czarny krążek) i rozmycie
(`backdrop-filter`) były wdrożone i odrzucone — patrz [ADR-0019](docs/decisions/ADR-0019-wlasne-kontrolki-zamiast-kontrolek-youtube.md).

Skoro ikona zostaje widoczna, ma **działać**. Zdarzeń nie przepuszczamy jednak
do iframe'a (np. dziurą w tarczy) — to przywróciłoby pierwotny błąd, w którym
pudło obok dłoni pauzuje wideo. Zamiast tego własny **przezroczysty przycisk**
dokładnie w tym miejscu, spięty z tym samym `TransportControls` co pasek pod
sceną: wygląd jest YouTube'a, działanie nasze. Leży między `.shield`
a `.overlay`, więc klik w dłoń zawsze z nim wygrywa, i jest `disabled` do
`enableTransport`, tak jak reszta transportu.

Zweryfikowane w przeglądarce (`elementFromPoint`): środek sceny trafia
w `yt-button-proxy`, a każdy inny punkt kadru — w `shield`, czyli nadal nic nie
dociera do iframe'a. **Koszt:** pudło dokładnie w środku kadru (obszar
`--yt-button-size`) wstrzyma wideo zamiast policzyć się jako chybienie.

### `.shield` — przezroczysta blokada wskaźnika

`.shield` nie ma stanu i nic nie zasłania — łapie tylko zdarzenia wskaźnika,
żeby nie dotarły do iframe'a. Wcześniejsza wersja czerniła kadr poza stanem
`PLAYING` (`is-covering` ↔ `view.frozen`), żeby ukryć overlay stanu „pauza";
wycofane, bo skoro duży przycisk i tak zostaje widoczny, czernienie nie
ukrywało już niczego istotnego, a kosztowało podgląd wideo na pauzie.

### Przycisk play jako drugie wejście bramki startowej

Dopóki `.gate` jest widoczna, **klik w `#transport-play` (i w `.yt-button-proxy`)
nie woła `play()`, tylko robi dokładnie to samo co klik w grafikę bramki**: odblokowuje
dźwięk trafienia, chowa bramkę i startuje odtwarzanie. Bez tego kliknięcie play
uruchamiałoby wideo pod wciąż widoczną bramką, a `AudioContext` zostałby
zablokowany — gest użytkownika przepadłby (patrz „Dźwięk trafienia").

Warunkiem jest `gate.hidden`, nie osobna flaga, więc `hideGate()` zamyka bramkę
raz na zawsze i od drugiego kliknięcia play działa jak zwykły przełącznik
play/pauza. Jeśli player nie jest jeszcze gotowy (`setStartEnabled(false)`,
przygaszona grafika bramki), klik w play **nie robi nic** — tak samo jak klik w bramkę.

### Ikony transportu — inline SVG, nie glify Unicode

Ikony `#transport-play` i `#transport-mute` są **inline SVG** (`ICONS`
w `src/ui/render.ts`, `viewBox="0 0 24 24"`, `fill="currentColor"`). Wcześniej
były znakami Unicode (`▶︎`, `❚❚`, `🕪`, `🕪×`) i **na iPhonie rysowały się jako
puste kwadraty** — iOS nie ma tych znaków w foncie systemowym. Rastrowe grafiki
byłyby gorsze: kolejne pliki do wczytania i rozmycie przy skalowaniu, podczas gdy
SVG nie zależy od fontu ani od sieci i dziedziczy kolor tekstu.

Nazwa ikony żyje w **`data-icon`** na przycisku (`play` / `pause` / `sound-on` /
`sound-off`) — po `textContent` nie da się już rozpoznać stanu, bo jest pusty.
`setIcon()` podmienia zawartość tylko przy faktycznej zmianie nazwy, więc
`render()` nie przepisuje DOM co klatkę. Rozmiar ustawia `.transport-icon .icon`
w CSS (`1.25rem`), nie `font-size`.

**Ikona dźwięku pokazuje stan, nie akcję:** głośnik z falami = dźwięk gra,
przekreślony = wyciszony. Statyczny HTML startuje z `sound-on`, bo wideo startuje
z dźwiękiem — inaczej pierwsza klatka strony kłamałaby o stanie. `aria-pressed`
i `aria-label` opisują natomiast akcję („Wycisz" / „Wlacz dzwiek").
Stan ikony jest **odczytywany z playera co klatkę** (`controls.isMuted()` w `render`),
a nie wyprowadzany ze skutku ostatniego kliknięcia — YouTube potrafi zmienić wyciszenie
sam (autoplay, iOS), więc ikona musi nadążać także za zmianą spoza przycisku.

### Układ paska — pionowa kolumna po prawej (ADR-0023)

Pasek nie leży pod sceną, tylko **po jej prawej stronie, jako jedna pionowa linia** —
zawsze, także na desktopie (jeden układ zamiast dwóch). Powód: scena trzyma `16/9`
i na telefonie jest ograniczona **wysokością**, więc pasek poziomy zabierał wysokość,
a razem z nią — w proporcji 16:9 — także szerokość obrazu. Kolumna zabiera szerokość,
której kadr i tak nie wykorzystywał:

`--stage-width: min(100vw - var(--hud-width), 100dvh * 16 / 9, 1280px)`

- **Suwak jest pionowy przez `writing-mode: vertical-lr`** (Safari 17.4+, Chrome 124+).
  ⚠️ Zdeprecjonowanego `-webkit-appearance: slider-vertical` **już nie ma** — nie da się
  go pogodzić z `appearance: none`, a to jedyna droga do własnych kolorów. Cena:
  na iOS Safari < 17.4 suwak wraca do poziomu.
- **Czas leci z góry w dół** — góra to `0:00`, dół to koniec filmu (`direction: ltr`,
  zapisane wprost przy suwaku).
- **Transport ma dwa kolory: żółty `#f5c518` i zielony `#048322`.** Przyciski play
  i wyciszenia to **żółte koła z zieloną ikoną** (tło i obwódka na `.transport-icon`,
  a kolor samej ikony przez `color`, bo SVG mają `fill="currentColor"`; ikony mają
  dodatkowo delikatny czarny kontur — `stroke` + `paint-order: stroke` na `.icon`,
  czyli kreska pod wypełnieniem, w jednostkach `viewBox`, więc skaluje się z ikoną.
  Łuki fal dźwięku zostają bez konturu: mają własne `stroke="currentColor"` w atrybucie,
  a atrybut elementu wygrywa z wartością dziedziczoną). Tor suwaka
  jest żółty, kuleczka zielona. Liczba punktów — żółta.
- **Liczba punktów naśladuje napis „TAP TO START"** z grafiki bramki: najcięższy
  dostępny krój bezszeryfowy ze stosu systemowego (`'Arial Black', Impact, …`),
  `font-weight: 900` i ciemna obwódka przez `text-shadow`. Font z grafiki jest
  rastrem — nie mamy jego pliku, a projekt nie pobiera assetów z internetu, więc to
  przybliżenie, nie ten sam krój.
- **Tor jest żółty (`#f5c518`), kuleczka zielona (`#048322`).** Dwa kolory wykluczają
  `accent-color` (koloruje tor i kciuk jednym), więc suwak jest stylowany ręcznie:
  tłem toru jest **sam element** `input`, a tory w `::-webkit-slider-runnable-track` /
  `::-moz-range-track` są przezroczyste, żeby kolor się nie dublował. Kciuk ma własne
  tło w `::-webkit-slider-thumb` / `::-moz-range-thumb`.
- **Licznik czasu jest ukryty** (`.transport-time { display: none }`) — w kolumnie
  `3.5rem` nie mieści się „0:12 / 2:30", a postęp pokazuje suwak. Element zostaje
  w DOM i `render()` nadal go aktualizuje.

Dłoń w HUD ma `5rem` i to ona wyznacza `--hud-width`; stoi tuż nad liczbą punktów
i jak najdalej od ikony dźwięku (`margin-top: auto` + ujemny `margin-bottom`).
Szerszej kolumny **nie widać na telefonie** — tam `--stage-width` i tak wybiera człon
wysokościowy `100dvh * 16 / 9`, nie szerokościowy.

**Pokrętła** (w `src/styles.css`): `--hud-width` (szerokość kolumny transportu),
`--player-overscan` (ile playera wystaje poza scenę) i `--yt-button-size`
(jak duży jest klikalny środek).

Pas `8%` na dole `.overlay` (dawna rezerwa na kontrolki YouTube) zostaje bez zmian
mimo utraty uzasadnienia — patrz sekcja [Warstwa gry i DOM](#warstwa-gry-i-dom).

---

## Pełny ekran

**Nie ma już Fullscreen API** (ADR-0021, unieważnia ADR-0010) — właściciel produktu
nie chciał prawdziwego trybu pełnoekranowego przeglądarki (pasek adresu w Chrome na
Androidzie potrafi wrócić, wymaga gestu użytkownika, na iPhonie nie istnieje wcale).
Zamiast tego `.frame` jest **zawsze** `position: fixed; inset: 0`, czyli zajmuje cały
viewport od pierwszej klatki strony — zanim ktokolwiek kliknie bramkę startową, nie tylko po.
`html, body { overflow: hidden }` na stałe, bo strona nigdy nie ma nic poza `.frame`.

- **`fs: 0`** w `playerVars` — przycisk pełnego ekranu YouTube jest wyłączony;
  razem z `controls: 0` i `disablekb: 1` (ADR-0019) nie ma już sposobu, żeby
  iframe sam wszedł w natywny pełny ekran, więc nie potrzeba strażnika przejęcia
  (dawny `src/ui/fullscreen.ts` usunięty razem z `tests/fullscreen.test.ts`).
- **Geometria w procentach** (ADR-0014), więc `.frame` na cały viewport skaluje
  scenę i pasek transportu za darmo — `--stage-width` liczy się z `100dvh`.
- **Wymuszona orientacja pozioma na dotyku:** `@media (orientation: portrait) and
  (pointer: coarse)` obraca `.frame` o 90° (`transform: rotate(90deg)`, `width:
  100dvh`, `height: 100dvw`, zakotwiczone w `top: 0; left: 100%`; w tej regule
  `--stage-width` **zamienia jednostki** — `min(100dvh - var(--hud-width), 100dvw * 16 / 9,
  1280px)`, bo obrócona ramka ma szerokość `100dvh`; jednostki **dynamiczne**, bo
  `100vh` na iOS Safari to wysokość bez pasków przeglądarki — po obrocie stawała się
  pionowym rozmiarem ramki i chowała prawą krawędź (pasek transportu) pod dolnym
  paskiem Safari; bez tego scena dostawała szerokość
  portretu i wideo było bez potrzeby małe, ADR-0023) — telefon trzymany
  pionowo i tak dostaje układ poziomy, wideo zajmuje maksimum ekranu bez czekania,
  aż ktoś fizycznie obróci urządzenie. `pointer: coarse` ogranicza to do ekranów
  dotykowych — okno przeglądarki na desktopie zwężone do portretu nie jest obracane.

### PWA — jedyny sposób na ukrycie pasków Safari na iPhonie

`.frame` zajmuje cały viewport, ale na iPhonie **poza viewportem** zostają jeszcze
paski Safari: adresu u góry i nawigacji u dołu. Nie da się ich schować ani CSS-em,
ani JS-em — Safari usunął tę możliwość, a przy każdym geście wracają.

**Prawdziwego pełnego ekranu nie da się tu zrobić.** iPhone nie ma Fullscreen API
dla dowolnego elementu (`element.requestFullscreen()` nie istnieje na iOS; na
iPadzie od 12+ tak). Jedyne natywne wejście w pełny ekran to
`video.webkitEnterFullscreen()` na elemencie `<video>` — a nasz `<video>` siedzi
w **cross-origin iframie** YouTube'a, więc jest nieosiągalny (IFrame API też nie
wystawia takiej metody). Nawet gdyby był: natywna warstwa wideo iOS rysuje się
**nad całą stroną**, więc `.overlay` z celami, `.transport` i HUD zniknęłyby pod
spodem — dostalibyśmy czyste wideo bez gry.

Zostaje **uruchomienie z ekranu początkowego** („Udostępnij” → „Do ekranu
początkowego”). Wtedy paski Safari nie istnieją, a strona dostaje cały ekran:

| Plik | Rola |
|---|---|
| `public/manifest.webmanifest` | `display: fullscreen`, `orientation: landscape`, `start_url`/`scope` **względne** (build siedzi w podścieżce `/game-video-clip/`), ikony 192/512 z `purpose: "any maskable"` |
| `<meta name="apple-mobile-web-app-capable">` w `index.html` | iOS nie honoruje `display` z manifestu przy dodawaniu do ekranu początkowego — ten meta jest tam warunkiem trybu bez pasków |
| `<link rel="apple-touch-icon" href="icons/icon-180.png">` | iOS ignoruje `icons` z manifestu; bez tej linii robi ikonę ze **zrzutu strony** |
| `scripts/make-icons.mjs` | generuje `public/icons/icon-{180,192,512}.png` |

Ikony są **generowane proceduralnie** (ADR-0005), nie pobierane — `node
scripts/make-icons.mjs` maluje cel (koncentryczne pierścienie `#6ef58f` na tle
`#101014`) własnym enkoderem PNG na `node:zlib`, bez żadnej zależności graficznej.
Grafika mieści się w 40% promienia od środka, więc przetrwa przycięcie maski
Androida i zaokrąglenie rogów iOS. Skrypt jest jednorazowy — PNG-i są w repo,
uruchamiaj go tylko po zmianie wyglądu ikony.

⚠️ **Niezweryfikowane na urządzeniu:** faktyczne zniknięcie pasków Safari po
dodaniu do ekranu początkowego i wygląd ikony na iOS.

---

## Wejście i mobile

- Nasłuchujemy **`pointerdown`** — jedno zdarzenie dla myszy, dotyku i pióra. Nie
  `click`, bo po dotyku odpaliłby się drugi raz.
- `touch-action: manipulation` na scenie → brak 300 ms opóźnienia i brak double-tap-zoom.
- **Bramka startowa jest wymuszona technicznie:** przeglądarki blokują
  odtwarzanie z dźwiękiem bez gestu użytkownika, a `autoplay=1` tego nie omija.
  Bramka nie ma napisu ani osobnej podpowiedzi — całą treść (instrukcja „klik →
  +1" i „tap to start") niesie jedna grafika `public/sprites/start-manual.gif`
  w `<img class="gate-image">`, a `<button class="gate-button">` jest tylko
  przezroczystym obszarem klikalnym wokół niej. Przycisk jest wyłączony
  (przygaszony, `aria-label="Ladowanie…"`) do `onReady` playera.
- **Bramkę otwiera też przycisk play paska transportu** (i `.yt-button-proxy`) —
  patrz [Pasek transportu](#pasek-transportu).
- Gra rusza dopiero gdy player wejdzie w `PLAYING` — nie w momencie kliknięcia. Dzięki
  temu buforowanie i ewentualna reklama nie zjadają pierwszych celów.
- Ten sam gest startowy odblokowuje dźwięk trafienia (`sound.unlock()` w `src/game.ts`) —
  patrz sekcja „Dźwięk trafienia" w sekcji [Sprite'y](#sprite-y).
- **Prawy przycisk myszy nigdy nie liczy się jako trafienie** (`event.button !== 0` w
  `src/ui/render.ts` przerywa obsługę `onHit` przed `preventDefault()`) — prawy przycisk
  jest zarezerwowany dla trybu deweloperskiego (patrz niżej).
- **Tap/klik w puste miejsce kadru (obok celu) nic nie robi** — odtwarzacz nie
  reaguje na wskaźnik i nie ma własnych kontrolek (ADR-0019). Całe sterowanie jest
  w pasku `.transport` po prawej stronie sceny, patrz sekcja [Pasek transportu](#pasek-transportu).

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

**Jak używać:** `npm run dev`, kliknij bramkę startową, zaznacz checkbox „Developer: edycja
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
gestem); `odblokowane=0/4` po kliknięciu bramki startowej oznacza, że `unlock()` nie zadziałał.

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

**Poza zakresem (świadomie):** undo/redo, timeline, wybór sprite'a inny niż `hand`.
Edycja/przeciąganie istniejących punktów ścieżki i zmiana `size` są dostępne w
osobnym trybie — patrz niżej.

---

## Tryb deweloperski — edycja punktów ścieżki

Drugi, niezależny tryb dev (checkbox „Developer: edycja punktów ścieżki" obok
checkboxa nagrywania — **oba wyłącznie w `npm run dev`**, patrz zasady wycinania z
buildu wyżej). Pozwala poprawić już nagraną ścieżkę bez ponownego nagrywania jej od
zera: wybór obiektu, podgląd punktów `path` w panelu obok sceny, przesunięcie
istniejącego punktu (drag ręki) lub zmiana jego `size` (drag uchwytu), zapis na dysk
tym samym mechanizmem co tryb nagrywania (`POST /__beatmap`).

**Jak używać:** zaznacz checkbox — silnik zostaje spauzowany (`pause()`), a `.overlay`
dostaje `dev-active` tak samo jak w trybie nagrywania (oba tryby wykluczają się
nawzajem — włączenie jednego wyłącza drugi, patrz `src/main.ts`). Nad sceną pojawia
się `.dev-time-display` z aktualnym czasem wideo w formacie `M:ss.mm` (minuty:sekundy,
setne części sekundy — np. `1:23.45`), aktualizowany co klatkę (`formatClock` w
`src/dev/record.ts`); widoczny wyłącznie, gdy ten tryb jest aktywny. Kliknij lewym
przyciskiem myszy w obiekt na scenie — po prawej stronie sceny pojawia się panel z
listą punktów jego ścieżki.

Każdy wiersz punktu pokazuje cztery **osobno podpisane** pola liczbowe w stałej
kolejności `t:`, `s:` (size), `x:`, `y:`, edytowalne przez wpisanie wartości, przycisk
`#<indeks>` do wyboru punktu (do drag-a na scenie) i przycisk `−` do jego usunięcia.
Wpisanie wartości i opuszczenie pola (`change`) zapisuje ją natychmiast — tym samym
mechanizmem koalescencji zapisu, co drag na scenie (patrz niżej). Zmiana `t` musi
zachować ściśle rosnącą kolejność punktów w ścieżce (`validateBeatmap`); w przeciwnym
razie zmiana jest odrzucana, pole wraca do poprzedniej wartości, a status pokazuje
komunikat błędu. Kliknięcie przycisku `#<indeks>` przewija wideo do czasu tego punktu
(`seekBy(point.t - timeSec)`) i go zaznacza — **to jedyny sposób wyboru punktu do
edycji drag-iem**, klik w rękę na scenie nigdy sam z siebie nie zmienia wybranego
punktu. Gdy punkt jest wybrany, kolejne przeciągnięcie ręki po scenie przesuwa
**wyłącznie ten punkt** (`x`/`y`); przeciąganie zielonego uchwytu w rogu pierścienia
zaznaczenia zmienia jego `size` proporcjonalnie do zmiany odległości kursora od
środka obiektu. Bez wybranego punktu przeciąganie ręki nic nie robi.

Między wierszami punktów (i przed pierwszym/za ostatnim) panel pokazuje przycisk
`+` do dodania nowego punktu. Kliknięcie otwiera w tym miejscu wiersz z tymi samymi
czterema polami (`t`/`s`/`x`/`y`), od razu wypełniony **bieżącymi wartościami w
aktualnym momencie wideo**: `t` = bieżący czas (`engine.getView().timeSec`), a
`x`/`y`/`size` = zinterpolowana pozycja *aktualnie wybranego obiektu* w tym
momencie (jeśli obiekt jest akurat widoczny — poza jego oknem `path` pola
`x`/`y`/`size` zostają puste). Te wartości od razu próbują się zapisać, tym samym
mechanizmem co ręczna edycja pola — kolizja `t` z istniejącym punktem (typowo, gdy
bieżący czas pokrywa się z już istniejącym punktem) jest odrzucana z komunikatem
błędu, a wiersz roboczy zostaje otwarty z tymi wartościami do poprawki (zwykle
wystarczy podkręcić `t`). Wiersz roboczy ma przycisk `×` do anulowania; punkt
zawsze trafia do beatmapy dopiero, gdy **wszystkie cztery pola są wypełnione** i
zgodne z `validateBeatmap` — wstawiany jest wtedy w pozycję wyznaczoną przez jego
`t` (sortowanie, nie miejsce kliknięcia `+`).
Przycisk `−` przy każdym punkcie usuwa go natychmiast (bez potwierdzenia) i zapisuje
zmianę tym samym mechanizmem. Ponieważ `path` zawsze wymaga co najmniej spawn +
despawn (`MIN_PATH_POINTS` w `src/dev/record.ts`), usunięcie punktu ze ścieżki,
która ma dokładnie 2 punkty, nie usuwa pojedynczego punktu — usuwa **cały obiekt**
(`removeObject`, ten sam mechanizm co prawy klik w obiekt w trybie nagrywania,
ADR-0016) i czyści zaznaczenie/panel. `−` nigdy nie jest zablokowany.

Wszystkie interakcje (drag, edycja pól, dodawanie/usuwanie punktów) wymagają
zamrożonego silnika (pauzy) — w trakcie odtwarzania tryb nie reaguje na klik/drag/
edycję.

Każda zmiana trafia **natychmiast i bez throttlingu** do silnika
(`Engine.setObjects`) — podgląd na scenie jest błyskawiczny. Zapis na dysk jest
**koalescowany**: każda zmiana ustawia flagę `dirty`, a `onFrame()` wysyła co
najwyżej jeden `fetch('/__beatmap')` na raz i dopiero po jego zakończeniu (sukces
lub błąd) wysyła kolejny, jeśli w międzyczasie coś się zmieniło. Bez tego przy
częstych `pointermove` wiele równoległych requestów mogłoby wrócić w innej
kolejności niż zostały wysłane i nadpisać nowszy stan starszym — `beatmap-write-plugin.ts`
robi pełny atomowy zapis całej beatmapy przy każdym żądaniu, bez numeru porządkowego.

Oba tryby dzielą jedną beatmapę w pamięci przez `BeatmapStore`
(`src/dev/beatmap-store.ts`) — dzięki temu przełączenie trybu w trakcie edycji nie
gubi niezapisanych zmian zrobionych w drugim. Wzajemna wyłączność jest sterowana
przez `main.ts`: każdy moduł dostaje `onActiveChange`, wywoływane po zmianie
checkboxa, i wystawia `deactivate()`/`setDisabled()`; `main.ts` łączy oba tak, że
aktywacja jednego trybu dezaktywuje i blokuje checkbox drugiego. Szczegóły
projektowe (odwrócenie YAGNI z ADR-0016, wybór `BeatmapStore`, mechanizm
wyłączności, koalescencja zapisu) — w
[ADR-0018](docs/decisions/ADR-0018-tryb-deweloperski-edycji-punktow-sciezki.md).

| Plik | Rola |
|---|---|
| `src/dev/hand-editor.ts` | `mountDevHandEditor` — wybór obiektu/punktu, drag przesunięcia i drag rozmiaru, edycja pól `t`/`s`/`x`/`y` w panelu, dodawanie punktu przez `+` między wierszami (`currentDraftDefaults` wypełnia od razu bieżącym czasem wideo i zinterpolowaną pozycją zaznaczonego obiektu, wstawia natychmiast jeśli wszystkie pola się zgadzają), usuwanie punktu przez `−` (na ścieżce z 2 punktami usuwa cały obiekt zamiast być zablokowane), wyświetlacz czasu wideo, koalescencja zapisu (`dirty`/`persistInFlight`). |
| `src/dev/record.ts` | Współdzielone z trybem nagrywania: `updatePathPoint` (kopia beatmapy ze zmienionym punktem — `t` bez clampu, walidowane wyżej przez `validateBeatmap`; `x`/`y` clamp 0–100, `size` ≥ `MIN_SIZE`), `insertPathPoint` (kopia z nowym punktem dopisanym i posortowanym po `t`, walidacja po stronie wołającego), `removePathPoint` (kopia bez wskazanego punktu; no-op na/poniżej `MIN_PATH_POINTS` —
wołający, `hand-editor.ts`, w tym wypadku usuwa cały obiekt przez `removeObject`
zamiast wołać `removePathPoint`), `computeDragResize` (nowy `size` proporcjonalny do zmiany odległości kursora od środka), `distancePercent`, `formatClock` (czas wideo jako `M:ss.mm`, używany też przez `.dev-time-display`). |
| `src/dev/beatmap-store.ts` | `BeatmapStore` (`get`/`set`) — jedna beatmapa w pamięci współdzielona przez oba tryby dev (ADR-0018), żeby przełączenie trybu w trakcie edycji nie gubiło niezapisanych zmian z drugiego. |

Panel (`.dev-edit-panel`, obok `.frame` w nowym kontenerze `.dev-edit-layout`
wstawianym do DOM tylko przy montażu tego modułu) jest budowany od zera przy każdej
zmianie zaznaczenia lub ścieżki. Pierścień zaznaczenia i uchwyt rozmiaru to te same
elementy `.dev-selection-ring`/`.dev-size-handle` z `Ui.setHandSelection`, których UI
(`src/ui/render.ts`) nie zna — steruje nimi wyłącznie ten moduł, wołając
`setHandSelection` co klatkę (`onFrame()`) z zinterpolowaną pozycją aktualnie
zaznaczonego obiektu; gdy obiekt nie jest akurat widoczny (poza oknem `path`),
pierścień znika.

Pod nagłówkiem `Sciezka: <id>` panel ma guzik `.dev-edit-panel-delete-point`
("Usuń punkt"), widoczny wyłącznie gdy oprócz obiektu wybrany jest też konkretny
punkt (klik `#<indeks>` w wierszu) — kliknięcie wywołuje tę samą funkcję co przycisk
`−` przy wierszu punktu, więc na ścieżce z dokładnie 2 punktami usuwa cały obiekt
zamiast być zablokowane (patrz wyżej).

---

## Testy

`npm test` — **214 testów, jedyna komenda potrzebna do weryfikacji regresji.** Bez sieci,
bez prawdziwego YouTube, deterministyczne.

| Plik | Zakres |
|---|---|
| `tests/fake-clock.ts` | `FakeClock` — czas wideo i zegar ścienny sterowane **niezależnie**: `advance()` (odtwarzanie), `advanceWallOnly()` (pauza/buffering), `seekTo()` (przewinięcie), `advanceAtRate(sec, rate)` (odtwarzanie przy zadanym tempie — `sec` to sekundy wideo, zegar ścienny płynie proporcjonalnie). Fabryka `obj()` tworzy domyślnie dwupunktową `path` (spawn `t = time`, despawn `t = time + 1`). |
| `tests/playback-rate.test.ts` | 4 testy tempa odtwarzania (`node`, ADR-0016): 0,25× i 2× przez kilka sekund wideo bez fałszywego `resync`, prawdziwy seek nadal wykrywany przy 0,25×, brak pola `rate` w próbce zachowuje się jak dotychczas (domyślnie 1×). |
| `tests/path.test.ts` | 7 testów `samplePath` (środowisko `node`, bez jsdom): jeden punkt, przytrzymanie przed pierwszym/za ostatnim punktem, trafienie dokładnie w punkt (też środkowy), lerp `x`/`y`/`size` naraz w połowie segmentu, wybór właściwego segmentu przy 3 punktach, segmenty o różnej długości czasowej liczone względem własnej długości. |
| `tests/engine.test.ts` | 24 testy logiki: spawn dokładnie od `path[0].t`, klik w dowolnym momencie okna aktywności (start/środek/tuż przed despawnem) = trafienie, brak kliku do despawnu = pudło, drugi klik bez efektu, klik przed spawnem ignorowany, pauza (10 s zegara ściennego → zero zmian), wznowienie bez fałszywego seeka, seek w tył i w przód, celność, interpolacja czasu, odporność na szum odczytu, interpolacja ścieżki ruchu (`getView()` w połowie segmentu, zamrożenie pozycji na pauzie, pozycja po seeku w tył bez dryfu). |
| `tests/beatmap.test.ts` | Walidacja (w tym `path` z mniej niż dwoma punktami, pusta/brak `path`, `t` nierosnące/zduplikowane/`NaN`, `x`/`y`/`size` poza zakresem w punkcie ścieżki, sortowanie po `path[0].t`) + sprawdzenie beatmapy produkcyjnej wobec rejestru sprite'ów, że produkcyjna beatmapa faktycznie używa każdego sprite'a z rejestru, że wskazuje `5OyTxEbT-fM`, że nie odwołuje się już do usuniętych kluczy `guy`/`girl` i że każdy obiekt ma `path` z co najmniej dwoma punktami. |
| `tests/smoke.test.ts` | jsdom: bramka startowa pokazuje `#gate-image` ze źródłem `sprites/start-manual.gif`, nie ma `.gate-hint` ani napisu w przycisku, a klik w grafikę chowa bramkę, tap → `+1` i HUD, sprite obrazkowy renderuje się jako `<img>` ze źródłem z rejestru, trafienie podmienia `img.src` na wariant `hitSrc`, pudło (despawn bez kliku) zostawia wariant idle i pokazuje `✕`, `size` z punktu ścieżki skaluje `width` obiektu względem bazowych 16%, `left`/`top`/`width` zmieniają się między klatkami wraz z upływem czasu wideo, ścieżka statyczna (dwa punkty w tym samym miejscu) trzyma pozycję mimo upływu czasu, pauza → zero celów w DOM, preload obu wariantów sprite'a przy montażu UI (przed startem odtwarzania), ekran wyniku z liczbami, `.frame` obejmuje scenę i pasek transportu. Osobny blok **„pasek transportu" (ADR-0019)**: guziki i suwak `disabled` przed `enableTransport`, odblokowanie po jego wywołaniu, klik play woła `play()`/`pause()` zależnie od ostatnio wyrenderowanego `frozen`, `render()` ustawia wartość suwaka i etykietę czasu z `view.timeSec` + `getDuration()`, `getDuration()` zwracające `0` jest odpytywane co klatkę aż do pierwszej dodatniej wartości i potem już nie, `input` na suwaku wstrzymuje aktualizację z `render()` bez wołania `seekTo`, `change` woła `seekTo` z wartością suwaka, mute przełącza `setMuted` i aktualizuje `aria-pressed`/etykietę, `data-icon` przycisku mute odzwierciedla stan dźwięku (`sound-on` / `sound-off`) już od pierwszej klatki, przed `enableTransport`, ikona play przechodzi w `pause` wraz z wyrenderowanym stanem odtwarzania, obie ikony są inline SVG (`svg.icon` z `viewBox="0 0 24 24"` i `<path>`, pusty `textContent` — regresja glifów Unicode niewidocznych na iOS), klik w play przy widocznej bramce startuje grę (chowa `.gate`, woła `onStart`) zamiast wołać `play()`, a dopiero drugi klik przełącza odtwarzanie, to samo dla `.yt-button-proxy`, oraz klik w play nie robi nic, dopóki `setStartEnabled(false)`. Osobne testy warstw ADR-0019: `.shield` i `.yt-button-proxy` istnieją w DOM w kolejności `.player` → `.shield` → `.yt-button-proxy` → `.overlay`; `.shield` jest bezstanowa (klasa nie zmienia się przy pauzie ani odtwarzaniu, czyli kadr nie jest zasłaniany); `.yt-button-proxy` jest `disabled` do `enableTransport` i odblokowuje się po nim, a klik w niego woła `play()`/`pause()` zależnie od ostatnio wyrenderowanego `frozen`. Realne blokowanie dotyku i geometria `--player-overscan` nie są pokryte — jsdom nie liczy layoutu. |
| `tests/youtube.test.ts` | jsdom + atrapa `window.YT.Player`: `playerVars` zawiera `controls: 0`, `disablekb: 1`, `fs: 0`, `playsinline: 1`, `rel: 0` (ADR-0019); `setMuted(false)` woła `unMute()` **i** `setVolume(100)`, `setMuted(true)` woła `mute()`; `isMuted()` i `getDuration()` proxują na player; `seekTo(sec)` proxuje na `player.seekTo(sec, true)` (absolutny, obok `seekBy` dla trybu dev). |
| `tests/sound.test.ts` | jsdom + atrapa `HTMLAudioElement` wstrzyknięta przez `make`: trafienie → dokładnie jedno `play()`, klik przed spawnem i despawn bez kliknięcia → zero `play()`, drugi tap w ten sam cel → nadal jedno, seek w tył przez trafiony cel + seek w przód → zero dodatkowych, dwa szybkie trafienia → dwa różne elementy puli (round-robin), `unlock()` dotyka każdego elementu puli, głośność proporcjonalna do `getReferenceVolume()` w ścieżce zapasowej bez Web Audio (jsdom go nie implementuje, więc podwojenie przez `GainNode` nie jest pokryte testem — wymaga weryfikacji w przeglądarce), `describe()` raportuje tryb i stan elementu, przyczynę odrzuconego `play()` oraz licznik odblokowanych elementów puli. Osobny blok na ścieżkę Web Audio z ADR-0017 (podstawiony `AudioContext`, bo jsdom go nie ma): `unlock()` wznawia kontekst i dekoduje bufor, po zdekodowaniu `play()` nie dotyka już puli `<audio>`, `gain` przekracza 1.0, każde trafienie dostaje własny `AudioBufferSourceNode`, nieudane dekodowanie spada na drogę zapasową z przyczyną w `describe()`, powtórny `unlock()` nie tworzy drugiego kontekstu, `prefetch()` pobiera plik **bez** tworzenia `AudioContext`, `unlock()` po `prefetch()` nie pobiera drugi raz, nieudany `prefetch()` nie blokuje ponowienia w `unlock()`. |
| `tests/rdp.test.ts` | 7 testów `simplifyPath` (`node`, ADR-0016): dwupunktowa ścieżka bez zmian, redukcja punktów kolinearnych, pierwszy/ostatni punkt zawsze zachowane, **przystanek w środku odcinka prostego nie jest usuwany** (metryka czasowa, nie przestrzenna — to kluczowa różnica względem klasycznego RDP), tolerancja respektowana w obie strony, pojedynczy punkt bez zmian. |
| `tests/dev-record.test.ts` | `node`, ADR-0016/ADR-0018: `toOverlayPercent` (konwersja px→%, round-trip z formułą renderera, clamping poza rectem, rect zerowy z jsdom), `pushSample` (odrzucanie `t` nierosnącego), `buildPath` (bardzo krótki klik → 2 punkty odległe o 0,25 s, brak próbek → `null`, dłuższa ścieżka upraszczana przez RDP), `nextObjectId` (kolizje z sufiksem), `insertObject`/`removeObject` (sortowanie po `path[0].t`, wynik przechodzi `validateBeatmap`), `Engine.setObjects` (dodany obiekt z przeszłości trafialny po seeku bez ruszania statystyk, usunięcie kasuje wynik ze statystyk), `updatePathPoint` (w tym modyfikacja `t`), `formatClock` (poniżej/powyżej minuty, dwucyfrowe minuty, zaokrąglanie setnych w górę, zero, wartości ujemne clampowane do `0:00.00`). |
| `tests/dev-mode.test.ts` | jsdom, ADR-0016: zaznaczenie checkboxa ustawia najniższe dostępne tempo i z powrotem 1× po odznaczeniu, prawy-drag przez kilka klatek tworzy obiekt o rosnących `t` którego payload przechodzi `validateBeatmap` i trafia do podstawionego `fetch`, podgląd ręki w DOM w trakcie nagrania i zniknięcie po puszczeniu, prawy klik w istniejący obiekt usuwa go bez startu nagrania i bez punktu, lewy klik nadal trafia (brak regresji na `button !== 0`), `contextmenu` jest `preventDefault` tylko przy aktywnym trybie, guzik „Test dzwieku" woła `playHitSound` i po 400 ms wpisuje `describeHitSound()` do paska statusu — także przy odznaczonym checkboxie. |
| `tests/dev-hand-editor.test.ts` | jsdom: 3 testy `Ui.setHandSelection` (tworzenie pierścienia z uchwytem, aktualizacja bez duplikatu, usunięcie po `null`) + `mountDevHandEditor` (tryb edycji punktów ścieżki): aktywacja woła `pause()`, klik w obiekt pokazuje panel z wierszem na punkt (pola `t`/`x`/`y`/`size` z wartościami punktu) i pierścień zaznaczenia, `.dev-time-display` widoczny wyłącznie gdy tryb aktywny i pokazuje `formatClock(timeSec)`, klik przycisku `#<indeks>` w wierszu panelu woła `seekBy(point.t - timeSec)` i zaznacza wyłącznie ten wiersz, drag ręki przed wyborem punktu z listy to no-op, drag po wyborze zmienia `x`/`y` wyłącznie wybranego punktu, drag uchwytu skaluje `size` proporcjonalnie do zmiany odległości od środka, edycja pola `x`/`y`/`size` w panelu zapisuje się natychmiast po `change`, edycja `t` przesuwa punkt gdy zachowuje rosnącą kolejność, edycja `t` naruszająca kolejność jest odrzucana i pole wraca do poprzedniej wartości, `+` między punktami wypełnia wiersz roboczy bieżącym czasem wideo i zinterpolowaną pozycją zaznaczonego obiektu i od razu dopisuje nowy punkt (posortowany po `t`), nowy punkt z `t` kolidującym z istniejącym (bieżący czas równy punktowi) jest odrzucany bez zmiany beatmapy, a pola wiersza roboczego zostają wypełnione bieżącymi wartościami do poprawki, `−` usuwa punkt natychmiast przy więcej niż 2 punktach, a na ścieżce z dokładnie 2 punktami usuwa cały obiekt zamiast być zablokowany, guzik `.dev-edit-panel-delete-point` ("Usuń punkt") pod nagłówkiem panelu jest ukryty bez wybranego punktu, widoczny i klikalny po wybraniu (usuwa punkt, a na ścieżce z 2 punktami cały obiekt — nigdy nie jest `disabled`), brak jakiejkolwiek interakcji gdy silnik nie jest zamrożony (odtwarzanie), każdy zapisany payload przechodzi `validateBeatmap`, klik na pustym miejscu chowa panel i usuwa pierścień, koalescencja zapisu — kilka `pointermove` przed jednym `onFrame()` dają co najwyżej jeden `fetch`, a nierozwiązany `fetch` blokuje kolejny do jego zakończenia. |
| `tests/beatmap-store.test.ts` | `node`: `createBeatmapStore` — `get()` zwraca ostatnio ustawioną przez `set()` wartość, `set()` nadpisuje w całości, dwie niezależne instancje nie dzielą stanu. |
| `tests/dev-mode-exclusivity.test.ts` | jsdom, ADR-0018: wzajemna wyłączność trybów przez `BeatmapStore` współdzielony między `mountDevRecorder` i `mountDevHandEditor` — aktywacja rekordera odznacza i blokuje checkbox edytora (i odwrotnie), aktywacja rekordera w trakcie zaznaczenia w edytorze czyści pierścień i chowa panel edytora, aktywacja edytora w trakcie trwającego nagrania czyści podgląd ręki rekordera, zmiany zrobione w trybie edycji są widoczne przez `store.get()` po przełączeniu na nagrywanie (współdzielona beatmapa w pamięci, nie prywatna kopia per moduł). |

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
- **`--player-overscan` potwierdzone na urządzeniu** — obraz nie jest
  przybliżony, a cele nadal pokrywają się z wideo, czyli YouTube faktycznie
  wpisuje wideo w player z letterboxem, a nie kadruje go. Gdyby kiedyś
  przestało — `--player-overscan: 0%` cofa to jedną linią.
- **Duży przycisk play/pauza YouTube'a zostaje widoczny na środku kadru** —
  świadomie przyjęte, bo każdy sposób jego ukrycia ukrywa tam także wideo.
  W zamian jest klikalny (`.yt-button-proxy`). **Skutek uboczny:** pudło
  dokładnie w środku kadru wstrzyma wideo zamiast policzyć się jako chybienie.
- **Geometria i animacje z ADR-0019 nie są pokryte testami** — `jsdom` nie liczy
  layoutu, nie animuje i nie renderuje prawdziwego iframe'a; pokryte są
  wyłącznie obecność i kolejność `.shield` oraz `.yt-button-proxy` w DOM
  i spięcie przycisku z transportem. Wymaga ręcznej
  weryfikacji: (1) klik/tap gdziekolwiek na scenie nie wywołuje kontrolek
  YouTube ani nie pauzuje wideo; (2) **nie widać paska tytułu, „More videos" ani logo** (duży
  przycisk na środku zostaje — to świadoma decyzja); (2b) klik w ten przycisk
  wstrzymuje i wznawia wideo; (3) scena + pasek transportu mieszczą się w viewport
  na maksymalizowanym `.frame`.
- **Widoczność ikon transportu na iOS wymaga weryfikacji na urządzeniu.** Glify
  Unicode (`❚❚`, `🕪`) rysowały się tam jako puste kwadraty; zastąpiono je inline
  SVG, co problem z fontem eliminuje z definicji, ale jsdom nie renderuje, więc
  testy pokrywają wyłącznie obecność `svg.icon` w DOM, nie realny wygląd.
- **Obrót o 90° w portrecie na dotyku (ADR-0021) niezweryfikowany na realnym
  urządzeniu** — `@media (orientation: portrait) and (pointer: coarse)` w
  `src/styles.css` nie jest pokryty testami (`jsdom` nie liczy layoutu ani
  media queries); wymaga ręcznego sprawdzenia na telefonie: telefon trzymany
  pionowo pokazuje układ poziomy wypełniający ekran, bez paska adresu wracającego
  przy przewijaniu (`overflow: hidden` na `html, body`).
- **Zachowanie playera na pauzie/końcu przy `controls: 0` (ADR-0019) jest
  niezweryfikowane z prawdziwym YouTube** — nie wiadomo z pewnością, czy wtedy
  nie pojawia się własna nakładka YouTube („Watch on YouTube”, propozycje
  filmów). `rel: 0` już jest ustawione; gdyby nakładka się pojawiała, mitygacją
  jest niepauzowanie playera na końcu klipu i własny ekran wyniku nad kadrem
  (już istnieje).

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
| zmienić pasek transportu / kontrolki wideo | `src/ui/render.ts` + `src/ui/youtube.ts` |
| zmienić integrację z playerem | `src/ui/youtube.ts` |
| zmienić regułę odróżniania reklamy od treści | `src/ui/youtube.ts` (`contentClock` w `sample()`, ADR-0024) |
| zmienić zachowanie zmaksymalizowanej ramki / obrót w portrecie | `src/styles.css` (`.frame`, ADR-0021) |
| zmienić szerokość pionowego paska transportu | `src/styles.css` (`--hud-width` na `.frame`, ADR-0023) |
| zmienić nazwę/ikonę/orientację aplikacji na ekranie początkowym | `public/manifest.webmanifest` + `index.html` (metatagi `apple-*`) + `scripts/make-icons.mjs` |
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
| [0018](docs/decisions/ADR-0018-tryb-deweloperski-edycji-punktow-sciezki.md) | Tryb deweloperski edycji punktów ścieżki, `BeatmapStore` i koalescencja zapisu |
| [0019](docs/decisions/ADR-0019-wlasne-kontrolki-zamiast-kontrolek-youtube.md) | Własne kontrolki zamiast kontrolek YouTube (unieważnia mitygację z ADR-0008) |
| [0020](docs/decisions/ADR-0020-ikonowy-transport-i-automatyczny-pelny-ekran.md) | Ikonowy pasek transportu i automatyczny pełny ekran zamiast osobnego przycisku |
| [0021](docs/decisions/ADR-0021-zawsze-zmaksymalizowana-ramka-bez-fullscreen-api.md) | Ramka zawsze zmaksymalizowana na viewport bez Fullscreen API, wymuszony obrót w portrecie na dotyku (unieważnia ADR-0010) |
| [0022](docs/decisions/ADR-0022-wykrywanie-reklam-po-dlugosci-wideo.md) | ⛔ Wykrywanie reklam po długości wideo — zastąpione przez ADR-0024 (założenie obalone pomiarem) |
| [0023](docs/decisions/ADR-0023-pionowy-pasek-transportu.md) | Pionowy pasek transportu po prawej stronie sceny (pionowy suwak, ukryty licznik czasu) |
| [0024](docs/decisions/ADR-0024-zegar-tresci-kontra-zegar-reklamy.md) | Zegar treści kontra zegar reklamy — adapter nie wpuszcza czasu reklamy do silnika (zastępuje ADR-0022) |
