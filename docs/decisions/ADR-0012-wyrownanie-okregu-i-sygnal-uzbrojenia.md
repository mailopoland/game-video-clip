# ADR-0012 — Wyrownanie approach circle do tresci sprite'a i sygnal „mozna trafic"

**Status:** przyjete
**Data:** 2026-08-08

## Kontekst

Po wdrozeniu sprite'a "dlon" (ADR-0011) zglos zono trzy problemy z jednej sesji
grania:

1. Okrag approach circle wizualnie nie otaczal dloni — otaczal pusty obszar obok
   niej.
2. Nie bylo zadnego sygnalu, kiedy klikniecie faktycznie zaliczy sie jako trafienie.
3. Klaśnięcie sprawialo wrazenie, ze w ogole sie nie odtwarza.

## Decyzja

### 1. Okrag wyrownany do faktycznej tresci grafiki, nie do plotna pliku

Zmierzone narzedziowo (`ffmpeg` filtry `alphaextract` + `bbox`) na
`public/sprites/hand-idle.gif`: kwadratowe plotno 1254×1254 px, ale tresc (dlon)
zajmuje x 360–1140, y 295–937 — srodek tresci to (750, 616), nie (627, 627) czyli
srodek plotna. Rozjazd: +9,8% szerokosci w prawo, −0,9% wysokosci w gore.

`render.ts` skaluje `.approach` co klatke przez `style.transform = scale(...)`,
nadpisujac cala wlasciwosc `transform` — nie da sie tam dopisac przesuniecia bez
kolizji. Rozwiazanie: **niezalezna wlasciwosc CSS `translate`** (`translate: 9.8%
-0.9%`), ktora komponuje sie z `transform` ustawianym przez JS, zamiast go
nadpisywac. Zero zmian w `render.ts` dla tego przesuniecia — to czysto wizualna
korekta w `styles.css`.

Wspolrzedne sa zaszyte jako liczby w CSS, nie wyliczane w runtime ani
przechowywane w rejestrze sprite'ow — dopoki jest jeden sprite (`hand`), osobne
pole w `Sprite` byloby abstrakcja bez drugiego uzycia. Jesli pojawi sie kolejny
sprite z innym rozkladem tresci, ten CSS trzeba bedzie sparametryzowac (np. custom
property na `.obj` z rejestru) — nie zrobiono tego teraz.

### 2. Klasa `is-armed` — sygnal „ten klik zaliczy sie jako trafienie"

Gracz nie mial zadnej informacji, czy klikniecie w danej chwili wypadnie w oknie
tolerancji. `render.ts` liczy to co klatke z danych juz obecnych w `GameView` —
`Math.abs(view.timeSec - object.time) <= object.hitWindowMs / 1000` dla obiektu
bez rozstrzygniecia — i przelacza klase `is-armed` na `.obj`. Silnik (`engine.ts`)
nie zmienia sie w ogole: to czysto prezentacyjna interpretacja istniejacego stanu,
taka sama zasada jak przy `outcome`.

CSS: `.obj.is-armed .approach { border-color: #6ef58f; }` — ten sam odcien zielieni
co `+1` i przycisk „Graj", zeby paleta byla spojna.

### 3. Diagnostyka dzwieku zamiast zmiany reguly „tylko trafienie"

Zglaszany brak dzwieku okazal sie najprawdopodobniej efektem (1) i (2) razem: bez
wyrownanego okregu i bez sygnalu okna tolerancji gracz nie mial jak trafic
konsekwentnie, wiec cisza przy pudle (swiadoma decyzja z ADR-0011) byla odczytywana
jako "dzwiek nie dziala". Nie zmieniono reguly „dzwiek tylko na `hit`" — potwierdzone
z uzytkownikiem.

Dodatkowo znaleziono i naprawiono realny blad w `src/ui/sound.ts::unlock()`:
`pause()` byl wywolywany synchronicznie zaraz po `play()`, bez czekania na jego
`Promise`. Na czesci przegladarek (Safari) przerywa to `play()` bledem, ktory liczy
sie jako niedokonczone odblokowanie elementu audio — objaw identyczny z opisywanym
(„klaśniecie sie nie odtwarza"), mimo ze demonstrowalny tylko w prawdziwej
przegladarce (jsdom nie implementuje `HTMLMediaElement.play()`, wiec unit testy tego
nie lapaly). Naprawa: `pause()`/`currentTime = 0`/zdjecie wyciszenia dopiero w
`.then()` po ustabilizowaniu sie `play()`. Dodano tez jawne `volume = 1` na kazdym
elemencie puli (glosno, bez przycinania) i `console.warn` przy nieudanym
odtworzeniu w `play()`, zeby przyszle problemy dalo sie zdiagnozowac w devtoolsach
zamiast zgadywac.

## Konsekwencje

- `styles.css`: `.approach` ma teraz `translate: 9.8% -0.9%` i regule dla
  `.obj.is-armed`. Wspolrzedne sa specyficzne dla `hand-idle.gif` — przy zmianie
  tego pliku trzeba je przeliczyc (procedura: `ffmpeg -i plik.gif -vf
  "alphaextract,bbox=min_val=16" -f null -`, odczytac `x1/x2/y1/y2`, przeliczyc
  wzgledem srodka plotna).
- `render.ts`: nowa, czysto pochodna klasa `is-armed`; brak nowego stanu w
  `GameView`/silniku.
- `sound.ts`: `unlock()` zmienia kolejnosc operacji (asynchronicznie po `Promise`),
  dochodzi `volume = 1` i `console.warn` w `play()`. `tests/sound.test.ts` bez
  zmian API — atrapa `HTMLAudioElement.play()` nadal zwraca rozwiazana `Promise`
  synchronicznie, wiec asercje na `playCount` pozostaja poprawne.
- Dwa nowe testy w `tests/smoke.test.ts`: `is-armed` wlacza sie tylko w oknie
  tolerancji i gasnie po rozstrzygnieciu.
- Rzeczywiste dzialanie dzwieku w przegladarce (Safari/iOS w szczegolnosci) nadal
  **niezweryfikowane recznie** — pozostaje w znanych ograniczeniach README.

## Odrzucone warianty

- **Przycinanie/rekadrowanie plikow GIF, zeby tresc byla wysrodkowana w plotnie** —
  wymagaloby narzedzia do edycji GIF-ow w repo (nie ma) i ponownej weryfikacji
  animacji klatka po klatce; przesuniecie samego okregu w CSS daje ten sam efekt
  wizualny przy zerowym ryzyku popsucia animacji.
- **Nowe pole w `Sprite` na przesuniecie okregu** (np. `ringOffset: [number,
  number]`) — uzasadnione dopiero przy drugim sprite'cie z innym rozkladem tresci;
  teraz bylaby to abstrakcja bez drugiego uzycia.
- **Zmiana reguly dzwieku na "kazdy klik"** — odrzucone przez uzytkownika w tej
  samej sesji; przyczyna zgloszonego problemu lezala gdzie indziej (patrz decyzja 3).
