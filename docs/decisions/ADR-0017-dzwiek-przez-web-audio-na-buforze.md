# ADR-0017 — Dźwięk trafienia przez Web Audio na zdekodowanym buforze

**Status:** przyjęte
**Zastępuje częściowo:** [ADR-0011](ADR-0011-dwuwariantowy-sprite-i-dzwiek-trafienia.md)
(pula `<audio>` jako nośnik dźwięku), [ADR-0013](ADR-0013-zanikanie-okregu-i-glosnosc-wzgledem-youtube.md)
(wzmocnienie przez `MediaElementAudioSourceNode` + `GainNode`)

## Kontekst

Na iPhonie dźwięk trafienia nie był słyszalny. Zaobserwowane fakty (weryfikacja na
urządzeniu, guzikiem „Test dzwieku" w trybie dev):

- Safari, Chrome i Brave na iOS zachowują się identycznie — wszystkie to WebKit.
- Na desktopie dźwięk działa.
- Audio samego filmu YouTube na tym telefonie jest słyszalne.
- **Klaps gra, dopóki film się nie zaczął. Po starcie wideo milknie.**

Ostatni punkt jest rozstrzygający: iOS/WebKit utrzymuje sesję audio dla **jednego
elementu medialnego naraz**. `<video>` YouTube'a przejmuje ją i każdy nasz
`<audio>` przestaje być słyszalny. Nie jest to kwestia gestu użytkownika
(`unlock()` działał), przełącznika Dzwonek-Cisza (film słychać) ani ładowania pliku.

Dotychczasowe wzmocnienie z ADR-0013 nie mogło tego uratować: `createMediaElementSource`
bierze na wejściu **ten sam** `HTMLMediaElement`, więc nie omija ograniczenia.
Osobno zgłoszono, że dźwięk jest **za cichy** — `LOUDNESS_BOOST = 2` przy pułapie
`HTMLAudioElement.volume ≤ 1.0` w praktyce nie dawał żadnego wzmocnienia wszędzie
tam, gdzie graf Web Audio się nie zbudował.

## Decyzja

Ścieżką główną odtwarzania klapsa jest **Web Audio na zdekodowanym buforze**:
`fetch` → `decodeAudioData` → `AudioBuffer`, a każde trafienie tworzy nowy
`AudioBufferSourceNode` → `GainNode` → `destination`.

- `AudioBufferSourceNode` **nie jest elementem medialnym**, więc nie konkuruje
  z `<video>` YouTube'a o sesję audio na iOS.
- Węzeł źródłowy jest jednorazowy z definicji, więc **nakładanie się klapsów jest
  darmowe** — pula przestaje być potrzebna do tego, po co powstała w ADR-0011.
- `GainNode` **naprawdę** przekracza 1.0, więc wzmocnienie z ADR-0013 wreszcie
  działa — i to zmienia dobór wartości. `LOUDNESS_BOOST` zjeżdża do **`1.5`**, czyli
  **poniżej** `2` z ADR-0013: tamta liczba była dobrana wtedy, gdy wzmocnienie nigdy
  nie dochodziło do skutku, więc opisywała zamiar, a nie słyszalny efekt. Zgłoszenie
  „za cichy" wynikało z braku wzmocnienia, nie z jego wielkości — po naprawie `4`, `3`
  i `2` okazały się na urządzeniu za głośne. Wartość jest dobrana na słuch.
- `unlock()` nadal jest wołane w geście „Graj", ale z innego powodu niż w ADR-0011:
  `AudioContext` rodzi się `suspended` i tylko gest pozwala go wznowić. Tam startuje
  też pobranie i dekodowanie pliku.

**Pula `<audio>` zostaje jako droga zapasowa**, używana tylko gdy nie ma
`AudioContext` albo dekodowanie zawiodło. Nie jest to abstrakcja „na przyszłość":
bez niej `jsdom` (a więc i testy) nie miałby czego wykonywać, a starsze przeglądarki
straciłyby dźwięk całkowicie. Na tej drodze wzmocnienie nadal jest przycięte do 1.0.

## Konsekwencje

- `createHitSound(src, options)` przyjmuje **obiekt opcji** zamiast czterech
  argumentów pozycyjnych — doszły `createContext`, `fetchBuffer` i `boost`,
  a lista pozycyjna przestawała być czytelna.
- `HitSound.describe()` (dodane przy diagnostyce) raportuje `tryb=bufor|pula`,
  więc po zmianie widać wprost, którą ścieżką poszło odtwarzanie.
- Klaps jest **pobierany drugi raz** — raz przez `preload='auto'` puli zapasowej,
  raz przez `fetch` do dekodowania. Plik jest mały i idzie z cache HTTP; świadomie
  nie komplikujemy tego, dopóki nie okaże się problemem.
- Pobranie musiało zostać **wyciągnięte przed bramkę startową** (`prefetch()`
  w `mountGame`, obok `preloadSprites()`): startując dopiero w `unlock()`, potrafiło
  nie zdążyć przed pierwszym trafieniem. `AudioContext` nadal powstaje wyłącznie
  w geście — rozdzielone są więc dwie rzeczy, które wcześniej robił `unlock()`:
  pobranie bajtów (może być wcześnie) i uruchomienie kontekstu (musi być w geście).
- Założenie stojące za całą decyzją — że iOS pozwala Web Audio grać równolegle
  z odtwarzanym `<video>` — **zostało potwierdzone ręcznie na iPhonie**: po starcie
  filmu klaps jest słyszalny. Nadal nie ma na to testu automatycznego (jsdom nie ma
  Web Audio, `AudioContext` w testach jest podstawiony), więc regresja tej ścieżki
  nie wywali `npm test` — wymaga ręcznego sprawdzenia guzikiem „Test dzwieku".
