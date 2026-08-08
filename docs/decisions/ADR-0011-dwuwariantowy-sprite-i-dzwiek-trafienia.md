# ADR-0011 — Dwuwariantowy sprite i dzwiek trafienia w warstwie UI

**Status:** przyjete
**Data:** 2026-08-08

## Kontekst

Gra do tej pory renderowala cele jako pojedynczy statyczny obraz (`guy`/`girl`) bez
zadnego sprzezenia zwrotnego poza tekstem `+1`/`✕` i animacja `pop`. Zmiana wprowadza
jeden sprite „dlon" z dwoma wariantami wizualnymi (oczekiwanie / trafienie) oraz
dzwiek klapniecia na trafienie. Pudlo i wygasniecie pozostaja ciche i wizualnie
niezmienione.

Trzy pytania wymagaly rozstrzygniecia: jak zamodelowac drugi wariant grafiki bez
psucia reguly „`sprites.ts` jest jedynym miejscem znajacym assety"; jak zagwarantowac,
ze dzwiek nigdy nie odtworzy sie przy przewijaniu (wymaganie „zero duchow" analogiczne
do punktacji); i jak obejsc polityki autoplay/audio-unlock na mobile bez zadnej nowej
zaleznosci.

## Decyzja

### 1. `hitSrc` jako opcjonalne pole, nie mapa stanow

```ts
export type Sprite =
  | { kind: 'css'; className: string }
  | { kind: 'image'; src: string; hitSrc?: string };
```

Maszyna stanow celu ma dokladnie jeden dodatkowy stan wizualny (`hit`; `miss` nie
zmienia grafiki), wiec pelny `Record<Outcome, src>` bylby abstrakcja „na przyszlosc".
`validateBeatmap` nie wymaga zmian — waliduje istnienie klucza `sprite` w rejestrze,
nie liczbe wariantow pod nim. `render.ts` podmienia `img.src` na `hitSrc`, gdy
`visible.outcome === 'hit'`, idempotentnie (`render()` leci co klatke przez caly
`FADE_OUT_MS`). `hitSrc` jest wstepnie ladowany (`new Image().src = hitSrc`) przy
montazu obiektu, zeby podmiana nie dala pustej klatki.

### 2. Dzwiek wylacznie na sciezce `onHit` — odpornosc konstrukcyjna, nie przez warunek

`sound.play()` jest wywolywane w dokladnie jednym miejscu: `onHit` w `src/game.ts`,
gdy `engine.hit(objectId)` zwroci `true`. `resync()` i `sweepMisses()` (silnik) nie
przechodza przez ta sciezke, wiec przewiniecie (w tyl czy w przod) fizycznie nie ma
jak wywolac dzwieku — dokladnie ta sama zasada, co „wynik jest funkcja mapy, nie
licznikiem" z ADR-0003. `engine.hit()` juz zwracalo `boolean`; silnik nie zmienia sie
w ogole.

### 3. Pula 4 elementow `Audio`, round-robin, zamiast jednego elementu

Jeden element restartowany przez `currentTime = 0` ucinalby poprzedni klaps przy
dwoch szybkich trafieniach — a najmniejszy odstep miedzy celami w produkcyjnej
beatmapie jest krotszy niz dlugosc klapsu. Cztery elementy to zapas na serie po
seeku i szybkie klikanie, nie liczba wyprowadzona z czegokolwiek precyzyjnego.
`src/ui/sound.ts` (`createHitSound`) przyjmuje wstrzykiwana fabryke `make`
(domyslnie `(src) => new Audio(src)`), zeby testy mogly podstawic atrape —
jsdom nie implementuje `HTMLMediaElement.play()`/`pause()`.

Odblokowanie audio na iOS/WebKit dziala na poziomie *elementu*, nie strony — dlatego
`unlock()` (wyciszony `play()` → `pause()` → `currentTime = 0` na kazdym elemencie
puli) jest wywolywane raz, w `onStart`, w obrebie tego samego gestu „Graj", ktory juz
i tak jest wymagany przez polityke autoplay (ADR-0009). Zaden element nie jest
klonowany po odblokowaniu — klon bylby nieodblokowany.

### 4. GIF zamiast konwersji do animowanego WebP

Rejestr assetow ADR-0005 zaleca WebP, ale animowany WebP wymagalby narzedzia
konwersji, ktorego projekt nie ma, i/lub pobierania z internetu — obie sciezki sa
poza ograniczeniami projektu („nie pobieramy niczego z internetu"). Zrodlowe GIF-y sa
juz w repo. `<img>` z animowanym GIF-em dziala bez zadnej zmiany w rendererze — format
jest dla kodu przezroczysty (ADR-0002/0005).

## Konsekwencje

- `SPRITES` ma teraz dokladnie jeden klucz (`hand`); `guy`/`girl` usuniete z rejestru,
  z beatmapy i z `public/sprites/`.
- Nowy plik `src/ui/sound.ts` i nowa opcja `sound?: HitSound` w `mountGame` — domyslnie
  tworzy pule na `HIT_SOUND_SRC` z `src/sprites.ts`.
- Dwa swiadomie przyjete kompromisy jakosciowe: mozliwa widoczna obwodka GIF-a
  (1-bitowa alfa) i wieksza waga plikow (~200–224 kB zamiast ~20–60 kB WebP) —
  opisane w README jako znane ograniczenia, niezweryfikowane wizualnie na docelowym
  klipie.
- Zero nowych zaleznosci produkcyjnych ani deweloperskich.

## Odrzucone warianty

- **`Record<Outcome, string>` w rejestrze sprite'ow** — druga wartosc (`miss`) nigdy
  nie byla potrzebna; niepotrzebna elastycznosc na wypadek stanu, ktorego maszyna
  stanow nie ma.
- **Jeden element `Audio` z `currentTime = 0` przy kazdym trafieniu** — ucina
  poprzedni klaps przy dwoch trafieniach blizej siebie niz jego dlugosc; wprost
  wykluczone w wymaganiach.
- **Warunek „czy to seek" przed odtworzeniem dzwieku** — dzialalby, ale bylby drugim
  miejscem pilnujacym tej samej niezmienniczosci, ktora silnik juz gwarantuje
  strukturalnie przez rozdzial `hit`/`resync`/`sweepMisses`.
- **Konwersja GIF -> animowany WebP** — wymaga narzedzia i/lub pobierania spoza repo;
  poza ograniczeniami projektu.
