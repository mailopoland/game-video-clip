# ADR-0027 — Assety jako PNG-8 generowane własnym skryptem, w rozdzielczości wyświetlania

**Status:** przyjęta
**Data:** 2026-08-27
**Zastępuje:** uzasadnienie formatu z [ADR-0011](ADR-0011-dwuwariantowy-sprite-i-dzwiek-trafienia.md)
(GIF kontra animowany WebP) oraz przepis `ffmpeg` na grafiki wyniku z
[ADR-0025](ADR-0025-obrazkowy-ekran-wyniku-i-restart.md).

## Kontekst

Strona ważyła **1,23 MB transferu na jedną rozgrywkę**, prawie w całości w obrazkach:

| Asset | Waga | Co pokazał pomiar |
|---|---|---|
| `hand-idle.gif` | 197 kB | **1254×1254 px, jedna klatka** — wyświetlany zwykle jako ~200 px CSS |
| `hand-hit.gif` | 219 kB | 1254×1254, jedna klatka |
| `start-manual.gif` | 204 kB | 1672×941, jedna klatka |
| `results/score0–5.gif` | 540 kB | sześć plików pobieranych w `onStart`, pokazywany **jeden** |

Dwa założenia, na których stała poprzednia decyzja, okazały się nieprawdziwe:

1. **„GIF-y są animowane”** — nie są. Wszystkie mają dokładnie jedną klatkę, więc
   argument z ADR-0011 („animowany WebP wymagałby narzędzia konwersji, którego
   projekt nie ma”) nie ma zastosowania: statyczny obrazek zapisze każdy format.
2. **„Rozdzielczość źródła jest potrzebna”** — nie jest. Mediana `size` w beatmapie
   to 94, czyli ~200 px CSS przy scenie ograniczonej do 1280 px. Sprite dłoni był
   pobierany w rozdzielczości ~6× większej, niż jest rysowany.

Trzecie źródło marnotrawstwa jest niezależne od formatu: ekran wyniku pokazuje
jedną z sześciu grafik, a pobierał wszystkie sześć.

## Decyzja

**1. Format: PNG-8 (paleta + `tRNS`) zamiast GIF-a.** Ta sama klasa formatu
(obraz indeksowany), ale deflate zamiast LZW i — co ważniejsze — **8-bitowa alfa
na wpis palety** zamiast 1-bitowej maski GIF-a.

**2. Rozdzielczość dobrana do wyświetlania, nie do źródła:** dłonie 512 px,
bramka startowa 836 px, grafiki wyniku 512×768 (bez zmiany — pokazywane statycznie
na pełną wysokość sceny).

**3. Konwersja własnym skryptem `scripts/optimize-assets.mjs`**, dokładnie na tej
samej zasadzie co istniejący `scripts/make-icons.mjs`: dekoder GIF (LZW) i PNG,
box filter na premultiplikowanej alfie, median cut w RGBA i enkoder PNG na
`node:zlib`. **Zero zależności npm, nic nie pobierane z internetu** (zasada
projektu). Wynik jest commitowany, tak jak ikony PWA.

**4. Źródłem są oryginały z `images/`, nie pliki z `public/`** — inaczej każde
uruchomienie kwantyzowałoby wynik poprzedniego. Dla grafik wyniku znaczy to
wejście wprost z `images/scoreN.png` (1024×1536 RGBA), z pominięciem pośredniego
GIF-a, a więc i kroku w `ffmpeg`.

**5. Grafika ekranu wyniku pobierana jest jedna, dopiero pod koniec klipu.**
`preloadResultImages()` (sześć plików w `onStart`) zastąpione przez
`preloadResultImage(src)` wołane z `src/game.ts`, gdy
`shouldPrefetchResult(timeSec, endScreenAtSec, RESULT_PREFETCH_LEAD_SEC = 15)`
i kubełek procentowy różni się od ostatnio pobranego.

## Wynik pomiaru

| | Przed | Po |
|---|---|---|
| `public/` na dysku | 1330 kB | 561 kB |
| transfer przed kliknięciem „graj” | 687 kB | 195 kB |
| transfer grafik wyniku | 540 kB (6 plików) | ~70 kB (1 plik) |
| **transfer na rozgrywkę** | **~1,23 MB** | **~265 kB** |
| `dist/` łącznie | 1327 kB | 694 kB |
| bundle JS | 53,6 kB / 20,3 kB gz | 38,2 kB / 12,8 kB gz |

Jakość **rośnie**, nie spada:

- Grafiki wyniku idą wprost ze źródła zamiast przez 256-kolorowy GIF. Zmierzony
  średni błąd względem oryginału: **3,1–3,8 zamiast 6,0–7,5** — dwa razy wierniej
  przy pliku o 25% mniejszym.
- Sprite'y dłoni: średni błąd kwantyzacji 0,41 i 0,68 w skali 0–255.
- Geometria zachowana w granicach **0,1%** ramki sprite'a (sprawdzone przez
  porównanie prostokątów otaczających przed i po skalowaniu), więc **żadna
  współrzędna beatmapy nie wymaga migracji**.

## Konsekwencje

- Znika znane ograniczenie „obwódka 1-bitowej przezroczystości GIF-a” z ADR-0011:
  krawędzie mają teraz pełną alfę.
- `scripts/make-favicon.mjs` traci własną, równoległą kopię dekodera GIF-a
  i enkodera PNG (~290 linii) — korzysta z funkcji generatora assetów.
- Podmiana grafiki to nadal jedna linia w `src/sprites.ts`, plus wpis w tablicy
  `TASKS` generatora.
- Skok suwakiem prosto na koniec klipu może pokazać grafikę wyniku z ~100 ms
  opóźnieniem — wcześniej wszystkie sześć było już w cache. Świadomy koszt
  0,5 MB oszczędności u każdego gracza.
- Skrypt **odmawia** konwersji GIF-a wieloklatkowego zamiast po cichu wziąć
  pierwszą klatkę. Gdyby kiedyś doszedł animowany asset, decyzja wraca na stół.

## Rozważone i odrzucone

- **WebP / AVIF przez `ffmpeg`** — mniejsze (~80–100 kB łącznie), ale `ffmpeg`
  jest narzędziem spoza projektu, a wynik nie dałby się odtworzyć ani zweryfikować
  w CI. Wariant zostaje otwarty: `src/sprites.ts` to jedna linia zmiany.
- **`srcset` z dwoma wariantami dłoni** — `size` obiektu zmienia się w czasie
  (interpolacja po ścieżce), więc atrybut `sizes` byłby przybliżeniem. Więcej
  kodu i więcej miejsc do zepsucia niż warta jest różnica.
- **Odłożenie iframe'a YouTube do kliknięcia bramki (fasada)** — największy
  pojedynczy zysk (~1,5 MB skryptów YouTube), ale `playVideo()` przestałoby lecieć
  wewnątrz gestu użytkownika, co na iOS zagraża i autoplayowi, i odblokowaniu
  `AudioContext` (ADR-0009, ADR-0017). Odrzucone świadomie.
