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
   a `.overlay` w DOM, z `pointer-events: auto`. Przezroczysta i BEZSTANOWA.
   Malowana NAD playerem, ale POD `.overlay`/`.gate`/`.results` (kolejnosc
   w DOM), wiec cele, bramka startowa i ekran wyniku zostaja klikalne bez
   zmian. Zdarzenia `pointerdown`/`contextmenu` trybu dev nadal dzialaja —
   nasluchy sa na `ui.stage`, wiec bubblowanie z tarczy do gory ich nie omija.

   **Rola 1 — przechwytywanie dotyku.** Fizycznie lapie kazde dotkniecie na
   poziomie hit-testu DOM, zanim dotrze do iframe'a; nie polega na
   `pointer-events` dzialajacym poprawnie wewnatrz zagniezdzonego dokumentu.

   **Rola 2 — nie ma.** Wczesniejsza wersja tej decyzji kazala tarczy
   ZASLANIAC kadr na czarno poza stanem `PLAYING` (`is-covering` ↔
   `view.frozen`), zeby ukryc overlay stanu „pauza". Usuniete: skoro duzego
   przycisku i tak nie da sie usunac (1d), czernienie kadru nie ukrywalo juz
   niczego istotnego, a kosztowalo podglad wideo na pauzie. Tarcza jest wiec
   BEZSTANOWA i przezroczysta — wylacznie blokada wskaznika.

1c. **`--player-overscan: 15%` — player wyzszy niz scena.** Zaslona z punktu (1b)
   dziala tylko poza stanem `PLAYING`; zweryfikowane w przegladarce, ze branding
   **jest widoczny takze w trakcie odtwarzania** (zrzut uzytkownika: `0:01 / 2:30`,
   przycisk „Pauza", pelny branding na ekranie). Zadne opoznienie zanikania tego
   nie rozwiaze.

   YouTube kotwiczy pasek tytulu (gora) oraz ikony udostepniania, „More videos"
   i logo (dol) do krawedzi **playera**, a wideo 16:9 wpisuje w niego z
   letterboxem. Jesli wiec `.player` jest o `--player-overscan` wyzszy u gory
   i u dolu, branding wyjezdza poza `.stage` (`overflow: hidden`), a samo wideo —
   ograniczone szerokoscia — laduje **dokladnie tam, gdzie bylo**. Kluczowa
   konsekwencja: **wspolrzedne beatmapy zostaja nietkniete**, wiec 73 nagrane
   pozycje reki nie wymagaja migracji.

   Zmierzone w przegladarce: scena 426 px → player 554 px (`+30%`), przesuniecie
   `-64 px` (`-15%`); pasek tytulu, avatar, ikony i logo znikaja ze sceny.

1d. **Duzy przycisk play/pauza ZOSTAJE widoczny — i staje sie klikalny.**
   Geometria z (1c) go nie usunie, bo jest wysrodkowany **razem z obrazem**:
   wideo jest wycentrowane w playerze, wiec srodek playera zawsze pokrywa sie
   ze srodkiem obrazu i zadne przesuniecie ani skalowanie ich nie rozdzieli.
   Stylami tez nie — iframe jest cross-origin. Kazdy CSS ukrywajacy ten obszar
   ukrywa tam rowniez **wideo**, wiec do wyboru byly tylko trzy warianty:
   widoczna ikona, zakryty fragment albo znieksztalcony fragment.

   Zakrycie (czarny krazek) i znieksztalcenie (`backdrop-filter: blur`) zostaly
   wdrozone i **odrzucone przez wlasciciela produktu** — patrz „Odrzucone
   warianty". Zostaje wariant pierwszy: ikona jest widoczna.

   Skoro jest widoczna, ma **dzialac**. Zdarzen NIE przepuszczamy jednak do
   iframe'a (np. dziura w tarczy przez `clip-path`), bo to przywrociloby
   pierwotny blad: pudlo obok dloni znowu pauzowaloby wideo, a YouTube
   pokazalby swoje chrome. Zamiast tego **wlasny przezroczysty przycisk**
   `.yt-button-proxy` dokladnie w tym miejscu, spiety z tym samym
   `TransportControls` co pasek pod scena: wyglad jest YouTube'a, dzialanie
   nasze. Lezy miedzy `.shield` a `.overlay`, wiec klik w dlon zawsze z nim
   wygrywa; jest `disabled` do `enableTransport`, tak jak reszta transportu.

   Zweryfikowane w przegladarce (`elementFromPoint`): srodek sceny trafia
   w `yt-button-proxy`, a kazdy inny punkt kadru — w `shield`, czyli nadal
   nic nie dociera do iframe'a.

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
- **`--player-overscan` potwierdzone na urzadzeniu.** Zalozenie, ze YouTube
  wpisuje wideo w player z letterboxem (`contain`), a nie kadruje go (`cover`),
  sprawdzilo sie: przy nadmiarze obraz nie jest przyblizony, a cele nadal
  pokrywaja sie z wideo — czyli wspolrzedne beatmapy pozostaly wazne.
  (Miniatura stanu `cued` faktycznie uzywa `cover` i wyglada na przyblizona,
  ale jest zakryta bramka i zaslona, wiec nie ma to znaczenia.)
  Gdyby kiedys przestalo — `--player-overscan: 0%` cofa zmiane jedna linia.
- **Duzy przycisk play/pauza YouTube'a zostaje widoczny na srodku kadru.**
  Swiadomie przyjete: kazdy sposob jego ukrycia ukrywa tam takze wideo.
  W zamian jest klikalny i robi to, czego sie po nim spodziewac — przez
  `.yt-button-proxy`, nie przez YouTube.
- **Srodek kadru (ok. `--yt-button-size`) reaguje na klik play/pauza.** Pudlo
  dokladnie w tym miejscu wstrzyma wideo zamiast policzyc sie jako chybienie.
  Cena za klikalnosc przycisku; poza tym krazkiem kadr nadal nie reaguje.
- Nietestowalne w jsdom (jak `cqw` w ADR-0014): rzeczywiste blokowanie dotyku,
  realne krycie tarczy, dobor `800ms`/`2600ms`, `--player-overscan` i
  `--hud-height` — jsdom nie liczy layoutu, nie animuje i nie renderuje
  prawdziwego iframe'a. Pokryte testami sa wylacznie obecnosc i kolejnosc
  `.shield` oraz `.chrome-mask` w DOM i przelaczanie klasy `is-covering` na
  `view.frozen` (`tests/smoke.test.ts`); reszta wymaga recznej weryfikacji.

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
- **Sama zaslona na `view.frozen`, bez geometrii** — pierwsza wersja tej
  decyzji. Niewystarczajaca: branding jest widoczny takze w stanie `PLAYING`,
  gdzie zaslona jest juz zdjeta. Stad (1c) i (1d).
- **SKALOWANIE iframe'a (zoom) z przycieciem** — wypycha branding poza kadr,
  ale powieksza i kadruje obraz, przez co wszystkie 73 nagrane pozycje reki
  przestaja pasowac do wideo. Odrzucone na rzecz (1c), ktore zwieksza player
  bez skalowania obrazu, wiec geometria beatmapy zostaje.
- **Nieprzezroczyste pasy na gorze i dole sceny** — zero ryzyka geometrycznego,
  ale kasuje ok. 28% obrazu wideo na stale. Odrzucone: (1c) osiaga to samo
  bez straty obrazu.
- **Czasowa maska srodkowego przycisku** (gasnaca po `2600ms`) — wdrozona
  i obalona na urzadzeniu: ikona pauzy jest widoczna na `0:03`. YouTube nie
  chowa przycisku sam, wiec zaden wariant czasowy nie wystarczy.
- **Nieprzezroczysta (czarna) maska srodka** — wdrozona i odrzucona przez
  wlasciciela produktu: „czarna dziura" w srodku kadru jest rownie zla jak
  sama ikona.
- **Rozmycie srodka (`backdrop-filter: blur`)** — wdrozone i rowniez
  odrzucone. Dziala technicznie (filtruje tez tresc cross-origin, bo operuje
  na zlozonym backdropie, a nie czyta pikseli), ale rozmazana plama w srodku
  kadru byla nie do przyjecia.
- **Dziura w tarczy (`clip-path`) przepuszczajaca kliki do iframe'a** —
  pozwolilaby klikac prawdziwy przycisk YouTube'a, ale otwiera droga powrotna
  dla pierwotnego bledu (pudlo w tym miejscu = chrome YouTube'a) i opiera sie
  na `polygon(evenodd)` w hit-tescie. Zastapione wlasnym przyciskiem, ktory
  daje ten sam efekt bez wpuszczania czegokolwiek do iframe'a.
- **Zaslanianie kadru na czarno poza `PLAYING`** — wdrozone i wycofane.
  Mialo ukrywac overlay stanu „pauza", ale skoro duzy przycisk i tak zostaje,
  nie ukrywalo juz niczego istotnego, a kosztowalo podglad wideo na pauzie.
