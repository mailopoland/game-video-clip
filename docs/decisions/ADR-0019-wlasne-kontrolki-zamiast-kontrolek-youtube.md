# ADR-0019 — Wlasne kontrolki zamiast kontrolek YouTube

**Status:** przyjete
**Data:** 2026-08-25

## Kontekst

Tap/klik w puste miejsce sceny (obok dloni) wywolywal kontrolki odtwarzacza
YouTube — pasek postepu, play/pauza, pelny ekran — a na dotyku dodatkowo
pauzowal wideo. Psulo to rozgrywke: gracz celuje w dlon, chybia o kilka
pikseli i zamiast pudla dostaje zatrzymane wideo z paskiem YouTube na pol
ekranu.

Dwie niezalezne przyczyny:

1. `.overlay` mial `pointer-events: none`, wiec zdarzenia wskaznika
   przechodzily przez warstwe gry wprost do dokumentu YouTube'a.
2. `playerVars` nie ustawialo `controls: 0`, wiec pasek istnial i czekal na
   jakiekolwiek zdarzenie.

Sama (1) bez (2) jest krucha (pasek mignie przy starcie/pauzie); sama (2) bez
(1) nie wystarcza — przy `controls: 0` klik w kadr nadal pauzuje wideo i
pokazuje duzy przycisk play.

## Decyzja

Odtwarzacz przestaje reagowac na wskaznik i nie renderuje wlasnych
kontrolek; cale sterowanie (play/pauza, przewijanie, czas, wyciszenie)
trafia do wlasnego paska **pod scena**, wewnatrz `.frame`, wiec dziala tez
w pelnym ekranie (ADR-0010):

1. **`.player iframe { pointer-events: none; }`** — blokada wskaznika na
   iframie, bez nowego wezla DOM.
2. **`controls: 0` i `disablekb: 1`** w `playerVars` (`src/ui/youtube.ts`) —
   YouTube nie renderuje wlasnych kontrolek ani nie reaguje na klawiature.
3. **`.transport`** — nowy pasek w `src/ui/render.ts`: play/pauza, suwak
   przewijania, wyswietlacz czasu, wyciszenie. Sterowanie wchodzi przez
   `Ui.enableTransport(controls: TransportControls)`, wolane w `main.ts` po
   `await createPlayer(...)`, tak samo jak `enableFullscreen`.
4. **`--hud-height`** (`3.5rem` HUD + `3rem` transport = `6.5rem`) zastepuje
   zaszyte `3.5rem` w `--stage-width`, zeby w pelnym ekranie scena i oba
   paski zmiescily sie w viewport.
5. **Wyciszenie jest jednokierunkowe do 100%:** `setMuted(false)` woła
   `unMute()` **i** `setVolume(100)` — nie przywraca poprzedniej glosnosci,
   bo IFrame API jej nie ujawnia.

Pas `8%` u dolu `.overlay` (ADR-0014) **zostaje bez zmian** — traci
uzasadnienie (kontrolki YT znikaja), ale jego usuniecie przesunieloby
wszystkie nagrane `y` o ~8%. Osobny krok w przyszlosci, jesli w ogole.

## Konsekwencje

- **Uniewaznia mitygacje z ADR-0008.** Dostepnosc kontrolek playera byla
  tam jawnym argumentem lagodzacym ryzyko niezgodnosci z YouTube API
  Services — Developer Policies. Ta mitygacja znika; ryzyko rosnie i
  zostaje swiadomie przyjete.
- `PlayerHandle` (`src/ui/youtube.ts`) zyskuje `getDuration()`, `seekTo(sec)`
  (absolutny, obok istniejacego `seekBy(delta)` dla trybu dev), `isMuted()`,
  `setMuted(muted)`.
- `.overlay.dev-active { pointer-events: auto }` (ADR-0016) staje sie
  prawdopodobnie zbedny, skoro iframe juz nie przechwytuje wskaznika —
  zostaje bez zmian do czasu recznej weryfikacji i ewentualnego usuniecia
  osobnym krokiem.
- Nietestowalne w jsdom (jak `cqw` w ADR-0014): `pointer-events: none` na
  iframie i `--hud-height` — jsdom nie liczy layoutu. Wymagaja recznej
  weryfikacji w przegladarce.

## Odrzucone warianty

- **Tylko `controls: 0` bez blokady iframe'a** — klik w kadr nadal pauzuje
  wideo i pokazuje duzy przycisk play YouTube; `controls: 0` samo w sobie
  nie wylacza reakcji odtwarzacza na klik.
- **Tylko blokada iframe'a bez `controls: 0`** — pasek kontrolek istnieje
  i migalby przy starcie/pauzie, mimo ze nieklikalny.
