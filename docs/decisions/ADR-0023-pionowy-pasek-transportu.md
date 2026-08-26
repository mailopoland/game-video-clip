# ADR-0023 — Pionowy pasek transportu po prawej stronie sceny

**Status:** przyjęte
**Kontekst:** ADR-0019 (własne kontrolki), ADR-0020 (ikonowy transport), ADR-0021 (ramka na cały viewport)

## Problem

Pasek transportu leżał poziomo **pod** sceną i miał `3rem` wysokości. Scena trzyma
`aspect-ratio: 16/9`, a na telefonie (nawet w orientacji poziomej) jest ograniczona
**wysokością**, nie szerokością — więc każdy piksel wysokości zabrany przez pasek
zabierał również szerokość obrazu, w proporcji 16:9. Wideo było przez to zauważalnie
małe, co zgłosił właściciel produktu.

Przy okazji wyszedł drugi defekt: w regule
`@media (orientation: portrait) and (pointer: coarse)` ramka jest obrócona o 90°
(`width: 100vh; height: 100vw`), ale `--stage-width` liczyło się dalej z `100vw`
jako szerokości. Na 390×844 dawało to scenę 390 px zamiast możliwych ~690 px.

## Decyzja

1. **Pasek transportu jest pionową kolumną po prawej stronie sceny** — zawsze, także
   na desktopie (jeden układ zamiast dwóch do utrzymania). `.frame` układa dzieci
   w wiersz, `--hud-height` zastąpione przez `--hud-width: 3.5rem`.
   `--stage-width` odejmuje szerokość kolumny, a nie wysokość paska:
   `min(100vw - var(--hud-width), 100dvh * 16 / 9, 1280px)`.
   Kolumna zabiera teraz szerokość, której kadr 16:9 na telefonie i tak nie
   wykorzystywał — obraz rośnie do pełnej dostępnej wysokości.
2. **Suwak przewijania jest pionowy, dwiema drogami naraz:** `writing-mode: vertical-lr`
   (droga standardowa, Safari 17.4+, Chrome 124+) **oraz** `-webkit-appearance:
   slider-vertical` (zdeprecjonowany fallback dla starszego iOS Safari). Starsze
   WebKity ignorują pierwszą, nowe — drugą; podane razem dają pion na obu. To jest
   wprost wymaganie właściciela: „długość filmu musi być pionowa".
   Czas leci **z góry w dół** (`direction: ltr`) — góra to `0:00`. Na starej drodze
   `slider-vertical` kierunek jest odwrotny; CSS nie odwróci go bez zepsucia drogi
   nowoczesnej, więc to znane ograniczenie starego iOS Safari, nie usterka.
   Suwak jest żółty (`#f5c518`, `accent-color` + tło kciuka).
3. **Licznik czasu jest ukryty** (`display: none`). W kolumnie `3.5rem` nie ma miejsca
   na „0:12 / 2:30", a postęp pokazuje suwak. Element zostaje w DOM i `render()` nadal
   go aktualizuje — zero zmian w `src/ui/render.ts`, więc zero ryzyka dla testów.
4. **`--stage-width` zamienia jednostki w obróconej ramce:**
   `min(100vh - var(--hud-width), 100vw * 16 / 9, 1280px)`.
5. **`.dev-bar` jest pozycjonowany absolutnie** na dole ramki. Jako zwykłe dziecko
   `.frame` stałby się po zmianie trzecią kolumną. Dotyczy wyłącznie trybu dev.

## Konsekwencje

- Zmiana jest **wyłącznie w CSS** — DOM, silnik i beatmapa nietknięte. Współrzędne
  celów są w procentach warstwy gry, więc 73 nagrane pozycje ręki nie wymagają migracji.
- Nie da się tego pokryć testem: `jsdom` nie liczy layoutu ani nie stosuje `@media`.
  Weryfikacja jest wzrokowa, na desktopie i na urządzeniu.
- Cofnięcie: `flex-direction: column` na `.frame` + przywrócenie starej formuły
  `--stage-width` i poziomego `.transport`.
