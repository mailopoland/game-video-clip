# ADR-0025 — Bezsłowny ekran wyniku, procent z całej beatmapy i restart przez seek

**Status:** przyjęte
**Data:** 2026-08-26
**Kontekst:** [ADR-0003](ADR-0003-zrodlo-czasu-i-maszyna-stanow.md) (resync),
[ADR-0005](ADR-0005-format-assetow-i-placeholdery.md) (rejestr assetów),
[ADR-0011](ADR-0011-dwuwariantowy-sprite-i-dzwiek-trafienia.md) (GIF jako format),
[ADR-0019](ADR-0019-wlasne-kontrolki-zamiast-kontrolek-youtube.md) (`TransportControls`)

---

## Problem

Ekran wyniku był listą polskich napisów: nagłówek „Koniec", „N pkt" oraz
`Trafienia / Pudła / Celnosc`. Trzy rzeczy z tym nie grały:

1. **Język.** Reszta warstwy gry jest bezsłowna (bramka startowa to jedna grafika,
   transport to ikony SVG). Polskie napisy były jedynym tekstem w interfejsie.
2. **`accuracy` kłamie po przewinięciu.** Mianownikiem są cele **ocenione** —
   obiekty `skipped` są z niego wykluczone (i słusznie: przewinięcie nie może
   generować fałszywych pudeł). Skutek uboczny: przewinięcie klipu do końca po
   jednym trafieniu dawało „Celnosc 100%".
3. **Brak drogi powrotu.** Po ekranie wyniku jedynym wyjściem było przeładowanie
   strony.

## Decyzja

### 1. Ekran wyniku bez polskich napisów

`X / Y` (liczby), procent, grafika zależna od procentu i przycisk `PLAY AGAIN` —
jedyny tekst jest angielski. Lista `Trafienia / Pudła / Celnosc` znika.

Ikona `⟳` przy przycisku jest **inline SVG**, nie glifem Unicode — dokładnie ten sam
powód co przy ikonach transportu (ADR-0020): iOS nie ma tych znaków w foncie i rysuje
puste kwadraty. Nowy wpis `replay` w istniejącej mapie `ICONS`.

### 2. Procent liczony z całej beatmapy, nie z celów ocenionych

Nowe pole `Stats.total` = `beatmap.objects.length`, czytane przy każdym wywołaniu
`getStats()` (więc `setObjects()` z trybu dev — ADR-0018 — pozostaje spójne).
Ekran wyniku pokazuje `hits / total`.

`accuracy` **zostaje** w modelu i w testach: nadal jest poprawną odpowiedzią na
pytanie „jak celnie grałeś w tym, co faktycznie zagrałeś". UI po prostu odpowiada
na inne pytanie — „ile z całego klipu trafiłeś" — i na to `accuracy` się nie nadaje.

`resultPercent()` rezerwuje wartości skrajne: `1/1000 → 1%` (nie 0), `999/1000 → 99%`
(nie 100). Bez tego zaokrąglenie oddawałoby grafikę „Perfect" wynikowi bez kompletu
trafień, a grafikę „zero" komuś, kto jednak trafił. Ta sama liczba karmi napis i wybór
grafiki (`resultImageSrc()`), więc nie mogą się rozjechać na granicy kubełka.

Logika siedzi w osobnym module `src/ui/result-image.ts` — czysta funkcja, testowalna
bez DOM, tak jak reszta reguł.

### 3. Restart przez `seekTo(0)`, bez nowego API silnika

`PLAY AGAIN` woła `controls.seekTo(0)` + `controls.play()` na tych samych
`TransportControls`, które obsługują suwak (ADR-0019). Dalej dzieje się to,
co przy zwykłym przewinięciu: `Engine.tick()` wykrywa rozjazd większy niż
`SEEK_THRESHOLD_SEC`, woła `resync(0)`, a ten kasuje wyniki wszystkich obiektów
(despawn ≥ 0). Ekran wyniku gaśnie sam (`timeSec < endScreenAtSec`), `ended` wraca
na `false`, gdy player wyjdzie ze stanu `ENDED`.

### 4. GIF, nie PNG

Sześć grafik po ~1,7 MB w PNG to ~10 MB — za dużo. Konwersja jednorazowa, lokalnym
`ffmpeg`-iem, do wysokości 768 px z zachowaną przezroczystością
(`reserve_transparent=1` + `alpha_threshold=128`): 540 kB łącznie. Komenda jest
w README.

Preload (`preloadResultImages()`) idzie do `onStart`, a **nie** do montażu UI jak
`preloadSprites()` — sprite dłoni musi być w cache, zanim za ~2 s pojawi się
pierwszy cel, a grafiki wyniku mają na pobranie całą długość klipu i nie mają
konkurować z buforowaniem wideo przed startem.

## Odrzucone alternatywy

- **Zostawić `accuracy` na ekranie wyniku.** Odrzucone: po przewinięciu pokazuje
  100% przy jednym trafieniu, czyli dokładnie odwrotność tego, co ekran wyniku ma
  komunikować.
- **Zmienić semantykę `accuracy` w silniku** (wliczyć `skipped` do mianownika).
  Odrzucone: `accuracy` byłoby wtedy tym samym co nowy procent, a straciłoby swoje
  faktyczne zastosowanie i sens w istniejących testach. Taniej dodać pole niż
  przeciążyć istniejące.
- **Restart przez `location.reload()`.** Odrzucone: gubi gotowy player i wymusza
  ponowne buforowanie, a bramka startowa i odblokowanie `AudioContext` (ADR-0017)
  musiałyby wydarzyć się drugi raz.
- **Nowe API silnika (`Engine.reset()`).** Odrzucone: `resync(0)` już to robi
  i jest pokryte testami przewijania. Drugi mechanizm zerowania wyniku to drugie
  miejsce, w którym może pojawić się rozjazd.
- **PNG bez konwersji.** Odrzucone: ~10 MB assetów na statycznym hostingu wobec
  540 kB po konwersji. Kosztem jest 1-bitowa przezroczystość — ten sam świadomy
  kompromis co przy sprite'ach dłoni (ADR-0011).

## Konsekwencje

- `Stats` ma nowe **wymagane** pole `total` — każdy literał `Stats` (także w testach)
  musi je podać.
- W trybie dev dodanie lub usunięcie obiektu natychmiast zmienia mianownik na
  ekranie wyniku. To celowe: `total` opisuje aktualną beatmapę, nie tę z chwili startu.
- 1-bitowa przezroczystość może dać twardszą krawędź na miękkiej poświacie wokół
  postaci. `score5.gif` obejrzano na ciemnym tle (czysto); całego ekranu wyniku na
  tle prawdziwego kadru nie zweryfikowano w przeglądarce.
