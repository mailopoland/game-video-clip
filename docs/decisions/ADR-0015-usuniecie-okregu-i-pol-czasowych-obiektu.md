# ADR-0015 — Usuniecie approach circle i pol czasowych obiektu na rzecz path

**Status:** przyjete
**Data:** 2026-08-09

## Kontekst

Po wprowadzeniu sciezki ruchu (ADR-0014) obiekt beatmapy nadal mial trzy pola
sterujace czasem, niezalezne od `path`: `time` (moment idealnego trafienia),
`duration` (ms fazy approach) i `hitWindowMs` (tolerancja ±). To dawalo dwa
rownolegle zrodla prawdy o "kiedy" — `path` mowil o pozycji w czasie, a
`time`/`duration`/`hitWindowMs` sterowaly spawnem, oknem trafienia i wizualnym
kurczacym sie okregiem (approach circle).

Uzytkownik zdecydowal o uproszczeniu: `path` ma byc jedynym zrodlem prawdy
o tym, kiedy obiekt istnieje. Znika tez approach circle (razem z sygnalem
`is-armed`) i tolerancja trafienia — reka jest klikalna przez caly czas,
w ktorym jest widoczna.

## Decyzja

- **Spawn / despawn obiektu** = `path[0].t` / `path[ostatni].t` — bez osobnych
  pol. `time`, `duration`, `hitWindowMs` usuniete z `BeatmapObject`.
- **Minimalna dlugosc `path` to 2 punkty** (start i koniec) — zastepuje
  pojedynczy punkt statyczny dopuszczalny w ADR-0014. Obiekt bez ruchu to
  `path` z dwoma punktami w tym samym miejscu i roznym `t`.
- **Ocena trafienia:** klik w dowolnym momencie `[path[0].t, path[ostatni].t]`
  = trafienie. Brak kliku po `path[ostatni].t` = pudlo. Nie ma juz pojecia
  "poza oknem" — cala aktywnosc obiektu jest jednoczesnie oknem klikalnosci.
- **Approach circle usuniety calkowicie** — brak elementu `.approach`, brak
  skalowania, brak klasy `is-armed`. Zostaje sam sprite jako cel, bez zadnego
  dodatkowego sygnalu wizualnego "mozna trafic" przed klikniuciem.
- **Sortowanie obiektow w beatmapie** po `path[0].t` (zastepuje dawne
  sortowanie po `time`).

### Silnik — uproszczenia

`hit(objectId)`: nie ma juz rozgalezienia hit/miss na klikniecie — klik
w istniejacy, nierozstrzygniety obiekt to zawsze trafienie:

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

Jesli okno juz minelo, `sweepMisses()` zdazyla ustawic `'miss'` wczesniej
(co tick), wiec `results.has(objectId)` jest juz `true` i klik jest
ignorowany — tak jak wczesniej.

`sweepMisses()`: prog to `object.path[ostatni].t` zamiast
`object.time + object.hitWindowMs / 1000`.

`resync(targetSec)`: jeden spojny warunek zamiast dwoch osobnych (dawny
`object.time` dla kasowania wyniku, `object.time + hitWindowMs/1000` dla
`skipped`):

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

`visibleObjects()`: gałąź nierozstrzygnięta traci pole `approach` — widocznosc
to `timeSec >= path[0].t` (i brak wyniku), bez sprawdzania gornej granicy (to
robi `sweepMisses`, ktory rozstrzyga obiekt, zanim `visibleObjects` go zobaczy
jako "aktywny bez wyniku" po despawnie).

## Konsekwencje

- `src/engine/types.ts`: `BeatmapObject` traci `time`/`duration`/`hitWindowMs`,
  zostaje `{ id, sprite, path }`. `VisibleObject` traci `approach`.
- `src/engine/beatmap.ts`: usunieta walidacja `duration`/`hitWindowMs`; dodana
  `path.length < 2` (`"path musi miec co najmniej dwa punkty (start i koniec)"`);
  sortowanie po `path[0].t`.
- `src/data/beatmap.json`: 27 z 28 obiektow zmigrowane mechanicznie —
  `path: [{t: time - duration/1000, x, y, size}, {t: time + hitWindowMs/1000, x, y, size}]`
  (dwa punkty w tym samym miejscu, zachowujace dotychczasowy laczny czas
  ekspozycji). Jeden obiekt (`o0`) mial juz recznie autorowana wielopunktowa
  sciezke z ruchem — zachowany bez zmian, usunieto z niego tylko `hitWindowMs`.
- `tests/fake-clock.ts`: fabryka `obj(id, time, overrides)` domyslnie tworzy
  `path: [{t: time, ...}, {t: time + 1, ...}]` (spawn = `time`, despawn =
  `time + 1s`) — zachowuje sygnature dla istniejacych wywolan testowych.
- `src/ui/render.ts`: `createObjectElement()` nie tworzy juz elementu
  `.approach`; `render()` nie liczy/ustawia jego transform/opacity i nie
  przelacza klasy `is-armed`.
- `src/styles.css`: usunieta regula `.approach`, `.obj.is-armed .approach`
  i `.obj.is-hit/.is-miss .approach`.
- Duze przerobki `tests/engine.test.ts`, `tests/beatmap.test.ts`,
  `tests/smoke.test.ts`, `tests/sound.test.ts` — usuniete testy o oknie
  tolerancji/kliku-przed-oknem/approach circle, dodane testy "klik w dowolnym
  momencie aktywnosci = trafienie" (poczatek, srodek, tuz przed despawnem).

## Odrzucone warianty

- **Zachowanie `hitWindowMs` obok `path`** — odrzucone, bo dublowaloby
  semantyke konca sciezki (`path[ostatni].t`). Dwa rownolegle zrodla prawdy
  o "kiedy" byly wlasnie problemem, ktory ten ADR rozwiazuje.
- **Jakis zamiennik sygnalu wizualnego "mozna trafic"** (np. inna animacja
  sprite'a) — swiadomie pominiete (YAGNI); uzytkownik poprosil o usuniecie
  okregu bez zamiennika.
