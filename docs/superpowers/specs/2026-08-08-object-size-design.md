# Skalowany rozmiar obiektu w beatmapie

## Cel

Beatmapa pozwala dziś ustawić tylko pozycję (`x`, `y`) i czas celu, nie jego
rozmiar — każdy obiekt renderuje się z tym samym `width: 16%` z `styles.css`.
Dodajemy pole `size` do `BeatmapObject`, żeby każdy cel mógł mieć inny rozmiar
grafiki (i towarzyszącego mu approach circle).

## Zachowanie

- Nowe **wymagane** pole liczbowe `size` w każdym obiekcie `beatmap.json`:
  procent bazowego rozmiaru (16% szerokości warstwy gry). `size: 100` = obecny
  rozmiar, `size: 50` = połowa (8%), `size: 200` = dwa razy większy (32%).
- Walidacja (`validateBeatmap`): `size` musi być > 0. Bez górnego limitu —
  zbyt duży obiekt to świadoma decyzja autora beatmapy, nie błąd do
  zablokowania kodem.
- Approach circle (`.approach`) ma dziś `width: 100%; height: 100%` względem
  `.obj` — skaluje się automatycznie razem z obiektem, bez dodatkowej logiki.
- Rozmiar jest ustawiany inline (`element.style.width`) w `render.ts` przy
  tworzeniu elementu obiektu, analogicznie do istniejącego `left`/`top`.
  Bazowe `width: 16%` w `styles.css` zostaje jako fallback/dokumentacja
  wartości domyślnej, ale w praktyce zawsze jest nadpisywane inline.
- Ponieważ pole jest wymagane, wszystkie 27 istniejących obiektów w
  `src/data/beatmap.json` dostają `size: 100` (zachowanie bez zmian).

## Poza zakresem

- Brak animacji zmiany rozmiaru w czasie (rozmiar jest stały dla danego
  obiektu przez cały jego cykl życia).
- Brak wpływu na `hitWindowMs` / logikę trafienia w `engine.ts` — silnik nadal
  nie zna geometrii, tylko czasu.

## Pliki do zmiany

| Plik | Zmiana |
|---|---|
| `src/engine/types.ts` | `BeatmapObject.size: number` |
| `src/engine/beatmap.ts` | walidacja `size > 0` |
| `src/data/beatmap.json` | `size: 100` na każdym z 27 obiektów |
| `src/ui/render.ts` | `element.style.width` z `size` przy tworzeniu obiektu |
| `README.md` | tabela pól beatmapy + przykładowy JSON |
| `tests/beatmap.test.ts` | test walidacji `size <= 0` |
| `tests/smoke.test.ts` lub nowy test | test, że `size` wpływa na `style.width` |
