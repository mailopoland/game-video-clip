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
   iframie. **Niewystarczajaca sama w sobie** — na iOS Safari `pointer-events:
   none` na iframie nie jest niezawodne dla wbudowanego `<video>` (potwierdzone
   na urzadzeniu: dotkniecie mimo tego przebijalo sie do natywnych kontrolek
   YouTube, w tym duzej ikony pauzy na srodku ekranu). Dlatego dochodzi:
1b. **`.shield`** — warstwa `position: absolute; inset: 0` miedzy `.player`
   a `.overlay` w DOM, z `pointer-events: auto`, pelniaca **dwie** role.
   Malowana NAD playerem, ale POD `.overlay`/`.gate`/`.results` (kolejnosc
   w DOM), wiec cele, bramka startowa i ekran wyniku zostaja klikalne bez
   zmian. Zdarzenia `pointerdown`/`contextmenu` trybu dev nadal dzialaja —
   nasluchy sa na `ui.stage`, wiec bubblowanie z tarczy do gory ich nie omija.

   **Rola 1 — przechwytywanie dotyku.** Fizycznie lapie kazde dotkniecie na
   poziomie hit-testu DOM, zanim dotrze do iframe'a; nie polega na
   `pointer-events` dzialajacym poprawnie wewnatrz zagniezdzonego dokumentu.

   **Rola 2 — zaslanianie kadru poza stanem `PLAYING`.** To jest wlasciwa
   naprawa widocznosci kontrolek. Blokada wskaznika **nie ukrywa niczego
   wizualnie**: poza stanem `PLAYING` YouTube rysuje wlasny overlay (pasek
   tytulu, avatar kanalu, ikona udostepniania, miniatury powiazanych filmow,
   logo, duzy przycisk na srodku) i **zaden `playerVar` tego nie wylacza** —
   `controls: 0` usuwa wylacznie dolny pasek kontrolek, `modestbranding`
   jest martwe od sierpnia 2023, `showinfo` od 2018, a `rel: 0` od 2018 tylko
   zaweza propozycje do tego samego kanalu, zamiast je wylaczac. Dlatego
   `render()` przelacza `.shield.is-covering` dokladnie na `view.frozen`
   (czyli wszystko poza `PLAYING`: cued, buffering, pauza, ended), a klasa
   daje `background: #000; opacity: 1`.

   **Asymetria czasowa jest celowa:** zaslanianie jest natychmiastowe
   (`transition: none` na `.is-covering`) — inaczej overlay YouTube'a
   zdazylby mrugnac przy przejsciu w pauze; odslanianie jest powolne
   (`transition: opacity 800ms ease-out` na stanie bazowym), bo maskuje
   wlasna animacje zanikania YouTube'a, ktora trwa jeszcze chwile po
   wejsciu w `PLAYING`. `800ms` to jedyna wartosc do strojenia, gdyby cos
   jeszcze przebijalo.
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
- **Kadr jest czarny poza stanem `PLAYING`.** Na pauzie widac wylacznie cele
  (`.overlay` maluje sie nad tarcza) na czarnym tle, a nie zatrzymana klatke
  wideo. To swiadomy koszt: alternatywa to pokazywanie brandingu YouTube'a,
  ktorego nie da sie ukryc inaczej.
- Nietestowalne w jsdom (jak `cqw` w ADR-0014): rzeczywiste blokowanie dotyku,
  realne krycie tarczy, dobor `800ms` i `--hud-height` — jsdom nie liczy
  layoutu, nie animuje i nie renderuje prawdziwego iframe'a. Pokryte testami
  sa wylacznie obecnosc i kolejnosc `.shield` w DOM oraz przelaczanie klasy
  `is-covering` na `view.frozen` (`tests/smoke.test.ts`); reszta wymaga
  recznej weryfikacji w przegladarce.

## Odrzucone warianty

- **Tylko `controls: 0` bez blokady iframe'a** — klik w kadr nadal pauzuje
  wideo i pokazuje duzy przycisk play YouTube; `controls: 0` samo w sobie
  nie wylacza reakcji odtwarzacza na klik.
- **Tylko blokada iframe'a bez `controls: 0`** — pasek kontrolek istnieje
  i migalby przy starcie/pauzie, mimo ze nieklikalny.
- **Sama blokada wskaznika jako naprawa widocznosci kontrolek** — nie dziala
  i byla pierwsza, bledna proba. `pointer-events` steruje wylacznie
  trafialnoscia w hit-tescie, nie tym, co player rysuje. Overlay YouTube'a
  pojawial sie dalej, tyle ze nieklikalny.
- **Dostrojenie `playerVars` (`modestbranding`, `showinfo`, `rel: 0`,
  `iv_load_policy`)** — nie ma czym ukryc tego overlaya. `modestbranding`
  i `showinfo` sa oficjalnie martwe (odpowiednio 2023 i 2018), a `rel: 0`
  od 2018 nie wylacza propozycji, tylko zaweza je do tego samego kanalu.
- **Powiekszenie iframe'a i przyciecie kadru (`overflow: hidden`)** — klasyczny
  trik wypychajacy chrome poza widoczny obszar. Dziala na elementy przy
  krawedziach (pasek tytulu, logo), ale **nie na duzy przycisk na srodku**,
  ktory jest wysrodkowany razem z obrazem; zeby go wyciac, trzeba by przyciac
  takze sam kadr wideo.
