# ADR-0004: Beatmapa jako osobny plik danych JSON

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Wymaganie #2 i #3: timeline **musi być danymi, nie kodem**. Beatmapa będzie
edytowana ręcznie i wielokrotnie strojona pod konkretny klip.

## Opcje

1. **Tablica w pliku `.ts`** — typowana bez wysiłku, ale jest kodem: kusi, żeby
   wstawić tam wyrażenia i logikę.
2. **JSON importowany przez Vite** — czyste dane, walidowalne, edytowalne przez
   osobę nietechniczną, a typ nakładamy przy imporcie.
3. **Fetch JSON w runtime** — dodaje stan ładowania i tryb błędu bez zysku dla v1.

## Decyzja

**`src/data/beatmap.json`**, importowany statycznie (`import beatmap from
'./data/beatmap.json'`) i rzutowany na typ `Beatmap` z `src/engine/types.ts`.

```jsonc
{
  "videoId": "Iz-nC59AIWc",
  "endScreenAtSec": 0,          // 0 => ekran wyniku dopiero na ENDED
  "objects": [
    {
      "id": "o1",              // unikalny, stabilny — klucz wyników przy seeku
      "time": 12.400,          // sekundy, moment trafienia
      "duration": 1200,        // ms fazy approach (kiedy obiekt się pojawia)
      "x": 30,                 // % szerokości kontenera, środek obiektu
      "y": 45,                 // % wysokości kontenera, środek obiektu
      "sprite": "circle",      // klucz w rejestrze sprite'ów, patrz ADR-0005
      "hitWindowMs": 250       // +/- wokół `time`
    }
  ]
}
```

Walidacja przy starcie (czysta funkcja `validateBeatmap`, testowana):
`id` unikalne, `time` rosnące, `x`/`y` w [0,100], `duration` > 0,
`hitWindowMs` > 0, `sprite` istnieje w rejestrze. Błąd → czytelny komunikat na
stronie zamiast cichego zignorowania obiektu.

## Konsekwencje

- Zmiana timeline'u = zmiana jednego pliku danych, bez dotykania logiki.
- Import statyczny → beatmapa trafia do bundla; brak requestu i stanu ładowania.
- JSON nie ma komentarzy — opis pól żyje w tym ADR-ze i w `types.ts`.
- Podmiana sprite'ów na prawdziwe GIF-y = zmiana pola `sprite` + rejestru
  (patrz [ADR-0005](ADR-0005-format-assetow-i-placeholdery.md)).
