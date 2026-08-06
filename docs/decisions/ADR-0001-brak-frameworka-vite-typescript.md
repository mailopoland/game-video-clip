# ADR-0001: Brak frameworka UI — Vite + TypeScript (vanilla DOM)

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Gra to jeden ekran: iframe YouTube, warstwa obiektów, licznik punktów, ekran wyniku.
Cały stan mieści się w kilku prostych strukturach, a rendering jest sterowany
`requestAnimationFrame` — nie cyklem życia komponentów. Priorytet projektu:
poprawność, prostota, testowalność.

## Opcje

1. **React (+ Vite)** — znany model komponentowy, ale reconciliation na każdej klatce
   jest zbędnym kosztem i utrudnia deterministyczne testowanie logiki. Wymaga
   dodatkowych zależności (react, react-dom, @testing-library/react).
2. **Svelte** — mały runtime, ale kolejny kompilator i konwencje do utrzymania
   dla ekranu, który ma ~5 elementów UI.
3. **Vanilla TypeScript + Vite** — zero runtime'u frameworka, pełna kontrola nad
   pętlą klatek, logika gry jako czyste funkcje.

## Decyzja

**Vanilla TypeScript + Vite.** Logika gry (`engine`) jest czystym modułem TS bez
żadnego dostępu do DOM ani do YouTube; warstwa `render` tylko odwzorowuje stan na
elementy DOM. TypeScript, bo beatmapa i maszyna stanów obiektu zyskują na typach,
a testy jednostkowe łapią literówki w polach danych.

## Konsekwencje

- Zależności produkcyjne: **zero**. Dev: `vite`, `typescript`, `vitest`, `jsdom`.
- Brak gotowego routingu/stanu — niepotrzebne, jest jeden ekran.
- Testy logiki nie wymagają żadnego środowiska UI (patrz [ADR-0006](ADR-0006-testy-vitest-fake-clock.md)).
- Jeśli projekt urośnie o wiele ekranów, decyzja będzie wymagała rewizji (nowy ADR).
