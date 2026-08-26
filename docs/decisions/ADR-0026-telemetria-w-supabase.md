# ADR-0026 — Telemetria rozgrywki w Supabase: publiczny INSERT, odczyt tylko w panelu

**Status:** przyjęte
**Data:** 2026-08-26
**Kontekst:** [ADR-0007](ADR-0007-hosting-github-pages.md) (hosting statyczny,
brak backendu), [ADR-0016](ADR-0016-tryb-deweloperski-nagrywania-sciezki.md)
(wycinanie kodu z buildu), [ADR-0024](ADR-0024-zegar-tresci-kontra-zegar-reklamy.md)
(reklama nie jest odtwarzaniem), [ADR-0025](ADR-0025-obrazkowy-ekran-wyniku-i-restart.md)
(`PLAY AGAIN` = `seekTo(0)` + `play()`)

---

## Problem

Gra jest w całości client-side i nie zostawia żadnego śladu. Nie da się
odpowiedzieć na pięć pytań, z podziałem na daty:

1. ile osób weszło na stronę,
2. ile z nich zaczęło grać,
3. ile ukończyło grę,
4. ile osób zagrało więcej niż raz,
5. ile punktów padło w każdej rozgrywce **osobno**.

Ograniczenia, które zawężają rozwiązanie:

- hosting to GitHub Pages — **statyczny, bez własnego backendu** (ADR-0007);
- produkcyjnych zależności npm ma być **zero**;
- awaria statystyk nie może w żaden sposób dotknąć rozgrywki;
- budżet: darmowy.

## Decyzja

### 1. Supabase, jedna tabela `events`, INSERT prosto z przeglądarki

Postgres + PostgREST na darmowym planie. Klient POST-uje publicznym
publishable key wprost do `/rest/v1/events`. RLS ma **wyłącznie** politykę
INSERT dla roli `anon`; nie ma SELECT, UPDATE ani DELETE. Odczyt statystyk to
pięć zapisanych snippetów SQL w panelu Supabase — klika się nazwę, widzi tabelę.
Bez eksportów CSV i bez dashboardu do zbudowania i utrzymywania.

Wysyłka gołym `fetch`-em, bez `@supabase/supabase-js`: potrzebujemy jednego
POST-a z czterema nagłówkami, a SDK dołożyłoby ~40 kB i **pierwszą produkcyjną
zależność projektu**.

Dwie rzeczy w transporcie nie są kosmetyką:

- **`fetch(…, { keepalive: true })`, nie `navigator.sendBeacon`.** Beacon nie
  pozwala ustawić nagłówków (poza `Content-Type` przez typ `Blob`), a PostgREST
  wymaga `apikey` i `Authorization`. Jedyne obejście — `?apikey=` w URL — wkłada
  klucz do logów pośredników bez żadnego zysku. `keepalive` daje nagłówki **i**
  przetrwanie odładowania dokumentu, czyli to, po co sięga się po beacon.
- **`Prefer: return=minimal`.** Jawny zapis **domyślki** PostgREST, nie
  obejście błędu: goły POST bez tego nagłówka też kończy się `201` z pustym
  ciałem. Nagłówek broni przed odpowiedzią poproszoną inaczej —
  `return=representation` wymaga SELECT-a, którego `anon` nie ma, więc zapis
  się udaje, ale odpowiedź to `401` i czerwona linia w konsoli. Tak domyślnie
  wysyła `@supabase/supabase-js`, więc nagłówek jest asekuracją na wypadek
  odejścia od gołego `fetch`.

### 2. Model zdarzeń: `visit / gate_click / play_start / finish / abandon`

`gate_click` i `play_start` są **osobno celowo**: między klikiem w bramkę
a startem gry może wejść pre-roll. Adapter melduje wtedy `playing: false`
(ADR-0024), więc `frozen` zostaje `true` i odpływ na reklamie widać jako
`gate_click` bez `play_start` — a nie jako brak zainteresowania.

`finish` jest **deduplikowany per rozgrywkę**: ekran wyniku gaśnie po seeku
w tył i zapala się ponownie, więc bez tego jedna gra dawałaby N ukończeń.
Flaga `seeked` — ustawiana z opakowanego `TransportControls.seekTo`, jedynego
źródła przewinięć w produkcji — oddziela ukończenia od dojazdu suwakiem do
końca klipu. `score`/`hits`/`misses`/`accuracy` idą jako **snapshot z chwili
zdarzenia**: wynik jest funkcją mapy wyników i po seeku w tył potrafi zmaleć.

`PLAY AGAIN` nie ma osobnego zdarzenia. `seekTo(0)` + `play()` (ADR-0025) daje
klatkę `frozen: false, showResults: false`, którą maszyna stanu widzi jako nową
rozgrywkę — nowy `play_id`, `play_no + 1`. Ten sam wzorzec, co w reszcie
projektu: stan jest **wyliczany z widoku**, a nie zgłaszany osobnym API.
Dlatego też `seekTo(0)` przy zamkniętej rozgrywce nie zapala `seeked` — to
restart, nie przewijanie.

### 3. Bramka jest runtime'owa, import statyczny

Telemetria jest aktywna wyłącznie przy `import.meta.env.PROD`, więc
`npm run dev` nie wysyła nic i nagrywanie beatmapy nie zaśmieca statystyk.

Moduł jest jednak importowany **statycznie**, w odróżnieniu od `src/dev/*`,
które jest wycinane dynamicznym importem (ADR-0016). Powód jest praktyczny:
osobny chunk to zapytanie sieciowe o ścieżce zawierającej `telemetry` —
dokładnie to, co filtry blokerów treści łapią wprost. Start gry czekałby wtedy
na żądanie, które bywa blokowane, a przegrany wyścig gubiłby `gate_click`,
a razem z nim `play_start` i cały lejek. Doklejone do głównego chunka ~0,7 kB
(gzip) nie da się zablokować bez zablokowania całej gry.

Silnik i `src/game.ts` **nie znają telemetrii**. `game.ts` dostaje jedno
opcjonalne `onFrame?(view)`, wołane po `render()` z tym samym `GameView`, który
poszedł do DOM. To ten sam wzorzec, co `TimeSource`: spoiwo nie wie, kto słucha.

### 4. Keepalive cronem w GitHub Actions

Darmowy projekt Supabase pauzuje po 7 dniach bez zapytania do API, a pauza
**cicho gubi dane** — gra działa, POST-y wracają błędem, którego nikt nie widzi.
Raz dziennie workflow POST-uje `rpc/keepalive` (`select now()`, `security
definer`, `execute` dla `anon`). Funkcja, a nie gołe `GET /rest/v1/`, bo pusty
GET obsługuje bramka API i może w ogóle nie dotknąć bazy.

## Alternatywy odrzucone

| Alternatywa | Dlaczego nie |
|---|---|
| **Google Analytics / Plausible / Umami** | Pytanie 5 („punkty w każdej rozgrywce osobno") to zapytanie relacyjne, nie licznik zdarzeń. GA wymagałby zdarzeń niestandardowych i tak nie dałby surowej listy; hostowany Plausible/Umami to koszt albo własny serwer. |
| **`@supabase/supabase-js`** | Pierwsza produkcyjna zależność projektu i ~40 kB za jednego POST-a z czterema nagłówkami. |
| **`navigator.sendBeacon`** | Nie pozwala ustawić nagłówków wymaganych przez PostgREST. Obejście `?apikey=` w URL wkłada klucz do logów pośredników bez zysku. |
| **Supabase Edge Function jako proxy z rate limitem** | Poprawnie chroniłaby publiczny endpoint, ale to osobny runtime, deploy i utrzymanie dla gry hobbystycznej. |
| **Wykrywanie seeka po skoku `view.timeSec`** | Heurystyka na progu czasu myliłaby się z zamrożeniem po reklamie (ADR-0024). Opakowanie `TransportControls.seekTo` jest dokładne: w produkcji to jedyne źródło przewinięć, bo tryb dev jest wycięty z buildu. |
| **Osobny chunk telemetrii (dynamiczny `import()`)** | Patrz punkt 3: blokowalna ścieżka i wyścig z klikiem w bramkę. Zysk (2 kB mniej w bundlu dev) nie jest tego wart. |
| **Własny licznik rozgrywek w silniku** | Silnik nie zna YouTube ani DOM i ma tak zostać. Rozgrywkę wylicza się z `GameView`, tak jak wynik wylicza się z mapy wyników. |
| **Zapis `visitor_id` w cookie** | localStorage wystarcza, nie leci w każdym żądaniu i nie wciąga tematu zgód na ciasteczka. |

## Konsekwencje

**Pozytywne**

- Pięć pytań ma pięć zapytań, jeden do jednego, z podziałem na daty lokalne.
- Zero produkcyjnych zależności npm nadal aktualne.
- Awaria Supabase, brak sieci i bloker treści są dla gry niewidoczne:
  `postEvent` nigdy nie rzuca, `createTelemetry` dodatkowo opakowuje wysyłkę
  w `try/catch`, a `frame()` robi I/O **wyłącznie na przejściach stanu**.
- Nic nowego do utrzymania w runtime: brak serwera, brak dashboardu.

**Negatywne / przyjęte świadomie**

- **Zdanie „bez analityki" z README przestaje być prawdziwe.** Build
  produkcyjny wysyła anonimowe zdarzenia; README mówi to wprost.
- **`visitor_id` to przeglądarka, nie człowiek.** Tryb prywatny, uruchomienie
  PWA z ekranu początkowego (osobny storage), drugie urządzenie i czyszczenie
  danych tworzą nowego „gracza". Odpowiedź na pytanie 4 jest **dolnym
  oszacowaniem** i tak ma być czytana.
- **Endpoint jest publiczny.** Ktokolwiek z kluczem (jest w bundlu) może
  wstawiać wiersze. Mitygacja jest proporcjonalna, nie paranoiczna: `CHECK`-i
  na kształt wiersza, grant **kolumnowy** (`anon` nie zapisze `ts` ani `id`,
  więc znacznik czasu jest zawsze serwerowy), brak SELECT oraz zapytania
  liczące `count(distinct visitor_id)` — zalanie tabeli jednym `visitor_id`
  nie zawyży żadnej z pięciu odpowiedzi. Plan awaryjny: `delete` w panelu,
  rotacja klucza, jeden deploy.
- **`abandon` nie jest gwarantowany** (twarde ubicie karty, bfcache).
  Wiarygodna jest różnica `play_start − finish`, nie sam licznik porzuceń.
- **Nowy pojedynczy punkt awarii dla statystyk** — pauza projektu po 7 dniach.
  Zabezpieczeniem jest cron w Actions, który sam GitHub wyłącza po 60 dniach
  bez aktywności w repo. Workflow ma `workflow_dispatch` i twardo fail-uje,
  żeby cisza była widoczna jako mail.
- **Realna droga do Supabase nie jest pokryta testami** — testy podstawiają
  `fetch` i `Storage`. Lista rzeczy do ręcznego sprawdzenia jest w sekcji 6
  [`docs/SUPABASE.md`](../SUPABASE.md).
