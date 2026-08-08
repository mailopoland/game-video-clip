# Ścieżka ruchu w beatmapie + niezmiennicza geometria — plan implementacyjny

**Data:** 2026-08-08
**Status:** zatwierdzony do implementacji

---

## Kontekst i cel

Dwa powiązane problemy zgłoszone przez użytkownika:

1. **Cele są statyczne.** Sprite dłoni ma podążać za obiektem poruszającym się
   w klipie. Potrzebna jest ścieżka: lista punktów `(x, y, size, t)` z płynną
   interpolacją między nimi.
2. **Pozycja celu nie jest stała względem obrazu.** Ten sam `y` ląduje w innym
   miejscu kadru w zależności od rozmiaru sceny (telefon vs pełny ekran).

**Przyczyna problemu 2 została zdiagnozowana:** `src/styles.css:79` —
`.overlay { inset: 0 0 3.5rem 0 }`. Wartość `3.5rem` jest absolutna (56 px), a `y%`
liczy się względem wysokości warstwy gry. Przy scenie 1920×1080 pas to 5% wysokości,
przy scenie 375×211 — **27%**. Reszta geometrii (`x%`, `y%`, `width: 16%`,
`aspect-ratio: 1`, sztywne `aspect-ratio: 16/9` sceny) jest już niezmiennicza.

Pas istnieje po to, by pasek kontrolek YouTube pozostał klikalny (ADR-0008), więc
naprawą nie jest usunięcie go, tylko wyrażenie w procentach.

## Decyzje (zatwierdzone w brainstormingu)

| Decyzja | Wybór | Uzasadnienie |
|---|---|---|
| Skala czasu punktów | **Absolutne sekundy wideo** | Ta sama skala co `time` i `endScreenAtSec` — strojenie wprost z timeline'u klipu. |
| `path` vs `x`/`y`/`size` | **`path` zastępuje je całkowicie** | Jeden sposób opisu pozycji; zero niejednoznaczności „co wygrywa”. Obiekt statyczny = `path` z jednym punktem. |
| Pas kontrolek | **`inset: 0 0 8% 0`** | Mapowanie `y%` stałe przy każdym rozmiarze, kontrolki YouTube nadal chronione. Koszt: dolne 8% kadru niedostępne dla celów. |
| Poza zakresem ścieżki | **Przytrzymanie skrajnej wartości** | Ścieżka opisuje tylko to, co się rusza; obiekt nie skacze ani nie znika przy żadnej długości ścieżki. |
| Interpolacja | **Liniowa** | Przy śledzeniu wideo daje gwarancję zbieżności: obiekt nigdy nie wyjdzie poza odcinek między sąsiednimi punktami, więc każdy dodany punkt zawsze zmniejsza rozjazd. Zmienną prędkość oddaje rozstaw punktów. `easeInOut` odpada (wymusza prędkość 0 w każdym punkcie — obiekt na wideo tam nie staje). Catmull-Rom odrzucony przez overshoot na ostrych zakrętach. |
| Kosmetyka | **Jednostki `cqw` włączone** | Grubość okręgu, cień i font feedbacku też stają się niezmiennicze. |

**Nieuwzględnione świadomie (YAGNI):** per-punktowe krzywe/easing, obrót sprite'a,
walidacja pokrycia ścieżką całego okna widoczności. Format danych nie zamyka drogi
do dołożenia Catmull-Rom później — to podmiana jednej funkcji, bez ruszania beatmapy.

---

## Architektura zmiany

```
beatmap.json (path: PathPoint[])
      │
      ▼
validateBeatmap  ── nowe reguły na poziomie punktu
      │
      ▼
Engine.getView() ──► samplePath(path, timeSec) ──► VisibleObject { x, y, size }
      │                  (src/engine/path.ts, czysta funkcja)
      ▼
render.ts ── wpisuje gotowe liczby w style.left/top/width co klatkę
```

**Kluczowa zasada:** interpolacja idzie do **silnika**, nie do renderera. Ruch staje
się — dokładnie jak `approach` — czystą funkcją czasu wideo. Dzięki temu:

- zamarza na pauzie i resynchronizuje się po przewinięciu **bez ani jednej linii kodu
  w tej sprawie** (silnik już zamraża `timeSec`);
- da się go przetestować fake clockiem, bez jsdom;
- `render.ts` zostaje głupi — bierze liczby i wpisuje w styl.

Silnik nadal nie wie nic o DOM: `x`/`y`/`size` to procenty warstwy gry, czyli ta sama
umowa co dziś w beatmapie.

**Punktacja, maszyna stanów, `resync` i `sweepMisses` nie zmieniają się w ogóle** —
ruch jest czysto prezentacyjny.

---

## Kroki implementacji

Kolejność jest istotna: typy → czysta funkcja + testy → walidacja → migracja danych →
silnik → renderer → CSS → dokumentacja. Po każdym kroku `npm test` musi być zielone
(kroki 3–4 przejściowo czerwone — to jedyne dopuszczalne okno).

### Krok 1 — typy (`src/engine/types.ts`)

Dodaj `PathPoint`, usuń `x`/`y`/`size` z `BeatmapObject`, dodaj `path`:

```ts
export interface PathPoint {
  /** Sekunda wideo — ta sama skala co BeatmapObject.time. */
  t: number;
  /** Procent szerokosci warstwy gry (srodek obiektu). */
  x: number;
  /** Procent wysokosci warstwy gry (srodek obiektu). */
  y: number;
  /** Procent bazowego rozmiaru obiektu (100 = domyslny rozmiar z CSS). */
  size: number;
}

export interface BeatmapObject {
  id: string;
  time: number;
  duration: number;
  sprite: string;
  hitWindowMs: number;
  /** Sciezka ruchu — min. 1 punkt, scisle rosnaco po `t`.
      Poza zakresem: przytrzymanie skrajnego punktu. */
  path: PathPoint[];
}
```

Rozszerz `VisibleObject` o wyliczone pola:

```ts
export interface VisibleObject {
  object: BeatmapObject;
  approach: number;
  outcome?: Outcome;
  /** Zinterpolowana pozycja i rozmiar dla `GameView.timeSec`. */
  x: number;
  y: number;
  size: number;
}
```

### Krok 2 — `src/engine/path.ts` (nowy) + `tests/path.test.ts` (nowy)

Napisz testy **przed** implementacją.

```ts
import type { PathPoint } from './types.js';

/**
 * Pozycja i rozmiar obiektu w danej sekundzie wideo (ADR-0014).
 * Interpolacja liniowa miedzy sasiednimi punktami; poza zakresem sciezki
 * przytrzymanie skrajnego punktu. Sciezki sa krotkie, wiec skan liniowy.
 */
export function samplePath(
  path: PathPoint[],
  timeSec: number,
): { x: number; y: number; size: number };
```

Zachowanie:
- pusta ścieżka nie może się zdarzyć (walidator ją odrzuca) — nie dodawaj obsługi;
- jeden punkt → zawsze jego wartości;
- `timeSec <= path[0].t` → `path[0]`;
- `timeSec >= path[n-1].t` → `path[n-1]`;
- wewnątrz segmentu `[a, b]`: `u = (timeSec - a.t) / (b.t - a.t)`, lerp `x`, `y`, `size`.

Testy w `tests/path.test.ts` (środowisko `node`, bez jsdom):

1. jeden punkt → te same wartości przed, w i po `t`;
2. przed pierwszym punktem → wartości pierwszego (przytrzymanie);
3. za ostatnim punktem → wartości ostatniego (przytrzymanie);
4. dokładnie w punkcie → wartości tego punktu (dotyczy też punktu środkowego);
5. połowa segmentu → `x`, `y` **i** `size` zlerpowane naraz;
6. trzy punkty → wybór właściwego segmentu (czas w drugim segmencie nie bierze
   wartości z pierwszego);
7. segmenty o **różnej długości czasowej** → interpolacja liczona względem długości
   własnego segmentu, nie średniej (to jest test na „zmienna prędkość”).

### Krok 3 — walidacja (`src/engine/beatmap.ts`)

Usuń trzy reguły dotyczące `o.x`, `o.y`, `o.size` (linie 22–23 i 26 obecnej wersji).
Dodaj blok walidujący ścieżkę, w tej samej konwencji komunikatów (`Obiekt "id": …`):

- `path` jest tablicą i ma ≥ 1 element →
  `Obiekt "o3": path musi miec co najmniej jeden punkt.`
- dla każdego punktu (z indeksem w komunikacie, np. `path[2]`):
  - `Number.isFinite(t)` → `…: t musi byc skonczona liczba.`
  - `x` w 0–100 → `…: x poza zakresem 0–100.`
  - `y` w 0–100 → `…: y poza zakresem 0–100.`
  - `size > 0` → `…: size musi byc dodatnie.`
- punkty **ściśle rosnąco** po `t` → `Obiekt "o3": punkty path musza byc scisle
  rosnace po t.` (równe `t` dałoby dzielenie przez zero w interpolacji)

Bez zmian: unikalne `id`, sortowanie obiektów po `time`, `duration > 0`,
`hitWindowMs > 0`, `hitWindowMs <= duration`, znany `sprite`.

**Nie** waliduj pokrycia ścieżką okna `[time − duration, time]` — to jest wprost
konsekwencja wybranego przytrzymania skrajnych wartości.

### Krok 4 — migracja danych i fabryk testowych

**`src/data/beatmap.json`** — **28 obiektów** (`o0`–`o27`). Każdy przekształć
mechanicznie, bez zmiany zachowania:

```json
// przed
{ "id": "o1", "time": 6.5, "duration": 500, "x": 57, "y": 40,
  "sprite": "hand", "hitWindowMs": 500, "size": 50 }

// po
{ "id": "o1", "time": 6.5, "duration": 500,
  "sprite": "hand", "hitWindowMs": 500,
  "path": [ { "t": 6.5, "x": 57, "y": 40, "size": 50 } ] }
```

Zasada: `t` punktu = `time` obiektu, wartości `x`/`y`/`size` bez zmian. Dzięki
przytrzymaniu skrajnej wartości pozycja jest identyczna jak przed migracją.

**`tests/fake-clock.ts`** — fabryka `obj()` przechodzi na `path`:

```ts
export function obj(
  id: string,
  time: number,
  overrides: Partial<Beatmap['objects'][number]> = {},
): Beatmap['objects'][number] {
  return {
    id,
    time,
    duration: 1000,
    sprite: 'hand',
    hitWindowMs: 200,
    path: [{ t: time, x: 50, y: 50, size: 100 }],
    ...overrides,
  };
}
```

Uwaga: domyślne `t` zależy od `time`, więc `obj('a', 5)` daje punkt w `t: 5`.
Testy podające własną ścieżkę nadpisują całe `path` przez `overrides`.

Po tym kroku istniejące testy muszą znów być zielone.

### Krok 5 — silnik (`src/engine/engine.ts`)

W `visibleObjects()` obie gałęzie (rozstrzygnięta i nierozstrzygnięta) dostają
zinterpolowane wartości:

```ts
const { x, y, size } = samplePath(object.path, this.timeSec);
// gałąź rozstrzygnięta:
visible.push({ object, approach: 0, outcome: result.outcome, x, y, size });
// gałąź aktywna:
visible.push({ object, approach: clamp(remainingSec / durationSec, 0, 1), x, y, size });
```

Nic więcej w silniku się nie zmienia. `hit()`, `resync()`, `sweepMisses()`,
`getStats()` zostają nietknięte.

### Krok 6 — renderer (`src/ui/render.ts`)

Z `createObjectElement()` **usuń** trzy linie (obecnie 79–82):

```ts
element.style.left = `${object.x}%`;
element.style.top = `${object.y}%`;
element.style.width = `${(16 * object.size) / 100}%`;
```

W `render()`, w pętli po `view.visible`, **dodaj** ich odpowiedniki na wartościach
z `visible`, obok istniejącego ustawiania `approach`:

```ts
// Pozycja i rozmiar sa funkcja czasu wideo (ADR-0014) — zapisujemy je
// bezwarunkowo co klatke, tak samo jak skale approach circle.
element.style.left = `${visible.x}%`;
element.style.top = `${visible.y}%`;
element.style.width = `${(16 * visible.size) / 100}%`;
```

Zapis bezwarunkowy: przy kilku widocznych obiektach koszt układu jest pomijalny,
a warunkowanie wprowadziłoby stan do renderera bez powodu.

Approach circle **nie wymaga żadnej zmiany** — ma `width/height: 100%` względem
`.obj`, więc skaluje się razem ze zmianą `width`, a centrowanie `translate: 9.8% -0.9%`
jest procentowe i przeżywa skalowanie.

### Krok 7 — CSS (`src/styles.css`)

**Naprawa niezmienniczości pozycji** (linia 79):

```css
/* Warstwa gry konczy sie nad paskiem kontrolek YouTube, ktory zostaje klikalny
   (mitygacja z ADR-0008). Pas jest w PROCENTACH, nie w rem: wartosc absolutna
   stanowila 5% wysokosci sceny w pelnym ekranie i 27% na telefonie, przez co
   ten sam `y` z beatmapy ladowal w innym miejscu kadru (ADR-0014). */
.overlay { inset: 0 0 8% 0; }
```

**Nie ruszaj** `3.5rem` w `--stage-width` w `.frame` (linia 26) — to wysokość HUD-u
pod sceną, bez związku z warstwą gry.

**Kosmetyka — jednostki kontenerowe** (`1cqw` = 1% szerokości sceny):

```css
.stage    { container-type: inline-size; }          /* dodaj do istniejacej reguly */
.approach { border-width: 0.35cqw; }                /* zamiast border: 0.25rem */
.sprite   { filter: drop-shadow(0 0 0.55cqw rgb(0 0 0 / 0.8)); }
.feedback { font-size: 3.2cqw; }                    /* zamiast clamp(1rem, 4vw, 2rem) */
```

`.approach` zachowuje `border-style: solid` i `border-color: #fff` — zmienia się tylko
szerokość. Reguła `.obj.is-armed .approach { border-color: #6ef58f }` działa dalej.

### Krok 8 — dokumentacja (ten sam commit)

- **`README.md`**: tabela pól beatmapy (usuń `x`/`y`/`size`, dodaj `path` + tabelę
  `PathPoint`), przykład JSON, reguły `validateBeatmap`, sekcja „Warstwa gry i DOM”
  (akapit o 3,5 rem → 8% + akapit o jednostkach `cqw`), sekcja „Testy” (nowa pozycja
  `tests/path.test.ts`, zaktualizowana liczba testów), tabela „Gdzie co zmieniać”
  (dodaj `src/engine/path.ts`), tabela decyzji (ADR-0014).
- **`CLAUDE.md`**: status projektu, struktura projektu (`engine/path.ts`,
  `tests/path.test.ts`), liczba testów, lista ADR.
- **`docs/decisions/ADR-0014-sciezka-ruchu-i-niezmiennicza-geometria.md`** (nowy):
  ścieżka ruchu jako dane w beatmapie, absolutne sekundy, interpolacja liniowa
  z uzasadnieniem odrzucenia `easeInOut` i Catmull-Rom, przytrzymanie poza zakresem,
  interpolacja w silniku a nie w rendererze, `inset` procentowy zamiast `rem`
  jako naprawa niezmienniczości, jednostki `cqw`.

---

## Testy

Docelowo ok. **85 testów** (dziś 69). `npm test` musi być zielone w 100%.

| Plik | Co dochodzi |
|---|---|
| `tests/path.test.ts` **(nowy)** | 7 testów `samplePath` — szczegóły w kroku 2. |
| `tests/beatmap.test.ts` | Nowe reguły: brak `path`, pusta `path`, `t` nierosnące, `t` zduplikowane, `t = NaN`, `x`/`y` poza 0–100 w punkcie, `size ≤ 0` w punkcie. Plus: produkcyjna beatmapa waliduje się po migracji i każdy obiekt ma niepustą `path`. |
| `tests/engine.test.ts` | `getView()` zwraca zinterpolowane `x`/`y`/`size` w połowie segmentu; **pauza — `advanceWallOnly(10)` nie rusza pozycji**; **seek w tył — pozycja odpowiada nowemu czasowi, bez dryfu**. Te dwa są sednem tezy, że ruch jest funkcją czasu wideo, a nie animacją. |
| `tests/smoke.test.ts` | jsdom: `left`/`top`/`width` elementu zmieniają się między klatkami wraz z upływem czasu; ścieżka jednopunktowa trzyma pozycję mimo upływu czasu; `size` z punktu skaluje `width` względem bazowych 16% (adaptacja istniejącego testu). |
| `tests/fullscreen.test.ts`, `tests/sound.test.ts` | Bez zmian merytorycznych; mogą wymagać poprawki, jeśli budują obiekty beatmapy lokalnie zamiast przez `obj()`. |

**Czego testy nie pokryją** (do listy „znane ograniczenia” w README):
jednostki `cqw` i `container-type` — jsdom nie liczy układu, więc niezmienniczość
wizualna wymaga jednego ręcznego sprawdzenia w `npm run dev`: ten sam cel na
telefonie i w pełnym ekranie musi lądować w tym samym miejscu kadru.

---

## Ryzyka i ograniczenia

- **Klip nie-16:9.** Jeśli realny klip ma inne proporcje niż 16:9, YouTube doda czarne
  pasy wewnątrz iframe'a i „ten sam punkt sceny” przestanie znaczyć „ten sam punkt
  obrazu”. API nie udostępnia proporcji wideo, więc nie da się tego skompensować
  programowo. Przy klipie 16:9 problem nie istnieje. Do odnotowania w README.
- **Dolne 8% kadru niedostępne dla celów** — świadomy koszt ochrony kontrolek YouTube.
  Jeśli w praktyce okaże się za duży, zmiana to jedna liczba w `.overlay`.
- **Strojenie ścieżek pod realny klip** to osobne zadanie — ten plan dostarcza
  mechanizm, nie dane. Obecne czasy beatmapy pozostają wartościami roboczymi.
- **`container-type: inline-size`** wymaga przeglądarki z 2023+. Zgodne z resztą
  projektu (`aspect-ratio`, `100dvh`, `:fullscreen`), ale warto mieć świadomość.

---

## Definicja ukończenia

1. `npm test` — 100% zielone, ok. 85 testów.
2. `npm run build` — przechodzi (`tsc --noEmit` wyłapie każde pominięte użycie
   usuniętych pól `x`/`y`/`size`).
3. `README.md`, `CLAUDE.md` i ADR-0014 zaktualizowane w tym samym commicie.
4. Ręczna weryfikacja w `npm run dev`: cel w tym samym miejscu kadru na wąskim
   oknie i w pełnym ekranie; obiekt z wielopunktową ścieżką porusza się płynnie,
   zatrzymuje się przy pauzie wideo i wraca na właściwe miejsce po przewinięciu.
