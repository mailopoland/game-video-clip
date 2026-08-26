# ADR-0024 — Zegar treści kontra zegar reklamy: adapter nie wpuszcza czasu reklamy do silnika

**Status:** przyjęty. **Zastępuje [ADR-0022](ADR-0022-wykrywanie-reklam-po-dlugosci-wideo.md)**,
którego założenie okazało się fałszywe.

## Kontekst — pomiar na urządzeniu

ADR-0022 zakładał, że w trakcie reklamy `getDuration()` zwraca długość kreacji.
Reklamy pojawiają się wyłącznie na deployu (GitHub Pages, iOS Safari), więc założenia
nie dało się sprawdzić lokalnie. Tymczasowa sonda ekranowa (`src/debug-probe.ts`)
zmierzyła to na telefonie w trakcie pre-rolla:

```
start dur=150 oczek=150 vid=5OyTxEbT-fM
0.0s st=5  dur=150 t=0.0 vid=5OyTxEbT-fM => TRESC
8.6s st=3  dur=150 t=0.0 vid=5OyTxEbT-fM => TRESC
9.1s st=-1 dur=150 t=0.0 vid=5OyTxEbT-fM => TRESC
gra t=4.3 ZAMROZONA obiekty=2 bramka=ukryta
klatki=865 zyje=15s
```

Co z tego wynika:

1. **`getDuration()` zwraca 150 — długość filmu — także w trakcie reklamy.**
   `getVideoData().video_id` też jest filmu. Detekcja z ADR-0022 nie miała szans zadziałać.
2. **`getPlayerState()` nigdy nie zwraca `PLAYING`** — widać `5` (CUED), `3` (BUFFERING)
   i `-1` (UNSTARTED), przy czym reklama leci w stanie `-1`.
3. **Silnik był poprawnie zamrożony (`ZAMROZONA`), a mimo to renderował dwa cele**
   (`obiekty=2`) — bo jego czas wynosił `t=4.3`, czyli tyle, ile upłynęło reklamy.
   Pętla klatek żyła (865 klatek / 15 s ≈ 58 fps), błędów JS nie było.

Źródłem czasu 4,3 s jest `getCurrentTime()`: **reklama ma własny zegar**, który odlicza
czas kreacji. `Engine.tick` w gałęzi freeze woła `adopt(sample.timeSec)` — celowo, żeby
przewinięcie na pauzie było widać na ekranie (ADR-0003) — więc czas gry wędrował po osi
reklamy, a `getView()` rysował cele, które o tej sekundzie istnieją.

**Wadą nie była flaga `playing`, tylko czas.** Zamrożenie działało; renderowanie celów
nie zależy od zamrożenia i zależeć nie powinno (na pauzie ekran ma pokazywać prawdę).

## Decyzja

Adapter (`src/ui/youtube.ts`) wpuszcza `getCurrentTime()` do silnika **tylko wtedy, gdy
zegar należy do treści**:

```ts
if (state === PLAYING) contentStarted = true;
const contentClock = contentStarted && state !== UNSTARTED;
```

- `contentClock === false` → `sample()` zwraca `playing: false` **i `timeSec` = ostatni
  znany czas treści** (na starcie `0`). Reklama nie przesuwa więc czasu gry ani o sekundę:
  przy pre-rollu gra stoi na zerze, przy mid-rollu na ostatniej sekundzie filmu.
- `contentClock === true` → ścieżka bez zmian: `playing: state === PLAYING`,
  `ended`, `rate` i `timeSec` prosto z playera.

`contentStarted` ustawia się wyłącznie w `sample()`, czyli wtedy, gdy pętla gry
faktycznie zaobserwowała `PLAYING` — stan playera poznajemy tylko przez próbkowanie.

**Heurystyka długości z ADR-0022 znika w całości** (`AD_DURATION_TOLERANCE_SEC`, `isAd()`).
Nie działała, a niosła ryzyko: zła wartość `videoDurationSec` zamrażała grę na cały film.
Pole `videoDurationSec` **zostaje** — służy już tylko stabilnej długości suwaka transportu.

## Konsekwencje

- Reklama = gra zamrożona **i czas gry stojący w miejscu**, więc nad reklamą nie ma czego
  renderować. Silnik nadal nie wie o reklamach nic.
- Przewijanie suwakiem na pauzie działa jak dawniej — po starcie treści `contentStarted`
  jest `true`, a `PAUSED` nie jest `UNSTARTED`, więc odczyt jest adoptowany.
- Zanim film pierwszy raz ruszy, każdy odczyt zegara jest ignorowany. To celowe:
  przed startem treści czas gry z definicji wynosi zero.
- Ryzyko resztkowe: gdyby reklama leciała w stanie `BUFFERING` **po** starcie treści,
  jej zegar znów zostałby zaadoptowany. Pomiar pokazał `-1`, więc reguła pokrywa
  zaobserwowany przypadek; gdyby wrócił, sonda pokaże to w pierwszej linii.
- `videoDurationSec` nie ma już wpływu na rozgrywkę — zła wartość psuje najwyżej suwak.
