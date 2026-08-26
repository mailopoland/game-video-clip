# ADR-0021 — Ramka zawsze zmaksymalizowana na viewport bez Fullscreen API

**Status:** przyjete
**Data:** 2026-08-26

## Kontekst

ADR-0010/ADR-0020 realizowaly "pelny ekran" przez `Element.requestFullscreen`
(tryb `native`) z awaryjnym trybem `css` na iPhonie, wywolywane albo osobnym
przyciskiem, albo automatycznie przy kliku w "Graj" (ADR-0020). Wlasciciel
produktu doprecyzowal wymaganie: **nie chodzi o prawdziwy tryb pelnoekranowy
przegladarki** — chodzi o to, zeby wideo zajmowalo maksimum ekranu, **zanim
ktokolwiek cokolwiek kliknie**, bez zaleznosci od Fullscreen API (ktore i tak
nie istnieje na iPhonie, wymaga gestu uzytkownika i bywa niestabilne — pasek
adresu w Chrome/Androidzie potrafi wrocic po pewnym czasie mimo aktywnego
trybu pelnoekranowego).

Dodatkowo: na telefonie trzymanym pionowo gra ma wygladac tak, jakby telefon
byl obrocony do pozycji poziomej — zeby nie czekac, az gracz fizycznie obroci
urzadzenie.

## Decyzja

1. **`.frame` jest na stale `position: fixed; inset: 0`** w `src/styles.css` —
   zajmuje caly viewport od pierwszej klatki strony, bez klasy przelaczanej
   przez JS i bez gestu uzytkownika. `html, body { overflow: hidden }` na
   stale, bo strona nigdy nie pokazuje nic poza `.frame`.
2. **Usuniete `src/ui/fullscreen.ts` i `tests/fullscreen.test.ts`** —
   `Element.requestFullscreen`/`exitFullscreen`, straznik przejecia
   pelnego ekranu przez iframe i tryb `css`/`native` staly sie martwym kodem:
   `fs: 0` + `controls: 0` + `disablekb: 1` (ADR-0019) juz i tak blokuja YouTube'owi
   kazdy sposob wejscia w natywny pelny ekran, wiec nie ma czego "odzyskiwac".
   `main.ts` traci wywolanie `createFullscreenController`/`toggle()` w `onStart`.
3. **Wymuszony obrot w portrecie na urzadzeniach dotykowych:**
   `@media (orientation: portrait) and (pointer: coarse)` obraca `.frame`
   o 90&deg; (`transform: rotate(90deg)`, `width: 100vh; height: 100vw`,
   zakotwiczone w `top: 0; left: 100%`). Telefon trzymany pionowo dostaje
   uklad poziomy natychmiast, bez czekania na fizyczny obrot. `pointer: coarse`
   ogranicza efekt do ekranow dotykowych — zwezone okno przegladarki na
   desktopie nie jest obracane.

## Konsekwencje

- **Unieważnia punkt 3 ADR-0020** (automatyczne `fullscreen.toggle()` na
  `onStart`) — zastąpione stałym CSS, bez zależności od gestu użytkownika.
- **Unieważnia ADR-0010** w całości — nie ma już Fullscreen API ani trybu
  zastępczego `css`/`native`; `.frame` zawsze zachowuje się jak dawny tryb
  `css`, tylko bez przełącznika.
- `--stage-width` liczy się teraz zawsze z `100dvh` (a w portrecie na dotyku —
  po obrocie — z `100vw` potraktowanego jako wysokość), tak jak dawny tryb
  `css`.
- **Nietestowalne w jsdom** (jak reszta geometrii ADR-0014/ADR-0019): sam
  obrót, `pointer: coarse`, realne zachowanie paska adresu przeglądarki
  mobilnej. Wymaga ręcznej weryfikacji na urządzeniu.
- PWA/manifest (`display: fullscreen`, „Dodaj do ekranu początkowego” na
  iPhonie) nie jest już potrzebne do uzyskania efektu pełnego ekranu — CSS
  daje go od razu, bez instalacji. Manifest zostaje bez zmian (nieszkodliwy),
  ale przestaje być jedyną drogą do pełnoekranowego wrażenia na iOS.

## Odrzucone warianty

- **Zachowanie Fullscreen API z automatycznym wejściem na `onStart`
  (ADR-0020, punkt 3)** — odrzucone: wymaga gestu, więc ramka nie jest
  zmaksymalizowana *zanim* ktoś kliknie „Graj”, co było wprost wymagane.
- **`visualViewport`/JS do ręcznego przeliczania rozmiaru** — niepotrzebne;
  `100dvh`/`100vw` z `position: fixed` wystarczają i nie wymagają nasłuchu na
  zmiany rozmiaru.
