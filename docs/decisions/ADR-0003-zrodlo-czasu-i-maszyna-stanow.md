# ADR-0003: Źródło czasu, pętla gry i maszyna stanów obiektu

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Wymaganie #5: obiekty sterowane **wyłącznie** czasem odtwarzania wideo. Pauza,
bufferowanie i seek muszą zamrażać grę, a przewinięcie musi poprawnie
zresynchronizować stan — bez „duchów" i bez podwójnych punktów.

Ograniczenia YouTube IFrame API (szczegóły w [ADR-0008](ADR-0008-overlay-a-youtube-tos.md)
i w `docs/PLAN.md`, sekcja „Ograniczenia API"):
- `getCurrentTime()` jest synchroniczne i tanie (zwraca wartość zbuforowaną przez
  API po stronie strony-hosta), ale **nie odświeża się co klatkę** — jego
  ziarnistość jest grubsza niż 16 ms.
- Nie ma zdarzenia per-frame ani `timeupdate`. `onStateChange` przychodzi z
  opóźnieniem i **nie ma zdarzenia „seek"**.

## Opcje

1. **Odczyt `getCurrentTime()` na `setInterval`** — proste, ale animacja approach
   circle skacze (250 ms kroku = widoczne zacinanie).
2. **Własny zegar (`performance.now()`) startowany przy PLAY** — płynny, ale
   dryfuje względem wideo (bufferowanie, zmiana `playbackRate`) i łamie wymaganie
   „wyłącznie czas wideo".
3. **`getCurrentTime()` + interpolacja + detekcja rozjazdu** — płynne klatki,
   a wideo pozostaje jedynym autorytetem.

## Decyzja

Opcja 3. Interfejs `TimeSource` z jedną metodą:

```ts
interface TimeSource {
  /** null => gra zamrożona (pauza / buffering / cued / ended) */
  sample(): { timeSec: number; playing: boolean };
}
```

Pętla `requestAnimationFrame`:

1. `sample()`. Jeśli `playing === false` → **freeze**: nie posuwamy czasu gry, nie
   spawnujemy, nie oceniamy, ignorujemy kliknięcia. Renderujemy ostatni stan.
2. Jeśli `playing === true`:
   - `predicted = lastTime + (now - lastWall) / 1000`
   - jeśli `|sampled - predicted| > SEEK_THRESHOLD (0.35 s)` → **seek** →
     `resync(sampled)`;
   - w przeciwnym razie `t = max(sampled, predicted)` (monotoniczna interpolacja
     wygładzająca ziarnistość `getCurrentTime()`; nigdy nie cofa się o szum).
3. Aktualizacja obiektów i renderowanie dla czasu `t`.

**Maszyna stanów obiektu** (wyliczana z beatmapy + mapy wyników, nie mutowana „w miejscu"):

```
pending  --(t >= time - duration)-->  active
active   --(klik w [time-hw, time+hw])-->  hit      --> resolved
active   --(t > time + hw, brak kliku)-->  miss     --> resolved
(seek)   --> patrz resync
```

`duration` = długość fazy approach w ms (obiekt pojawia się o `duration` przed
`time`, okrąg kurczy się do 0 dokładnie w `time`). Po rozstrzygnięciu obiekt
znika po stałej `FADE_OUT_MS = 200`.

**`resync(T)`** — jedyne miejsce obsługujące przewijanie. Wyniki trzymamy w
`Map<objectId, 'hit' | 'miss' | 'skipped'>`:

- usuń z mapy wyniki wszystkich obiektów o `time >= T` → seek **do tyłu** czyści
  historię i pozwala zagrać fragment ponownie (brak podwójnych punktów, bo wynik
  jest nadpisywany, nie sumowany);
- każdemu obiektowi o `time + hitWindowMs < T`, który nie ma jeszcze wyniku,
  przypisz `'skipped'` → seek **do przodu** nie generuje fałszywych pudeł;
- statystyki = agregacja mapy, gdzie `skipped` **nie wchodzi** do mianownika
  celności.

Ponieważ wynik jest funkcją mapy, a nie licznikiem inkrementowanym w pętli,
podwójne punktowanie jest niemożliwe konstrukcyjnie.

## Konsekwencje

- Logika gry (`engine`) nie zna YouTube — dostaje `TimeSource`. Testy wstrzykują
  fake clock (patrz [ADR-0006](ADR-0006-testy-vitest-fake-clock.md)).
- `SEEK_THRESHOLD` 0.35 s to kompromis: mniej niż typowa ziarnistość odczytu +
  zapas na jank, więcej niż realne przewinięcie. Wartość do kalibracji na
  urządzeniu. `[do weryfikacji na realnym mobile]`
- `playbackRate` ≠ 1 nie jest wspierany w v1 (przy zmianie tempa interpolacja
  wykryje rozjazd i zresynchronizuje się — gra pozostanie poprawna, tylko lekko
  „szarpnie”).
- Bufferowanie w trakcie utworu = freeze; po wznowieniu pierwszy `sample()`
  zwykle mieści się w progu, więc nie wywoła zbędnego resynca.
