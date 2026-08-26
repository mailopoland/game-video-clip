# ADR-0020 — Ikonowy pasek transportu i automatyczny pełny ekran

**Status:** przyjete; punkt 3 (Fullscreen API na `onStart`) unieważniony przez
[ADR-0021](ADR-0021-zawsze-zmaksymalizowana-ramka-bez-fullscreen-api.md) —
zamiast żądania pełnego ekranu przy kliku „Graj”, `.frame` jest teraz zawsze
zmaksymalizowana przez CSS, bez Fullscreen API. Punkty 1–2 (ikony, jeden pasek)
bez zmian.
**Data:** 2026-08-26

## Kontekst

Pasek transportu (ADR-0019) i HUD byly dwoma osobnymi paskami pod scena:
transport z tekstowymi etykietami przyciskow ("Odtwarzaj"/"Pauza",
"Wycisz"/"Wlacz dzwiek"), HUD z licznikiem punktow, tekstowym stanem "pauza"
i osobnym przyciskiem pelnego ekranu. Wlasciciel produktu poprosil o
uproszczenie: ikony zamiast napisow, jeden pasek zamiast dwoch, usuniecie
tekstu "pauza" (widoczny juz w etykiecie play/pauza) i usuniecie przycisku
pelnego ekranu na rzecz zawsze-pelnoekranowej gry.

## Decyzja

1. **Ikony zamiast tekstu** w `src/ui/render.ts`: `transport-play` pokazuje
   `▶︎`/`❚❚`, `transport-mute` pokazuje `🕪×`/`🕪` (odpowiednik "Wycisz"/
   "Wlacz dzwiek"). Etykieta dostepnosciowa (`aria-label`) niesie dalej tekst
   PL — ikony same w sobie nie sa dostepne dla czytnikow ekranu.
2. **Jeden pasek `.transport`** zamiast `.transport` + `.hud`: `#hud-score`
   i nowy `#hud-hand` (statyczna grafika reki w wariancie `hit`, z rejestru
   `SPRITES`) trafiaja na koniec paska transportu, po przycisku wyciszenia.
   `.hud` znika z DOM; `#hud-frozen` (tekst "pauza") jest usuwany bez
   zamiennika — stan zamrozenia widac juz po ikonie play/pauza.
3. **Przycisk pelnego ekranu znika.** `Ui.enableFullscreen`/
   `setFullscreenActive` usuniete z interfejsu. Zamiast tego `main.ts` wola
   `fullscreen.toggle()` wewnatrz `onStart` — klik w bramke "Graj" jest
   jedynym gestem uzytkownika, jaki gra dostaje, wiec jest tez jedyna okazja
   do zadania pelnego ekranu. `FullscreenController.toggle()` juz wczesniej
   polykal odmowe po cichu (brak gestu, polityka przegladarki), wiec gra
   startuje nawet gdy pelny ekran sie nie uda.

## Konsekwencje

- `Ui` traci `enableFullscreen`/`setFullscreenActive`; `FullscreenController`
  bez zmian, tylko wolany z innego miejsca w `main.ts`.
- Testy tekstowych etykiet (`transport-play`/`transport-mute` `textContent`)
  zastapione sprawdzeniem `aria-label`/ikony; test przycisku pelnego ekranu
  usuniety (przycisk nie istnieje).
- `--hud-height`/`.hud` w CSS (ADR-0019) traca uzasadnienie geometryczne —
  `--stage-width` liczy sie juz tylko od wysokosci `.transport`.
- Nietestowalne w jsdom: rzeczywiste wejscie w pelny ekran po kliku w "Graj"
  (jsdom nie implementuje Fullscreen API poza atrapa w `fullscreen.test.ts`) —
  wymaga recznej weryfikacji na urzadzeniu.

## Odrzucone warianty

- **Osobny przycisk pelnego ekranu z automatycznym pierwszym wejsciem** —
  odrzucone jako niepotrzebna zlozonosc: skoro gra ma byc zawsze
  pelnoekranowa, nie ma powodu zostawiac recznej alternatywy.
