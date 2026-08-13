# ADR-0018 — Tryb deweloperski edycji punktow sciezki

**Status:** przyjete
**Data:** 2026-08-12

## Kontekst

ADR-0016 rozwiazal problem nagrywania nowej sciezki reki od zera. Nie rozwiazal
innego, rownie powtarzalnego problemu: **korekty juz nagranej sciezki**. Nagranie
gestem prawym przyciskiem myszy przy zwolnionym tempie rzadko trafia idealnie w
rytm klipu za pierwszym razem — pojedynczy punkt trzeba przesunac o kilka procent
albo zmniejszyc `size`, zeby dlon nie zaslaniala wazniejszego fragmentu kadru.
Reczna edycja `t/x/y/size` w `beatmap.json` w edytorze tekstu jest dokladnie tak
samo niepraktyczna, jak reczne wpisywanie znacznikow czasu bylo przed ADR-0016 —
bez podgladu na scenie nie da sie ocenic, czy poprawka faktycznie trafia w rytm.

Potrzebny byl drugi, niezalezny tryb dev: wybor istniejacego obiektu i punktu
jego `path`, przeciagniecie punktu po scenie, zmiana jego `size`, zapis na dysk
tym samym mechanizmem co tryb nagrywania. Zakres pozostaje wylacznie
deweloperski — kod wycinany z produkcyjnego builda tak samo jak reszta
`src/dev/*` (ADR-0016).

## Decyzja

### Odwrocenie dwoch wolan YAGNI z ADR-0016

ADR-0016 explicite wykluczyl **edycje/przeciaganie istniejacych punktow** i
**zmiane `size` w trybie dev** jako poza zakresem — w momencie pisania ADR-0016
minimalny tryb "nagraj od zera" wystarczal do zbudowania pierwszej wersji
beatmapy. Realna potrzeba, ktora ujawnila sie pozniej: beatmapa wymaga
dostrajania rytmu wzgledem prawdziwego klipu, a nie tylko jednorazowego
nagrania z reki. Powtorne nagranie calej sciezki dla jednego zle trafionego
punktu jest strata pracy i ryzykuje utrate poprawnych fragmentow. Oba
wykluczenia z ADR-0016 zostaja tu odwrocone — reszta odrzuconych tam
elementow (undo/redo, timeline, wybor sprite'a) pozostaje poza zakresem, bo
nie zmienil sie warunek, ktory je tam wykluczyl.

### `BeatmapStore` — wspolny stan zamiast prywatnej kopii per modul

`mountDevRecorder` (ADR-0016) trzyma beatmape we wlasnym domknieciu. Gdyby
`mountDevHandEditor` zrobil to samo, przelaczenie checkboxa z trybu nagrywania
na tryb edycji (albo odwrotnie) zgubiloby niezapisane jeszcze zmiany zrobione
w trybie, z ktorego edytujacy wlasnie wyszedl — kazdy modul widzialby tylko
swoja kopie sprzed przelaczenia. `src/dev/beatmap-store.ts` eksportuje
`BeatmapStore` (`get`/`set`) tworzony raz w `main.ts` i przekazywany do obu
modulow — jedna beatmapa w pamieci, wspoldzielona, niezaleznie od tego, ktory
tryb jest akurat aktywny. Zapis na dysk (`POST /__beatmap`) pozostaje efektem
ubocznym po stronie kazdego modulu, tak jak w ADR-0016 — `BeatmapStore` nie
odpowiada za trwalosc, tylko za spojnosc stanu w pamieci.

### Wzajemna wylacznosc bez wspolnego enuma trybu

Rozwazany byl jeden obiekt/enum "aktywny tryb" w `main.ts`, ktory oba moduly by
odczytywaly. Odrzucone: kazdy modul (`mountDevRecorder`, `mountDevHandEditor`)
pozostaje samodzielny i nie wie nic o istnieniu drugiego — tak jak
`mountDevRecorder` nie wiedzial nic o edytorze przed tym ADR-em. Zamiast tego
kazdy modul dostaje w opcjach `onActiveChange(active: boolean)`, wolane przy
kazdej zmianie wlasnego checkboxa, i wystawia na zewnatrz `deactivate()` (wylacz
sie programowo, odznacz checkbox) oraz `setDisabled(disabled: boolean)`
(zablokuj/odblokuj wlasny checkbox). Kompozycja w `main.ts` spina oba: aktywacja
rekordera woloa `handEditor.deactivate()` i `handEditor.setDisabled(true)`, i
symetrycznie w druga strone. Koordynacja zyje w jedynym miejscu, ktore juz zna
oba moduly (`main.ts` jako "composition root"), zamiast wprowadzac trzeci,
wspolny byt stanowy, ktory oba moduly musialyby importowac i synchronizowac.

### Koalescencja zapisu — jedyne swiadome odejscie od "brak debounce" z ADR-0016

Rekorder z ADR-0016 zapisuje na dysk raz na gest, w `pointerup` — z definicji
nigdy nie ma dwoch zapisow tego samego obiektu w locie jednoczesnie. Edytor
punktow generuje `pointermove` wielokrotnie na sekunde podczas przeciagania.
`beatmap-write-plugin.ts` (ADR-0016) robi **pelny atomowy zapis calego pliku**
przy kazdym zadaniu, bez numeru porzadkowego ani sprawdzenia "czy to najnowsza
wersja" — jesli dwa requesty typu POST byly by w locie jednoczesnie, ich
odpowiedzi (i tym samym zapisy na dysku) moglyby wrocic w innej kolejnosci niz
zostaly wyslane. Stan w pamieci (i w konsekwencji widok gry) zostalby
poprawny, ale plik na dysku zostalby cicho cofniety do starszej wersji —
regresja niewidoczna w samej aplikacji, widoczna dopiero po restarcie
dev servera albo w historii gita.

Naprawa: `dirty`/`persistInFlight` sprawdzane raz na klatke w `onFrame()`
(wolanym z tej samej petli `rAF`, co `mountDevRecorder.onFrame()`). Kazda
zmiana ustawia `dirty = true`; `onFrame()` wysyla `fetch('/__beatmap')` tylko
gdy `dirty && !persistInFlight`, ustawia `persistInFlight = true` i czysci
`dirty` przed wyslaniem, a po zakonczeniu (sukces lub blad) zeruje
`persistInFlight` i — jesli w miedzyczasie cos sie zmienilo — planuje kolejny
zapis na nastepnej klatce. Efekt: co najwyzej jeden zapis w locie, laduje w
ciagu ~16 ms od ostatniej zmiany (jedna klatka `rAF`) — niezauwazalne dla
czlowieka przeciagajacego mysza, ale eliminuje wyscig niezaleznie od tego, jak
czesto faktycznie odpalaja sie `pointermove`. To jedyne swiadome odejscie od
precedensu "brak debounce" z ADR-0016: **debounce opozniloby zapis, ale nie
usunalby wyscigu** (dwa opoznione zapisy nadal moga wystartowac rownolegle,
jesli zmiany przychodza czesciej niz okno debounce) — strazenik "co najwyzej
jeden w locie" usuwa przyczyne, nie tylko objaw.

### Dopisek: edytowalne pola panelu i wyswietlacz czasu (2026-08-13)

Panel z lista punktow byl poczatkowo tylko-do-odczytu (`formatPathPoint`) — jedynym
sposobem zmiany `x`/`y`/`size` bylo przeciaganie na scenie, a `t` w ogole nie dalo
sie zmienic bez ponownego nagrania punktu. W praktyce doprecyzowanie `t` o ulamek
sekundy albo drobna korekta `size` bez dostepu do myszy (np. touchpad) byly
niewygodne. Kazdy wiersz panelu dostal cztery pola liczbowe (`t`/`x`/`y`/`size`)
edytowalne przez wpisanie wartosci, zapisywane natychmiast po `change` (blur/Enter,
nie po kazdym znaku) — tym samym mechanizmem `applyPointPatch`/koalescencji zapisu,
co drag na scenie. Wybor punktu do przeciagania na scenie przeniesiony na osobny
przycisk `#<indeks>` w wierszu, zeby klikniecie w polu input nie wywolywalo seeka.

`updatePathPoint` (record.ts) rozszerzone o pole `t` bez wlasnego clampu — w
przeciwienstwie do `x`/`y`/`size` nie ma naturalnego zakresu, ale musi zachowac
scisle rosnaca kolejnosc w `path`, ktora juz egzekwuje `validateBeatmap`. Zamiast
duplikowac ta regule w `record.ts`, `applyPointPatchAt` w `hand-editor.ts` owija
`validateBeatmap` w try/catch: nieudana walidacja (np. `t` kolidujace z sasiednim
punktem) nie trafia do `store`/silnika, status pokazuje komunikat bledu, a pole w
DOM wraca do wartosci z magazynu — bez tego pojedynczy zly wpis zawieszalby aplikacje
na nieprzechwyconym wyjatku.

Wyswietlacz czasu (`.dev-time-display`, `formatClock` w `record.ts`) pokazuje
`timeSec` z `engine.getView()` w formacie `M:ss.mm` (minuty, sekundy, setne czesci
sekundy) nad scena, wylacznie gdy ten tryb jest aktywny — dostrajanie `t` w panelu
wymaga odniesienia do aktualnej pozycji w klipie bez przelaczania sie na inny
widok/devtools.

`formatPathPoint` (tylko-do-odczytu format punktu) zostal usuniety jako martwy kod
po przejsciu panelu na pola edytowalne — nie mial juz zadnego wywolania w `src/`.

## Konsekwencje

- Nowe pliki: `src/dev/beatmap-store.ts`, `src/dev/hand-editor.ts`.
- `src/dev/record.ts`: nowe funkcje wspoldzielone przez oba tryby —
  `updatePathPoint` (dziala tez z `t`), `computeDragResize`, `distancePercent`,
  `formatClock`.
- `src/ui/render.ts`: `Ui` eksponuje `setHandSelection` (piersciensiegien
  zaznaczenia + uchwyt rozmiaru), uzywane wylacznie przez `hand-editor.ts`.
- `src/main.ts`: `createBeatmapStore` tworzony raz, przekazywany do obu
  dynamicznie importowanych modulow dev; `onActiveChange` spina wzajemna
  wylacznosc; petla `rAF` woloa `handEditor?.onFrame()` obok
  `recorder?.onFrame()`.
- Nowe testy: `tests/beatmap-store.test.ts`, `tests/dev-hand-editor.test.ts`,
  `tests/dev-mode-exclusivity.test.ts`.
- README: nowa sekcja "Tryb deweloperski — edycja punktow sciezki", usuniete z
  "poza zakresem" punkty o edycji/przeciaganiu i zmianie `size`, zaktualizowana
  "Warstwa gry i DOM" o `.dev-edit-layout`, zaktualizowana liczba testow.

## Odrzucone warianty

- **Prywatna kopia beatmapy w kazdym module dev (jak w ADR-0016)** —
  odrzucone: przelaczenie trybu w trakcie edycji gubiloby niezapisane zmiany z
  trybu, z ktorego edytujacy wlasnie wyszedl.
- **Wspolny enum/obiekt "aktywny tryb" w `main.ts`** — odrzucone: kazdy modul
  dev pozostaje samodzielny i nie wie o istnieniu drugiego; koordynacja przez
  `onActiveChange`/`deactivate`/`setDisabled` trzyma logike wylacznosci w
  jednym miejscu (composition root), bez trzeciego, wspolnego bytu stanowego.
- **Debounce zapisu zamiast strazenika `persistInFlight`** — odrzucone:
  opoznia zapis, ale nie eliminuje wyscigu przy zmianach czestszych niz okno
  debounce; strazenik "co najwyzej jeden zapis w locie" usuwa przyczyne.
- **Undo/redo, timeline, wybor sprite'a inny niz `hand`** — nadal poza
  zakresem (YAGNI), niezmienione wzgledem ADR-0016.
