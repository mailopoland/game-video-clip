# ADR-0010 — Pelny ekran obejmuje ramke gry, nie odtwarzacz

**Status:** przyjete
**Data:** 2026-08-06

## Kontekst

Warstwa gry (`.overlay`, bramka, ekran wyniku) i HUD sa rodzenstwem elementu
`<iframe>` w dokumencie nadrzednym. Przycisk pelnego ekranu w kontrolkach YouTube
wywoluje `requestFullscreen()` **wewnatrz iframe'a**, przez co przegladarka
promuje do *top layer* sam element `<iframe>` w naszym dokumencie.

Top layer renderuje sie ponad wszystkimi kontekstami ukladania — `z-index` nie
ma tam zadnego znaczenia. Skutki obserwowane w praktyce:

1. Cele, bramka, ekran wyniku i HUD znikaja pod wideo wypelniajacym viewport.
2. Nic z warstwy gry nie da sie kliknac — zdarzenia trafiaja w iframe.
3. Odtwarzacz zostaje w stanie `PLAYING`, wiec `Engine.tick()` dalej pracuje:
   cele spawnuja sie za wideo, a `sweepMisses()` zamienia kazdy z nich w pudlo.
   Wyjscie z pelnego ekranu nie jest przewinieciem, wiec `resync()` tego nie
   naprawia — wynik jest cicho zniszczony.

Zadna zmiana CSS po naszej stronie tego nie cofa. Nie mozemy tez przechwycic
kliku w kontrolkach — iframe jest cross-origin.

## Decyzja

Pelny ekran obsluguje aplikacja, nie odtwarzacz.

1. **`fs: 0` w `playerVars`** — YouTube nie pokazuje wlasnego przycisku pelnego
   ekranu, wiec sciezka rozszerzajaca sam iframe nie jest oferowana.
2. **Nowy wrapper `.frame`** zawiera scene *i* HUD. To on jest celem
   `requestFullscreen()`, wiec odtwarzacz, warstwa gry i licznik trafiaja do top
   layer razem. Geometria celow jest w procentach, wiec skala jest darmowa.
3. **Wlasny przycisk w HUD** (`click`, nie `pointerdown` — najpewniejsze zrodlo
   gestu uzytkownika dla Fullscreen API).
3b. **Tryb zastepczy `css` na iPhonie.** `Element.requestFullscreen` nie istnieje
   tam w zadnej przegladarce (wszystkie na WebKicie) — sprawdzone na urzadzeniu.
   Zamiast chowac przycisk, ramka dostaje `position: fixed; inset: 0` i zabiera
   caly viewport; paski przegladarki zostaja. Prawdziwy pelny ekran na iOS daje
   dopiero uruchomienie z ekranu poczatkowego, stad `public/manifest.webmanifest`
   (`display: fullscreen`) i `apple-mobile-web-app-capable` w `index.html`.
4. **Straznik przejecia** (`src/ui/fullscreen.ts`): nasluch `fullscreenchange`;
   jesli element pelnoekranowy znajdzie sie *wewnatrz* `.player` (klawisz `f`,
   dwuklik w wideo), wychodzimy i zadamy pelnego ekranu dla `.frame`.
5. **Degradacja, gdy odzyskanie sie nie uda** — `onLost` pauzuje wideo. Silnik
   zamarza poza stanem `PLAYING`, wiec zamiast naliczac pudla w ciemno gra po
   prostu czeka. Zadnej nowej sciezki w silniku to nie wymaga.

## Konsekwencje

- Struktura DOM zyskuje jeden poziom (`.frame` > `.stage` + `.hud`). Szerokosc
  sceny i HUD-u pochodzi teraz ze wspolnej zmiennej `--stage-width`.
- `PlayerHandle` zyskuje `pause()`.
- Kontroler przyjmuje `doc` przez opcje, wiec testuje sie na atrapie Fullscreen
  API w jsdom (jsdom nie implementuje go wcale) — `tests/fullscreen.test.ts`.
- Uzytkownik traci natywny przycisk YouTube. To swiadomy koszt: jego dzialanie
  bylo dla tej aplikacji zawsze bledne.
- W pelnym ekranie `100dvh` odnosi sie do ekranu, wiec `--stage-width` sam
  dobiera rozmiar sceny bez osobnych regul.

## Odrzucone warianty

- **`z-index` / `position: fixed` na warstwie gry** — top layer jest ponad
  wszystkim, to fizycznie nie dziala.
- **Przeniesienie warstwy gry do iframe'a** — cross-origin, niemozliwe.
- **Pauza wideo na czas pelnego ekranu YouTube** — poprawne, ale zamienia
  najbardziej naturalny gest uzytkownika w koniec zabawy.
