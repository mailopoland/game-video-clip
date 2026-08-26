# ADR-0022 — Wykrywanie reklam po długości wideo i zamrażanie gry

**Status:** przyjęty

## Kontekst

Przed właściwym filmem (a czasem w jego trakcie) YouTube potrafi puścić reklamę.
Dla IFrame Player API reklama jest nieodróżnialna od filmu:

- `getPlayerState()` zwraca `1` (`PLAYING`),
- `getCurrentTime()` liczy **czas reklamy** (od zera),
- `getDuration()` zwraca **długość reklamy**.

Silnik dostaje więc „gramy, t = 0…30" i robi dokładnie to, co ma robić: spawnuje
ręce z beatmapy nad reklamą. Część celów wpada w pudło, zanim film w ogóle ruszy.

Gorzej przy mid-rollu: freeze w `Engine.tick` woła `adopt(sample.timeSec)`, a to
przy rozjeździe > `SEEK_THRESHOLD_SEC` odpala `resync()`. Czas reklamy (≈ 0)
wyglądałby jak przewinięcie na początek filmu i **skasowałby dotychczasowe wyniki**.

**Nie ma API reklam.** `onAdStart`/`getAdState` nie istnieją w IFrame API, klasa
`.ad-showing` żyje w cross-origin iframe, `modestbranding`/`showinfo` są martwe,
a `youtube-nocookie` reklam nie wyłącza. Zostają heurystyki na tym, co API zwraca.

## Rozważone opcje

1. **Porównanie `getDuration()` z długością filmu zapisaną w beatmapie.**
   Sygnał binarny i natychmiastowy, jednakowy dla pre-rolla i mid-rolla.
   Koszt: jedno pole danych do uzupełnienia.
2. **Heurystyka zegara treści** — reklama rozpoznawana po skoku czasu w tył do ≈ 0.
   Bez zmian w danych, ale nieodróżnialna od zwykłego przewinięcia i ślepa na
   mid-roll blisko początku filmu.
3. **`getVideoData().video_id` / `getVideoUrl()`** — nieudokumentowane, zmienne
   między wersjami playera. Co najwyżej sygnał pomocniczy.

## Decyzja

**Opcja 1.** Beatmapa dostaje opcjonalne `videoDurationSec`. Adapter
(`src/ui/youtube.ts` — jedyne miejsce w projekcie znające YouTube) uznaje, że trwa
reklama, gdy `getDuration()` różni się od tej wartości o więcej niż
`AD_DURATION_TOLERANCE_SEC = 1`. `getDuration() === 0` (brak metadanych) **nie**
jest reklamą, a brak pola w beatmapie wyłącza detekcję i wypisuje `console.warn`
z aktualną długością odczytaną z playera — żeby dało się ją wpisać bez zgadywania.

W trakcie reklamy `sample()` zwraca:

- `playing: false` — czyli ten sam **freeze**, który obsługuje już pauzę i buffering:
  czas gry stoi, nic nie spawnuje, nic nie jest oceniane, kliknięcia są ignorowane.
  **Silnik nie wymaga żadnej zmiany** i nie dowiaduje się o istnieniu reklam.
- `timeSec: <ostatni czas treści>` — nigdy czas reklamy. To jest ta część, która
  chroni wyniki przed `resync()` opisanym wyżej.

`getDuration()` w `PlayerHandle` zwraca długość z beatmapy, gdy ta jest znana —
inaczej suwak transportu skakałby na długość reklamy i wracał.

## Konsekwencje

- Reklama = zamrożona gra i czysty kadr; ręce pojawiają się dopiero, gdy leci film.
- **`videoDurationSec` trzeba uzupełnić dla każdego nowego `videoId`.** Zła wartość
  = gra zamrożona przez cały film; poprawną podpowiada `console.warn` przy starcie.
- Film o długości reklamy z dokładnością do sekundy byłby nierozpoznawalny —
  w praktyce nie występuje.
- Bramka startowa i pasek transportu działają bez zmian; użytkownik może pauzować
  i przewijać reklamę tak jak wcześniej (na tyle, na ile pozwala YouTube).
