# ADR-0016 — Tryb deweloperski nagrywania sciezki reki na osi czasu wideo

**Status:** przyjete
**Data:** 2026-08-09

## Kontekst

`src/data/beatmap.json` jest pisany recznie — dobranie `t/x/y` dla ruchomej
sciezki dloni na oko jest praktycznie niewykonalne. Potrzebny byl tryb, w
ktorym edytujacy przy zwolnionym tempie wideo "rysuje" ruch prawym przyciskiem
myszy, a probki laduja od razu w `beatmap.json` na dysku, z mozliwoscia
natychmiastowego przewiniecia wideo, zeby obejrzec efekt.

Blokerem byl istniejacy model czasu: `Engine.tick` liczyl predykcje jako
`timeSec + Δwall/1000`, twardo zakladajac tempo 1×. Przy 0,25× predykcja
uciekala 4× szybciej niz realny czas wideo, prog `SEEK_THRESHOLD_SEC = 0.35`
przekraczal sie po ~0,12 s zegara sciennego i silnik wpadal w petle falszywych
`resync()`.

Zakres jest wylacznie deweloperski — caly kod trybu wycinany z produkcyjnego
builda przez `import.meta.env.DEV`.

## Decyzja

### Tempo w modelu czasu

`TimeSample` dostaje opcjonalne pole `rate?: number` (brak = 1, zachowuje
zgodnosc z `FakeClock` i istniejacymi testami). `Engine.tick` skaluje
predykcje: `timeSec + (Δwall/1000) * rate`, z obrona przed
niedodatnim/nieskonczonym `rate` (traktowane jak 1). `src/ui/youtube.ts`
odczytuje `player.getPlaybackRate()` **w kazdym `sample()`**, bez cache'a —
reset tempa po reklamie czy zmianie z menu playera jest widoczny w
nastepnej klatce.

### `t` z czasu wideo, nigdy z zegara sciennego

Probki nagrywane w `onFrame()` uzywaja `engine.getView().timeSec` — jedynego
zrodla prawdy o czasie gry. `performance.now()` nigdzie nie wchodzi do
zapisywanych danych.

### Beatmapa w pamieci jest zrodlem prawdy; zapis na dysk to efekt uboczny

`mountDevRecorder` trzyma wlasna kopie beatmapy w domknieciu i wola
`engine.setObjects()` natychmiast po kazdej zmianie — stan gry aktualizuje sie
bez przeladowania strony. Zapis `POST /__beatmap` leci rownolegle jako efekt
uboczny; jego wynik (sukces/blad) nie wplywa na stan w pamieci. Reload przez
Vite HMR jest zablokowany po stronie pluginu: `handleHotUpdate` zwraca `[]`
dla `beatmap.json`, co Vite interpretuje jako "nie rob nic" — pewniejsze niz
`import.meta.hot.accept` po stronie klienta, bo statyczny import JSON-a w
`main.ts` i tak eskalowalby do pelnego reloadu.

### Prawy przycisk bez blokowania lewego

Zero nowych warstw z `pointer-events`. Nasluch `contextmenu` /
`pointerdown` / `pointermove` / `pointerup` / `pointercancel` /
`pointerleave` na `.stage` (dziecko `.obj` bąbelkuje przez `.overlay` z
`pointer-events: none`). `render.ts` dostaje strazy `if (event.button !== 0)
return;` przed `onHit` — prawy klik nigdy nie liczy sie jako trafienie.
`contextmenu` dostaje `preventDefault()` tylko gdy tryb dev jest aktywny.

Prawy klik w istniejacy `.obj` usuwa go i **konczy** — bez startu nagrania.
Brak trafienia -> brak `.obj` -> start nagrania z `setPointerCapture` w
`try/catch` (jsdom nie ma prawdziwych `PointerEvent`), z zakonczeniem takze na
`pointercancel`/`pointerleave` sceny.

### RDP z metryka czasowa, nie przestrzenna

`src/dev/rdp.ts`: `simplifyPath` liczy blad kandydata `[i..j]` jako odchylenie
od interpolacji **po czasie** miedzy `i` i `j` w chwili kazdego posredniego
punktu `t_k` — nie klasyczna odlegloscia prostopadla do prostej w (x, y).
Klasyczne RDP zgubiloby przystanek (zmiana predkosci) na odcinku, ktory w
przestrzeni jest prosty, ale w czasie nie jest liniowy — a to dokladnie blad,
ktory zobaczy gracz. Tolerancja **1,0** (procent wymiaru warstwy gry): sprite
ma 16% szerokosci, wiec 1% to ~1/16 dloni — ponizej progu zauwazalnosci, a przy
~240 probkach na sekunde wideo (0,25× × 60 fps) redukuje sciezke o rzad
wielkosci.

### Brak walidacji rejestru sprite'ow po stronie serwera

Endpoint `/__beatmap` woła `validateBeatmap(data, data.objects.map(o =>
o.sprite))` — pelne reguly strukturalne, ale bez sprawdzenia, czy `sprite`
faktycznie istnieje w `src/sprites.ts`, bo ten plik uzywa
`import.meta.env.BASE_URL` i wysadziłby sie przy ewaluacji w Node. Rejestr
sprawdza klient przed wyslaniem (`SPRITE_KEYS` prawdziwe w przegladarce).

### `FADE_OUT_MS` swiadomie bez zmian

`engine.ts` porownuje sekundy wideo ze stala wyrazona w ms zegara sciennego;
przy 0,25× animacja CSS `+1`/`✕` (0,5 s sciennej) skonczy sie 4× wczesniej niz
obiekt zniknie z DOM — pusty, niewidoczny `.obj` wisi ~1,5 s dluzej. Naprawa
wymagalaby wpuszczenia tempa w regule widocznosci silnika — kosztowniejsze niz
problem, ktory dotyczy wylacznie trybu dev.

### Bezpieczenstwo endpointu zapisu

Plugin Vite z `apply: 'serve'` (nigdy w buildzie — druga blokada w
`vite.config.ts`: `plugins: command === 'serve' ? [...] : []`). Jedna trasa
`POST /__beatmap`, limit ciala requestu ~1 MB, sciezka docelowa liczona
**wylacznie** z `server.config.root` (nigdy z requestu), zapis atomowy:
`beatmap.json.tmp` -> `renameSync`.

### `@types/node` — brak w projekcie

Zamiast dokladac zaleznosc, `src/dev/node-shims.d.ts` deklaruje minimalny
`declare module 'node:fs'` (`writeFileSync`, `renameSync`) i plugin uzywa
lokalnych, waskich typow `DevRequest`/`DevResponse` zamiast typow Connect z
`vite`, ktore bez `@types/node` rozwiazuja sie do praktycznie pustych typow
(`http.IncomingMessage`/`http.ServerResponse` z `node:http` sa nierozwiazywalne
bez `@types/node`, a `skipLibCheck` w `tsconfig.json` pozwala samemu Vite
skompilowac sie mimo to). Rzutowanie `req as unknown as DevRequest` w miejscu
wejscia do handlera.

### `NODE_ENV` wymuszany w `vite.config.ts`

Vite ustawia `process.env.NODE_ENV ||= ...` (nie nadpisuje, jesli juz
ustawione), wiec ambientowe `NODE_ENV=development` w powloce dewelopera
przetrwaloby `vite build` i uniemozliwilo eliminacje martwego kodu
`import.meta.env.DEV` — caly `src/dev/*` trafilby wtedy do bundla
produkcyjnego razem z endpointem zapisu. `vite.config.ts` wymusza teraz
`process.env.NODE_ENV = command === 'build' ? 'production' : 'development'`
na starcie funkcji konfiguracyjnej, niezaleznie od tego, co juz jest w
srodowisku.

## Konsekwencje

- `src/engine/types.ts`: `TimeSample.rate?: number`.
- `src/engine/engine.ts`: predykcja skalowana tempem; nowa metoda
  `Engine.setObjects(objects)` — podmienia obiekty bez restartu, przebudowuje
  `byId`, kasuje wyniki usunietych obiektow, wola `resync(timeSec)`.
- `src/ui/youtube.ts`: `PlayerHandle` dostaje `setPlaybackRate`,
  `getAvailablePlaybackRates`; `sample()` dolacza `rate`.
- `src/ui/render.ts`: `Ui` eksponuje `stage`, `overlay`,
  `setRecordingPreview(pos | null)`; strazy `button !== 0` przy `onHit`.
- Nowe pliki: `src/dev/rdp.ts`, `src/dev/record.ts`, `src/dev/recorder.ts`,
  `src/dev/beatmap-write-plugin.ts`, `src/dev/node-shims.d.ts`.
- `vite.config.ts`: plugin zapisu dolaczany tylko przy `command === 'serve'`;
  wymuszony `NODE_ENV`.
- `src/main.ts`: dynamiczny `import('./dev/recorder.js')` pod
  `import.meta.env.DEV`; petla `rAF` woła `dev?.onFrame()` po `game.frame()`.
- Nowe testy: `tests/playback-rate.test.ts`, `tests/rdp.test.ts`,
  `tests/dev-record.test.ts`, `tests/dev-mode.test.ts`.
- README: usuniety wpis "`playbackRate ≠ 1` nie jest wspierany"; dodana sekcja
  "Tryb deweloperski" i wpis o rozjezdzie `FADE_OUT_MS` przy tempie ≠ 1.

## Odrzucone warianty

- **`import.meta.hot.accept` po stronie klienta zamiast blokowania HMR w
  pluginie** — odrzucone: statyczny import JSON-a w `main.ts` i tak
  eskalowalby zmiane pliku do pelnego przeladowania strony, co zerowaloby
  stan gry (bramke startowa, pozycje odtwarzania) w trakcie edycji.
- **Klasyczne RDP na odlegosci euklidesowej w (x, y)** — odrzucone: gubi
  zmiany predkosci (przystanki) na odcinkach przestrzennie prostych.
- **Dodanie `@types/node`** — odrzucone bez pytania uzytkownika (projekt ma
  jawna liste dozwolonych zaleznosci); lokalne shimy/typy wystarczyly.
- **Undo/redo, edycja/przeciaganie istniejacych punktow, timeline, wybor
  sprite'a, zmiana `size` w trybie dev** — swiadomie poza zakresem (YAGNI),
  minimalny tryb wystarczajacy do nagrania sciezki.
