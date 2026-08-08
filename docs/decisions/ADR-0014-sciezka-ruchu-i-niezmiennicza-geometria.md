# ADR-0014 — Sciezka ruchu w beatmapie i niezmiennicza geometria

**Status:** przyjete
**Data:** 2026-08-08

## Kontekst

Dwa powiazane problemy zglos zone przez uzytkownika:

1. **Cele byly statyczne.** Sprite dloni mial podazac za obiektem poruszajacym sie
   w klipie — potrzebna byla sciezka: lista punktow `(x, y, size, t)` z plynna
   interpolacja miedzy nimi.
2. **Pozycja celu nie byla stala wzgledem obrazu.** Ten sam `y` ladowal w innym
   miejscu kadru w zaleznosci od rozmiaru sceny (telefon vs pelny ekran).

Przyczyna problemu 2: `.overlay { inset: 0 0 3.5rem 0 }` w `src/styles.css`.
Wartosc `3.5rem` jest absolutna (56 px), a `y%` liczy sie wzgledem wysokosci
warstwy gry. Przy scenie 1920x1080 pas to 5% wysokosci, przy scenie 375x211 —
27%. Reszta geometrii (`x%`, `y%`, `width: 16%`, `aspect-ratio: 1`, sztywne
`aspect-ratio: 16/9` sceny) byla juz niezmiennicza.

## Decyzja

| Decyzja | Wybor | Uzasadnienie |
|---|---|---|
| Skala czasu punktow | Absolutne sekundy wideo | Ta sama skala co `time` i `endScreenAtSec` — strojenie wprost z timeline'u klipu. |
| `path` vs `x`/`y`/`size` | `path` zastepuje je calkowicie | Jeden sposob opisu pozycji; zero niejednoznacznosci "co wygrywa". Obiekt statyczny = `path` z jednym punktem. |
| Pas kontrolek | `inset: 0 0 8% 0` | Mapowanie `y%` stale przy kazdym rozmiarze, kontrolki YouTube nadal chronione. Koszt: dolne 8% kadru niedostepne dla celow. |
| Poza zakresem sciezki | Przytrzymanie skrajnej wartosci | Sciezka opisuje tylko to, co sie rusza; obiekt nie skacze ani nie znika przy zadnej dlugosci sciezki. |
| Interpolacja | Liniowa | Przy sledzeniu wideo daje gwarancje zbieznosci: obiekt nigdy nie wyjdzie poza odcinek miedzy sasiednimi punktami, wiec kazdy dodany punkt zawsze zmniejsza rozjazd. Zmienna predkosc oddaje rozstaw punktow. `easeInOut` odpada (wymusza predkosc 0 w kazdym punkcie — obiekt na wideo tam nie staje). Catmull-Rom odrzucony przez overshoot na ostrych zakretach. |
| Kosmetyka | Jednostki `cqw` wlaczone | Grubosc okregu, cien i font feedbacku tez staja sie niezmiennicze. |

**Nieuwzglednione swiadomie (YAGNI):** per-punktowe krzywe/easing, obrot sprite'a,
walidacja pokrycia sciezka calego okna widocznosci. Format danych nie zamyka drogi
do dolozenia Catmull-Rom pozniej — to podmiana jednej funkcji, bez ruszania beatmapy.

### Interpolacja idzie do silnika, nie do renderera

Ruch staje sie — dokladnie jak `approach` — czysta funkcja czasu wideo
(`samplePath(path, timeSec)` w `src/engine/path.ts`, wywolywane z
`Engine.visibleObjects()`). Dzieki temu:

- zamarza na pauzie i resynchronizuje sie po przewinieciu bez ani jednej linii
  kodu w tej sprawie (silnik juz zamraza `timeSec`);
- da sie go przetestowac fake clockiem, bez jsdom;
- `render.ts` zostaje glupi — bierze liczby (`visible.x/y/size`) i wpisuje w styl
  co klatke, bezwarunkowo, obok istniejacego ustawiania `approach`.

Silnik nadal nie wie nic o DOM: `x`/`y`/`size` to procenty warstwy gry, czyli
ta sama umowa co wczesniej w beatmapie. Punktacja, maszyna stanow, `resync` i
`sweepMisses` nie zmienily sie w ogole — ruch jest czysto prezentacyjny.

### Naprawa niezmienniczosci pozycji: `inset` w procentach zamiast `rem`

`.overlay { inset: 0 0 8% 0 }` — mapowanie `y%` z beatmapy na pozycje w warstwie
gry jest teraz identyczne niezaleznie od rozmiaru sceny. `3.5rem` w
`--stage-width` (`.frame`) zostaje bez zmian — to wysokosc HUD-u pod scena, bez
zwiazku z warstwa gry.

## Konsekwencje

- `src/engine/types.ts`: nowy `PathPoint`, `BeatmapObject.path` zastepuje
  `x`/`y`/`size`, `VisibleObject` dostaje zinterpolowane `x`/`y`/`size`.
- `src/engine/path.ts` (nowy): `samplePath`, czysta funkcja, pokryta 7 testami w
  `tests/path.test.ts` (srodowisko `node`, bez jsdom).
- `src/engine/beatmap.ts`: walidacja `x`/`y`/`size` na poziomie obiektu zastapiona
  walidacja punktow `path` (niepusta, kazdy punkt w zakresie, `t` scisle rosnace).
- `src/data/beatmap.json`: wszystkie 28 obiektow zmigrowane mechanicznie —
  `path: [{ t: time, x, y, size }]`, bez zmiany zachowania (przytrzymanie
  skrajnej wartosci daje identyczna pozycje jak przed migracja).
- `tests/fake-clock.ts`: fabryka `obj()` domyslnie tworzy jednopunktowa `path`
  z `t` rownym `time`.
- `src/ui/render.ts`: `left`/`top`/`width` liczone z `visible.x/y/size` zamiast
  `object.x/y/size`, ustawiane bezwarunkowo co klatke w `render()`.
- `src/styles.css`: `.overlay` w procentach (naprawa niezmienniczosci),
  `container-type: inline-size` na `.stage`, jednostki `cqw` dla obwodki okregu,
  cienia sprite'a i fontu feedbacku.
- **Jednostki `cqw` i `container-type` nie sa pokryte testami** — jsdom nie
  liczy ukladu. Niezmienniczosc wizualna wymaga jednego recznego sprawdzenia w
  `npm run dev`: ten sam cel na telefonie i w pelnym ekranie musi ladowac w tym
  samym miejscu kadru. Dodane do znanych ograniczen w README.

## Ryzyka i ograniczenia

- **Klip nie-16:9.** Jesli realny klip ma inne proporcje niz 16:9, YouTube doda
  czarne pasy wewnatrz iframe'a i "ten sam punkt sceny" przestanie znaczyc "ten
  sam punkt obrazu". API nie udostepnia proporcji wideo, wiec nie da sie tego
  skompensowac programowo. Przy klipie 16:9 problem nie istnieje.
- **Dolne 8% kadru niedostepne dla celow** — swiadomy koszt ochrony kontrolek
  YouTube. Jesli w praktyce okaze sie za duzy, zmiana to jedna liczba w
  `.overlay`.
- **`container-type: inline-size`** wymaga przegladarki z 2023+. Zgodne z reszta
  projektu (`aspect-ratio`, `100dvh`, `:fullscreen`).

## Odrzucone warianty

- **`easeInOut` na kazdym punkcie** — wymusza predkosc 0 w kazdym punkcie
  sciezki; obiekt sledzacy rzecz w ruchu na wideo tam nie zwalnia, wiec dawaloby
  to widoczny rozjazd.
- **Catmull-Rom** — daje gladsza sciezke, ale moze przestrzelic (overshoot) poza
  odcinek miedzy punktami na ostrych zakretach, co psuje gwarancje zbieznosci
  liniowej interpolacji przy dostrajaniu do wideo.
- **Osobne pola `x`/`y`/`size` obok `path`** — dwa sposoby opisu tej samej rzeczy
  wymagalyby reguly "co wygrywa"; `path` z jednym punktem pokrywa przypadek
  statyczny bez dodatkowej skladni.
