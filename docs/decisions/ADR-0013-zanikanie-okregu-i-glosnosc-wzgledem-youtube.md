# ADR-0013 — Zanikanie okregu po rozstrzygnieciu i glosnosc wzgledem YouTube

**Status:** przyjete
**Data:** 2026-08-08

## Kontekst

Po ADR-0012 (wyrownanie okregu, sygnal `is-armed`) zglos zono dwa kolejne problemy:

1. Approach circle nie znikal po trafieniu ani po przegapieniu okna — zostawal
   widoczny przez caly `FADE_OUT_MS`, mimo istniejacej reguly CSS
   `.obj.is-hit .approach, .obj.is-miss .approach { opacity: 0; }`.
2. Klaśniecie mialo byc dwa razy glosniejsze niz obecnie i proporcjonalne do
   aktualnego poziomu glosnosci playera YouTube.

## Decyzja

### 1. Zanikanie okregu — realny blad, nie kwestia projektowa

`render.ts` ustawial `approach.style.opacity` **bezwarunkowo, co klatke**, dla
kazdego widocznego obiektu — takze rozstrzygnietego. Dla rozstrzygnietego obiektu
`visible.approach === 0`, wiec wzor `0.35 + (1 - approach) * 0.65` dawal `1`, czyli
**pelna widocznosc**. Styl inline zawsze wygrywa ze specyficznoscia reguly w
arkuszu CSS (`.obj.is-hit .approach { opacity: 0 }`), wiec ta regula nigdy realnie
nie dzialala — byla martwym kodem od czasu, gdy approach circle zaczal byc
skalowany imperatywnie (ADR-0002/0003).

Naprawa w `render.ts`: rozroznienie `resolved` **przed** ustawieniem stylu —
rozstrzygniety obiekt dostaje `approach.style.opacity = '0'` wprost, nieroz
strzygniety liczy pulsujaca przezroczystosc jak dotychczas. Regula CSS zostaje
(nieszkodliwa nadmiarowosc/dokumentacja intencji), ale to inline styl jest teraz
faktycznym mechanizmem.

### 2. Glosnosc: proporcjonalna do YouTube, x2 wzgledem `getReferenceVolume() === 1`

`HTMLAudioElement.volume` jest ograniczone specyfikacja do zakresu `[0, 1]` —
ustawienie wiekszej wartosci rzuca wyjatkiem. Podwojenie glosnosci ponad naturalny
poziom pliku wymaga wiec **Web Audio API**: `AudioContext` + `GainNode` z
`gain > 1`, podlaczony miedzy `MediaElementAudioSourceNode` (opakowujacym kazdy
element puli) a `context.destination`.

`src/ui/sound.ts`:
- `ensureAudioGraph()` buduje ten graf raz, wywolywane z `unlock()` (kontekst audio
  wymaga gestu uzytkownika, zeby wyjsc ze stanu `suspended`).
- `play()` liczy `gainNode.gain.value = getReferenceVolume() * LOUDNESS_BOOST`
  (`LOUDNESS_BOOST = 2`) tuz przed kazdym odtworzeniem — glosnosc klapsu skaluje
  sie z biezacym poziomem YouTube w momencie kliknieca, nie raz przy starcie.
- **Fallback bez Web Audio** (starsze przegladarki, srodowisko testowe): ustawia
  `el.volume = min(1, getReferenceVolume())` — proporcja do YouTube dziala, ale
  bez podwojenia ponad naturalny poziom pliku, bo `<audio>.volume` fizycznie nie
  moze przekroczyc 1.0 t inaczej.

`getReferenceVolume` to wstrzykiwana funkcja (domyslnie `() => 1`, zgodnie ze
wzorcem `now`/`make` w tym samym pliku), zeby testy nie wymagaly prawdziwego
playera. Zrodlem prawdziwej wartosci jest `PlayerHandle.getVolume()`
(`src/ui/youtube.ts`) — nowa metoda: `isMuted() ? 0 : getVolume() / 100`, czyli
ulamek 0–1, 0 przy wyciszeniu. `main.ts` przekazuje
`() => player?.getVolume() ?? 1` do `mountGame`, analogicznie do istniejacego
`onStart: () => player?.play()`.

## Konsekwencje

- `render.ts`: rozgraniczenie stylowania approach circle na galaz
  `resolved`/`!resolved`; nowe testy w `smoke.test.ts` sprawdzajace
  `approach.style.opacity === '0'` po trafieniu i po przegapieniu.
- `sound.ts`: nowy parametr `getReferenceVolume` w `createHitSound` (4. argument,
  domyslny `() => 1` — kompatybilne wstecz z istniejacymi wywolaniami w testach).
  Nowa stala `LOUDNESS_BOOST`. Graf Web Audio jest per-instancja `HitSound`,
  budowany raz.
- `youtube.ts` / `PlayerHandle`: nowa metoda `getVolume()`. `YtPlayer` zyskuje
  `getVolume()`/`isMuted()` z IFrame Player API (zawsze tam byly, po prostu
  nieuzywane).
- `game.ts`: `mountGame` przyjmuje `getReferenceVolume?: () => number` w opcjach,
  przekazywane do domyslnego `createHitSound` (pomijane, gdy podano wlasny `sound`).
- **Realne podwojenie glosnosci przez GainNode jest niezweryfikowane w prawdziwej
  przegladarce** — jsdom nie implementuje Web Audio API, wiec unit testy pokrywaja
  wylacznie sciezke `!gainNode` (fallback), gdzie sprawdzana jest tylko proporcjo
  nalnosc, nie podwojenie. Dodane do znanych ograniczen w README.

## Odrzucone warianty

- **Zwiekszenie glosnosci samego pliku `clap.mp3` (edycja audio)** — nie rozwiazuje
  drugiej czesci wymagania (proporcjonalnosc do biezacej glosnosci YouTube, ktora
  zmienia sie w runtime).
- **`el.volume = 1` na stale, ignorujac YouTube** — to bylo poprzednie zachowanie;
  nie spelnia wymogu proporcjonalnosci i przy cichym YouTube dawaloby dysonans
  (bardzo glosny klaps na tle ledwo slyszalnego wideo).
- **Osobna biblioteka do audio (np. Howler.js)** — Web Audio API jest wbudowane
  w przegladarke i wystarcza do tego zadania; nowa zaleznosc wymagalaby pytania
  per CLAUDE.md, a tu jest niepotrzebna.
