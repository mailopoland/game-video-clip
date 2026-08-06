# ADR-0009: Bramka startowa („Graj") i podejście mobile-first

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Wymaganie #8: mobile-first, projekt od 375×667, touch bez opóźnienia 300 ms,
skalowanie razem z playerem 16:9, pion i poziom.

Twarde ograniczenie przeglądarek (nie YouTube): **odtwarzanie z dźwiękiem wymaga
gestu użytkownika**. Autoplay bez gestu jest dozwolony tylko dla wideo wyciszonego.
Gra rytmiczna bez dźwięku nie ma sensu, więc nie da się wystartować automatycznie.
Dodatkowo start odtwarzania ma niezerowe opóźnienie (ładowanie API, buforowanie,
ewentualna reklama), więc moment „t=0" nie jest znany z góry.

## Opcje

1. **Autoplay wyciszony, potem prośba o odciszenie** — gra startuje bez dźwięku,
   czyli bez rytmu. Odrzucone.
2. **Poleganie na tym, że użytkownik sam kliknie play w playerze** — pierwsze
   obiekty mogą wypaść w trakcie reklamy albo buforowania; brak momentu na
   pokazanie zasad.
3. **Bramka startowa** — pełnoekranowy przycisk „Graj" nad sceną; kliknięcie to
   gest użytkownika, który wywołuje `playVideo()`; gra rusza dopiero po wejściu
   playera w stan `PLAYING`.

## Decyzja

**Bramka startowa (opcja 3).** Ekran startowy zasłania scenę do pierwszego
kliknięcia/tapnięcia. Dopiero `onStateChange === PLAYING` odsłania warstwę gry
i uruchamia pętlę.

Zasady mobile-first w implementacji:
- Scena: kontener `width: 100%; max-width: 100vw; aspect-ratio: 16 / 9`; iframe i
  warstwa gry wypełniają go w 100%. Cała geometria obiektów w `%` → skalowanie
  jest darmowe i identyczne dla 375 px i 1440 px.
- Rozmiary obiektów i okręgów w jednostkach względnych sceny (`cqw` / `%`), nie w px.
- Wejście: **`pointerdown`** (jedno zdarzenie dla myszy, dotyku i pióra) +
  `touch-action: manipulation` na scenie → brak 300 ms opóźnienia i brak
  double-tap-zoom. Nie nasłuchujemy `click` (odpaliłby się drugi raz po dotyku).
- `<meta name="viewport" content="width=device-width, initial-scale=1,
  viewport-fit=cover">`.
- Orientacja: layout kolumnowy (scena + HUD pod nią). W poziomie na niskich
  ekranach scena jest ograniczana przez `max-height` z zachowaniem `aspect-ratio`,
  więc nigdy nie wyjeżdża poza ekran.

## Konsekwencje

- Gra zawsze zaczyna się od jawnego gestu → dźwięk działa na iOS i Android.
- Reklama przed filmem (jeśli wystąpi) mieści się między kliknięciem a `PLAYING`;
  obiekty nie spawnują się w jej trakcie, bo pętla startuje dopiero po `PLAYING`.
  `[do weryfikacji: czy stan PLAYING jest raportowany również w trakcie reklamy —
  wymaga testu na realnym, zmonetyzowanym wideo]`
- Ekran startowy to jedyny dodatkowy widok; nie dodaje samouczka ani ustawień.
