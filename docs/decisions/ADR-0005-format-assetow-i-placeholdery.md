# ADR-0005: Format assetów i placeholdery proceduralne

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Obiekty mają być animowanymi GIF-ami z przezroczystym tłem. Na dziś assetów nie
ma, a pobieranie czegokolwiek z internetu jest zabronione. Jednocześnie podmiana
placeholderów na docelowe assety ma być zmianą tylko w danych.

## Porównanie formatów

| Format | Przezroczystość | Waga (typowy sprite 256×256, ~20 klatek) | Wsparcie |
|---|---|---|---|
| **GIF** | binarna (1 bit) — brzegi „schodkują się", widoczna obwódka na ciemnym tle | referencja, 100% | uniwersalne |
| **APNG** | pełna alfa (8 bit) | zwykle większy niż GIF przy pełnym kolorze | wszystkie nowoczesne przeglądarki |
| **animowany WebP** | pełna alfa (8 bit) | zwykle **wyraźnie mniejszy niż GIF** przy lepszej jakości | wszystkie nowoczesne przeglądarki |
| **sprite sheet + CSS `steps()`** | zależy od formatu klatki (PNG/WebP) | najmniejszy narzut, 1 request | uniwersalne, ale wymaga metadanych (klatki, fps) |

Konkretne stopnie kompresji zależą od materiału `[do weryfikacji na realnych assetach]`,
ale kierunek (animowany WebP < GIF przy równej jakości, i lepsza alfa) jest pewny.

## Decyzja

1. **Docelowo: animowany WebP** — pełna alfa (kluczowe, bo obiekty leżą na wideo,
   gdzie obwódka GIF-a byłaby natychmiast widoczna) i mniejsza waga na mobile.
   GIF pozostaje wspierany „za darmo", bo renderujemy przez `<img>`/CSS
   (patrz [ADR-0002](ADR-0002-rendering-dom-css.md)) — format jest dla kodu przezroczysty.
2. **W v1: placeholdery proceduralne** — czysty CSS/inline SVG, zero plików
   binarnych, zero pobierania.
3. **Jeden interfejs podmiany** — rejestr sprite'ów `src/sprites.ts`:

```ts
export type Sprite = { kind: 'css'; className: string }
                   | { kind: 'image'; src: string };

export const SPRITES: Record<string, Sprite> = {
  circle: { kind: 'css', className: 'sprite-circle' },
  star:   { kind: 'css', className: 'sprite-star'   },
};
```

Podmiana na prawdziwy asset = dodanie jednej linii do `SPRITES`
(`{ kind: 'image', src: '/sprites/foo.webp' }`) i zmiana pola `sprite` w
`beatmap.json`. Renderer nie zmienia się wcale.

## Konsekwencje

- v1 działa całkowicie offline, bez assetów binarnych w repo.
- Rejestr jest jedynym miejscem, które zna ścieżki — walidacja beatmapy sprawdza,
  czy `sprite` istnieje w rejestrze (patrz [ADR-0004](ADR-0004-beatmapa-jako-dane-json.md)).
- Sprite sheet nie jest wspierany w v1; gdyby był potrzebny, wymaga nowego wariantu
  `kind` i nowego ADR-a.
