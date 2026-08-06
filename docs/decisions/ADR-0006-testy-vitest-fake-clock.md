# ADR-0006: Testy — Vitest + jsdom, logika na wstrzykiwanym zegarze

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Warunek odbioru: `npm test` musi być **jedyną** komendą potrzebną do weryfikacji
regresji i musi przechodzić w 100%. Logika czasu, seeka i punktacji nie może
zależeć od realnego YouTube (wolne, sieciowe, niedeterministyczne, a requesty
sieciowe są w tym projekcie zabronione).

## Opcje

1. **Jest** — dojrzały, ale wymaga osobnej konfiguracji transformacji TS/ESM obok Vite.
2. **Vitest** — dzieli konfigurację i resolvera z Vite, natywne ESM+TS, wbudowany
   tryb `environment: 'jsdom'`.
3. **Playwright / testy w realnej przeglądarce** — najwierniejsze, ale ciężkie,
   wolne i wymagają odtwarzania realnego wideo. Poza zakresem v1.

## Decyzja

**Vitest** (`vitest`, `jsdom`) + `@testing-library/dom` wyłącznie do testu smoke.
Testowalność wynika z [ADR-0003](ADR-0003-zrodlo-czasu-i-maszyna-stanow.md): engine
przyjmuje `TimeSource`, więc test podaje `FakeTimeSource` sterowany ręcznie.

Zakres wymagany do zielonego `npm test`:

**Jednostkowe (engine, bez DOM):**
1. obiekt spawnuje się dokładnie w `time - duration`, nie wcześniej;
2. klik w oknie `[time - hw, time + hw]` → `hit`, punkt +1;
3. klik poza oknem → nie zalicza; brak kliku po `time + hw` → `miss`;
4. `playing: false` (pauza/buffering) zamraża stan — brak spawnów i brak ocen mimo upływu czasu ściany;
5. seek do tyłu resetuje wyniki obiektów o `time >= T` (brak podwójnych punktów przy ponownym zagraniu);
6. seek do przodu oznacza pominięte obiekty jako `skipped` — zero fałszywych pudeł;
7. agregacja: punkty, trafienia, pudła, celność (`skipped` poza mianownikiem);
8. `validateBeatmap` odrzuca duplikaty `id`, złe `x`/`y`, nieznany `sprite`.

**Smoke (jsdom):** render UI dla ustawionego czasu, `click`/`touchstart` na
elemencie obiektu → widoczna informacja o trafieniu i wzrost punktów.

Test smoke używa atrapy playera (obiekt implementujący `TimeSource`) — iframe
YouTube nie jest ładowany.

## Konsekwencje

- `npm test` = `vitest run`. Jedna komenda, brak sieci, deterministyczne wyniki.
- Zależności dev: `vitest`, `jsdom`, `@testing-library/dom`.
- Nie testujemy realnej integracji z YouTube — to świadoma luka, weryfikowana
  ręcznie wg checklisty w `docs/PLAN.md`.
