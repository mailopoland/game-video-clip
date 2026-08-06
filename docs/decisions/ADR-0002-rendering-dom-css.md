# ADR-0002: Rendering w DOM + CSS zamiast canvas

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Na ekranie jest jednocześnie kilka obiektów (realnie 1–3), każdy z animowanym
sprite'em z przezroczystym tłem i kurczącym się okręgiem. Obiekty muszą być
klikalne/tapalne i pozycjonowane procentowo względem playera 16:9.

## Opcje

1. **Canvas 2D** — pełna kontrola nad klatką, ale: animowanego GIF-a nie da się
   narysować w canvasie „sam z siebie" (trzeba go rozbić na sprite sheet lub
   użyć `<img>` i rysować bieżącą klatkę, czego API nie udostępnia), hit-testing
   trzeba pisać ręcznie, a dostępność i testy smoke stają się trudne.
2. **SVG** — dobre dla kształtów, ale animowane rastry i tak lądują w `<image>`.
3. **DOM + CSS** — `<img>`/element z `background-image` renderuje GIF/WebP/APNG
   natywnie, `border-radius` + `transform: scale()` daje approach circle,
   a hit-testing to zwykły listener na elemencie.

## Decyzja

**DOM + CSS.** Każdy aktywny obiekt beatmapy to jeden element `<button>`
pozycjonowany `left: x%`, `top: y%` w kontenerze o `aspect-ratio: 16/9`.
Approach circle to element potomny animowany przez `transform: scale(s)`
ustawiany co klatkę w `requestAnimationFrame` (nie przez CSS `@keyframes` — bo
animacja musi zamarzać razem z wideo, patrz [ADR-0003](ADR-0003-zrodlo-czasu-i-maszyna-stanow.md)).

## Konsekwencje

- Hit-testing za darmo, w tym `touchstart` bez opóźnienia 300 ms.
- Test smoke może wyrenderować UI w jsdom i wywołać klik na realnym elemencie.
- Skalowanie zależy wyłącznie od CSS (`%` + `aspect-ratio`), więc 375 px i 1440 px
  działają tym samym kodem.
- Przy setkach jednoczesnych obiektów DOM byłby wolniejszy niż canvas — dla tej
  gry to nierealny scenariusz.
- `transform` ustawiany imperatywnie co klatkę: kompozytowany na GPU, brak reflow.
