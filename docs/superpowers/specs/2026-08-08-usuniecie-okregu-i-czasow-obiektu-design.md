# Usunięcie `time`/`duration`/`hitWindowMs`, okręgu i strojenia klikalności — spec

**Data:** 2026-08-08
**Status:** zatwierdzony do implementacji

---

## Kontekst i cel

Po wprowadzeniu ścieżki ruchu (ADR-0014) obiekt beatmapy nadal miał trzy pola
sterujące czasem niezależne od `path`: `time` (moment idealnego trafienia),
`duration` (ms fazy approach) i `hitWindowMs` (tolerancja ±). To dawało dwa
równoległe źródła prawdy o "kiedy" — `path` mówił o pozycji w czasie, a `time`/
`duration`/`hitWindowMs` sterowały spawnem, oknem trafienia i wizualnym
kurczącym się okręgiem (approach circle).

Użytkownik zdecydował o uproszczeniu: **`path` ma być jedynym źródłem prawdy
o tym, kiedy obiekt istnieje.** Pierwszy i ostatni punkt ścieżki wyznaczają
początek i koniec życia obiektu — nic więcej. Znika też approach circle
(razem z sygnałem `is-armed`) i tolerancja trafienia: ręka jest klikalna przez
cały czas, w którym jest widoczna.

## Decyzje

| Decyzja | Wybór |
|---|---|
| Spawn / despawn obiektu | `path[0].t` / `path[ostatni].t` — bez osobnych pól |
| Minimalna długość `path` | **2 punkty** (start i koniec) — zastępuje pojedynczy punkt statyczny dopuszczalny w ADR-0014 |
| Ocena trafienia | Klik w dowolnym momencie `[path[0].t, path[last].t]` = trafienie. Brak kliku po `path[last].t` = pudło. Nie ma już „poza oknem" |
| Approach circle | Usunięty całkowicie — brak elementu `.approach`, brak skalowania, brak klasy `is-armed` |
| Sygnał wizualny klikalności | Żaden — sam sprite dłoni jest celem, bez podpowiedzi przed kliknięciem |
| Feedback po rozstrzygnięciu | Bez zmian: `+1`/`✕`, `FADE_OUT_MS = 500` |
| Sortowanie obiektów w beatmapie | Po `path[0].t` (zastępuje dawne sortowanie po `time`) |
| Migracja `beatmap.json` | Każdy obiekt: `path: [{t: time - duration/1000, x, y, size}, {t: time + hitWindowMs/1000, x, y, size}]` — dwa punkty w tym samym miejscu (statyczny cel), zachowujące dotychczasowy łączny czas ekspozycji |
| Migracja `tests/fake-clock.ts` `obj()` | Domyślnie `path: [{t: time, ...}, {t: time + 1, ...}]` (spawn = `time`, despawn = `time + 1s`) — zachowuje sygnaturę `obj(id, time, overrides)` |

**Nieuwzględnione świadomie (YAGNI):** żaden zamiennik sygnału "można trafić",
żadna nowa animacja spawnu, żadna zmiana mechaniki `resync`/`sweepMisses` poza
podmianą pól źródłowych.

## Architektura zmiany

```
BeatmapObject { id, sprite, path: PathPoint[] (>=2) }
      │
      ▼
validateBeatmap  ── path.length >= 2, sortowanie po path[0].t
      │
      ▼
Engine:
  hit()        — klik po path[0].t i bez wyniku = zawsze 'hit'
  sweepMisses()— timeSec > path[last].t i bez wyniku = 'miss'
  resync()     — pivot: path[last].t (zamiast dawnego 'time')
  visibleObjects() — bez pola 'approach', bez logiki okna tolerancji
      │
      ▼
render.ts — bez elementu .approach, bez klasy is-armed
```

### Silnik — szczegóły

**`hit(objectId)`:**
```ts
hit(objectId: string): boolean {
  if (this.frozen) return false;
  const object = this.byId.get(objectId);
  if (!object || this.results.has(objectId)) return false;

  const spawnSec = object.path[0].t;
  if (this.timeSec < spawnSec) return false; // obiekt jeszcze nie istnieje

  this.results.set(objectId, { outcome: 'hit', atSec: this.timeSec });
  return true;
}
```
Nie ma już rozgałęzienia `hit`/`miss` na kliknięcie — klik w istniejący,
nierozstrzygnięty obiekt to zawsze trafienie. Jeśli okno już minęło,
`sweepMisses()` zdążyło ustawić `'miss'` wcześniej (co tick), więc
`results.has(objectId)` jest już `true` i klik jest ignorowany — tak jak dziś.

**`sweepMisses()`:** zamiast `object.time + object.hitWindowMs / 1000`,
próg to `object.path[object.path.length - 1].t`.

**`resync(targetSec)`:** jeden spójny warunek zamiast dwóch osobnych
(`object.time` dla kasowania, `object.time + hitWindowMs/1000` dla `skipped`):
```ts
private resync(targetSec: number): void {
  for (const object of this.beatmap.objects) {
    const despawnSec = object.path[object.path.length - 1].t;
    if (despawnSec >= targetSec) {
      this.results.delete(object.id);
    } else if (!this.results.has(object.id)) {
      this.results.set(object.id, { outcome: 'skipped', atSec: targetSec });
    }
  }
  this.timeSec = targetSec;
}
```

**`visibleObjects()`:** gałąź nierozstrzygnięta traci `approach` — widoczność to
`timeSec >= path[0].t` (i brak wyniku), bez sprawdzania górnej granicy (to
robi `sweepMisses`, który rozstrzyga obiekt, zanim `visibleObjects` go
zobaczy jako "aktywny bez wyniku" po `path[last].t`).

### Typy

`BeatmapObject`: usuń `time`, `duration`, `hitWindowMs`. Zostaje
`{ id, sprite, path: PathPoint[] }`.

`VisibleObject`: usuń `approach`. Zostaje
`{ object, outcome?, x, y, size }`.

### Walidacja (`beatmap.ts`)

- usuń sprawdzanie `duration > 0`, `hitWindowMs > 0`, `hitWindowMs <= duration`;
- `path.length >= 2` → `Obiekt "id": path musi miec co najmniej dwa punkty (start i koniec).`
  (podmienia dotychczasowy komunikat o jednym punkcie);
- sortowanie: `beatmap.objects` musi być rosnąco po `o.path[0].t` (zamiast `o.time`).

### Renderer i CSS

`render.ts`:
- `createObjectElement()` przestaje tworzyć `<span class="approach">`;
- `render()` przestaje liczyć/ustawiać `approach.style.transform/opacity`
  i przestaje przełączać klasę `is-armed`.

`styles.css`:
- usuń regułę `.approach`;
- usuń regułę `.obj.is-armed .approach`.

### Migracja danych

`src/data/beatmap.json` — mechaniczne przekształcenie 28 obiektów wg reguły
z tabeli decyzji. Przykład (`o1`, dawne `time: 6.5, duration: 500, hitWindowMs: 500`):

```json
// przed (po ADR-0014)
{ "id": "o1", "time": 6.5, "duration": 500, "sprite": "hand", "hitWindowMs": 500,
  "path": [ { "t": 6.5, "x": 57, "y": 40, "size": 50 } ] }

// po
{ "id": "o1", "sprite": "hand",
  "path": [
    { "t": 6.0, "x": 57, "y": 40, "size": 50 },
    { "t": 7.0, "x": 57, "y": 40, "size": 50 }
  ] }
```
(`t` startu = `6.5 - 0.5 = 6.0`, `t` końca = `6.5 + 0.5 = 7.0`.)

`tests/fake-clock.ts`:
```ts
export function obj(
  id: string,
  time: number,
  overrides: Partial<Beatmap['objects'][number]> = {},
): Beatmap['objects'][number] {
  return {
    id,
    sprite: 'hand',
    path: [
      { t: time, x: 50, y: 50, size: 100 },
      { t: time + 1, x: 50, y: 50, size: 100 },
    ],
    ...overrides,
  };
}
```

## Testy

Duże przeróbki istniejących plików (nie liczba testów sama w sobie, ale ich
treść):

| Plik | Zmiana |
|---|---|
| `tests/beatmap.test.ts` | usuń testy o `duration`/`hitWindowMs`; dodaj test na `path.length < 2` (0 i 1 punkt); zaktualizuj test sortowania na `path[0].t` |
| `tests/engine.test.ts` | usuń testy o oknie tolerancji, kliku przed oknem, kliku na skraju okna; dodaj test „klik w dowolnym momencie między spawn a despawn = trafienie" (początek, środek, tuż przed końcem); zaktualizuj testy pauzy/resync/sweep pod nowe pola; usuń asercje o `approach` |
| `tests/smoke.test.ts` | usuń asercje o `.approach` (transform/opacity) i `is-armed`; zostają testy DOM niezwiązane z okręgiem (tap → `+1`, sprite hit/miss, `left`/`top`/`width` ze ścieżki) |
| `tests/path.test.ts` | bez zmian — `samplePath` nie wie nic o hit-logice |
| `tests/fullscreen.test.ts`, `tests/sound.test.ts` | bez zmian merytorycznych; ewentualna poprawka, jeśli budują obiekty lokalnie zamiast przez `obj()` |

`npm test` musi być zielone w 100% po zakończeniu migracji.

## Dokumentacja

- **README.md**: przepisanie sekcji „Maszyna stanów celu" (bez fazy approach,
  bez okna tolerancji — obiekt aktywny = klikalny, klik = zawsze trafienie),
  tabela beatmapy (usunięcie `time`/`duration`/`hitWindowMs`), sekcja
  „Warstwa gry i DOM" (usunięcie opisu approach circle i `is-armed`), sekcja
  „Testy" (zaktualizowany opis zakresu plików).
- **CLAUDE.md**: status projektu, lista ADR.
- **`docs/decisions/ADR-0015-...md`** (nowy): usunięcie approach circle i pól
  czasowych na rzecz `path` jako jedynego źródła prawdy o obecności obiektu;
  uzasadnienie (dwa równoległe źródła prawdy o czasie to był błąd projektowy
  po ADR-0014); odrzucone warianty (zachowanie `hitWindowMs` obok `path` —
  odrzucone, bo dubluje semantykę końca ścieżki).

## Definicja ukończenia

1. `npm test` — 100% zielone.
2. `npm run build` — przechodzi (`tsc --noEmit` wyłapie każde pominięte użycie
   usuniętych pól `time`/`duration`/`hitWindowMs`/`approach`).
3. `README.md`, `CLAUDE.md` i nowy ADR zaktualizowane w tym samym commicie.
4. Brak elementu `.approach` i klasy `is-armed` w DOM ani w CSS.
