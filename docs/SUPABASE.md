# Telemetria w Supabase — konfiguracja i zapytania

Ten plik jest **źródłem prawdy dla tego, co jest wklejone w panelu Supabase**.
Panel nie jest wersjonowany, repozytorium jest — każda zmiana schematu, polityki
albo zapytania idzie najpierw tutaj.

Decyzja i uzasadnienie: [ADR-0026](decisions/ADR-0026-telemetria-w-supabase.md).
Opis zdarzeń od strony klienta: sekcja **Telemetria** w [`../README.md`](../README.md).

- **Project URL:** `https://dtbtvmsxhhsjieodqjos.supabase.co`
- **Publishable (anon) key:** `sb_publishable_IU4Jd6eKYKZGYGHw5Xb3MA_5fG-8rWI`

Oba są **publiczne z założenia** — ten sam klucz siedzi w bundlu gry i w każdym
żądaniu z przeglądarki. Klucz `service_role` nie jest tu potrzebny i **nigdy nie
może trafić do repozytorium ani do frontu**.

---

## 1. Jednorazowa konfiguracja

W panelu Supabase → **SQL Editor** → nowy snippet → wklej i uruchom sekcje
2, 3 i 4 (w tej kolejności). Potem zapisz pięć snippetów z sekcji 5 pod
nazwami z nagłówków — klikasz nazwę, widzisz tabelę.

---

## 2. Schemat tabeli

```sql
create table public.events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  visitor_id text        not null,
  play_id    text,
  play_no    int,
  event      text        not null,
  score      int,
  hits       int,
  misses     int,
  accuracy   numeric(5,2),
  seeked     boolean,

  -- Endpoint jest publiczny. Te CHECK-i nie zatrzymają zdeterminowanego
  -- napastnika, ale zatrzymają przypadkowe i leniwe smieci — i gwarantuja,
  -- ze zapytania z sekcji 5 nigdy nie zobacza wartosci, ktorych nie umieja
  -- policzyc.
  constraint events_event_ck    check (event in ('visit','gate_click','play_start','finish','abandon')),
  constraint events_visitor_ck  check (visitor_id ~ '^[0-9a-fA-F-]{8,64}$'),
  constraint events_play_ck     check (play_id is null or play_id ~ '^[0-9a-fA-F-]{8,64}$'),
  constraint events_play_no_ck  check (play_no  is null or play_no  between 1 and 100000),
  constraint events_score_ck    check (score    is null or score    between 0 and 100000),
  constraint events_hits_ck     check (hits     is null or hits     between 0 and 100000),
  constraint events_misses_ck   check (misses   is null or misses   between 0 and 100000),
  constraint events_accuracy_ck check (accuracy is null or accuracy between 0 and 100)
);

create index events_ts_idx       on public.events (ts);
create index events_event_ts_idx on public.events (event, ts);
create index events_visitor_idx  on public.events (visitor_id);
```

**Dlaczego `generated always as identity`, a nie `bigserial`.** Przy `bigserial`
rola `anon` musi dodatkowo dostać `grant usage on sequence events_id_seq`,
inaczej **każdy** INSERT kończy się `permission denied for sequence`. Kolumna
tożsamościowa nie wymaga osobnego grantu — o jedno uprawnienie i jedną pułapkę
mniej.

---

## 3. RLS i uprawnienia

To jest cała mitygacja publicznego endpointu.

```sql
alter table public.events enable row level security;

revoke all on public.events from anon, authenticated;

-- GRANT KOLUMNOWY: anon fizycznie nie moze zapisac `ts` ani `id`.
-- Znacznik czasu jest zawsze serwerowy, wiec nikt nie wstrzyknie wierszy
-- „z zeszlego tygodnia" i nie popsuje podzialu na daty.
grant insert (visitor_id, play_id, play_no, event, score, hits, misses, accuracy, seeked)
  on public.events to anon;

create policy events_anon_insert on public.events
  for insert to anon with check (true);

-- Swiadomie NIE MA polityki SELECT / UPDATE / DELETE — anon nie odczyta ani nie
-- zmieni niczego. SQL Editor w panelu laczy sie rola wlasciciela, ktora RLS
-- omija, wiec zapytania z sekcji 5 dzialaja bez zadnego dodatkowego grantu.
```

Warstwy obrony, od najtańszej:

1. `CHECK`-i + grant kolumnowy — kształt i czas wiersza są nienaruszalne.
2. Brak `SELECT` — nikt nie odczyta cudzych wyników i nie zrobi z tego API.
3. Zapytania z sekcji 5 liczą **`count(distinct visitor_id)`**, więc zalanie
   tabeli tysiącem wierszy z jednym `visitor_id` nie zawyży żadnej z pięciu
   odpowiedzi.
4. Plan awaryjny przy realnym spamie: `delete from public.events where ts > …`
   w panelu, rotacja publishable key (Project Settings → API) i jeden deploy.
   **Świadomie nie budujemy** pod to Edge Function ani rate-limitera.

---

## 4. Funkcja keepalive

```sql
create or replace function public.keepalive()
returns timestamptz
language sql
security definer
set search_path = public
as $$ select now() $$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon;
```

Darmowy projekt Supabase **pauzuje po 7 dniach bez żadnego zapytania do API**,
a pauza cicho gubi dane — gra działa dalej, POST-y wracają błędem, którego nikt
nie widzi. Workflow `.github/workflows/supabase-keepalive.yml` strzela tu raz
dziennie.

Funkcja, a nie gołe `GET /rest/v1/`: pusty GET obsługuje sama bramka API i może
w ogóle nie dotknąć bazy. `rpc/keepalive` to **prawdziwy roundtrip do
Postgresa**, czyli dokładnie ta aktywność, której brak wywołuje pauzę.

Ręczne sprawdzenie:

```bash
curl -sS -X POST "https://dtbtvmsxhhsjieodqjos.supabase.co/rest/v1/rpc/keepalive" \
  -H "apikey: sb_publishable_IU4Jd6eKYKZGYGHw5Xb3MA_5fG-8rWI" \
  -H "Authorization: Bearer sb_publishable_IU4Jd6eKYKZGYGHw5Xb3MA_5fG-8rWI" \
  -H 'Content-Type: application/json' -d '{}'
```

---

## 5. Pięć zapisanych zapytań

Jedno do jednego z pięcioma pytaniami, na które ma odpowiadać telemetria.
Wszystkie grupują po **dacie lokalnej** (`Europe/Warsaw`), nie po UTC — inaczej
wieczorna sesja rozjeżdża się na dwa dni. Zmiana strefy to jeden `at time zone`.

### `1 — Ile osob weszlo na strone`

```sql
select
  (ts at time zone 'Europe/Warsaw')::date as dzien,
  count(distinct visitor_id)              as osoby,
  count(*)                                as wejscia   -- z przeladowaniami
from public.events
where event = 'visit'
group by 1
order by 1 desc;
```

### `2 — Ile osob zaczelo grac (lejek)`

```sql
with d as (
  select (ts at time zone 'Europe/Warsaw')::date as dzien, visitor_id, event
  from public.events
)
select
  dzien,
  count(distinct visitor_id) filter (where event = 'visit')      as weszlo,
  count(distinct visitor_id) filter (where event = 'gate_click') as kliknelo_start,
  count(distinct visitor_id) filter (where event = 'play_start') as zaczelo_grac,
  round(100.0 * count(distinct visitor_id) filter (where event = 'play_start')
        / nullif(count(distinct visitor_id) filter (where event = 'visit'), 0), 1) as konwersja_pct
from d
group by 1
order by 1 desc;
```

Kolumna `kliknelo_start` jest tu po to, żeby odpływ na pre-rollu
(`gate_click` bez `play_start`) był widoczny gołym okiem.

### `3 — Ile osob ukonczylo gre`

```sql
with d as (
  select (ts at time zone 'Europe/Warsaw')::date as dzien, visitor_id, event, seeked
  from public.events
)
select
  dzien,
  count(distinct visitor_id) filter (where event = 'play_start')                    as zaczelo,
  count(distinct visitor_id) filter (where event = 'finish')                        as ukonczylo,
  count(distinct visitor_id) filter (where event = 'finish' and seeked is not true) as ukonczylo_bez_przewijania,
  count(*)                   filter (where event = 'finish')                        as rozgrywek_ukonczonych,
  count(*)                   filter (where event = 'abandon')                       as rozgrywek_porzuconych
from d
group by 1
order by 1 desc;
```

`ukonczylo_bez_przewijania` to odpowiedź „uczciwa": flaga `seeked` odsiewa
dojazd suwakiem transportu do końca klipu bez grania.

### `4 — Ile osob zagralo wiecej niz raz`

```sql
with plays as (
  select
    (ts at time zone 'Europe/Warsaw')::date as dzien,
    visitor_id,
    count(distinct play_id) as rozgrywki
  from public.events
  where event = 'play_start'
  group by 1, 2
)
select
  dzien,
  count(*)                              as osoby_grajace,
  count(*) filter (where rozgrywki > 1) as osoby_wiecej_niz_raz,
  round(avg(rozgrywki), 2)              as srednio_rozgrywek_na_osobe,
  max(rozgrywki)                        as rekord
from plays
group by 1
order by 1 desc;
```

⚠️ Liczy **przeglądarki, nie ludzi** — patrz sekcja 7.

### `5 — Punkty w kazdej rozgrywce osobno`

```sql
select
  (ts at time zone 'Europe/Warsaw')::date    as dzien,
  (ts at time zone 'Europe/Warsaw')::time(0) as godzina,
  left(visitor_id, 8) as gracz,       -- skrot, zeby tabela byla czytelna
  play_no             as ktora_gra,
  event               as zakonczenie,  -- finish | abandon
  score               as punkty,
  hits, misses, accuracy, seeked
from public.events
where event in ('finish', 'abandon')
order by ts desc
limit 500;
```

---

## 6. Ręczna weryfikacja po wdrożeniu

Testy Vitest podstawiają `fetch` i `localStorage`, więc **realna droga do
Supabase nie jest pokryta automatycznie**. Do sprawdzenia raz, po pierwszym
deployu:

1. **Wiersz wpada do tabeli.** `npm run build` + serwowanie `dist/` (procedura
   w README, port 4174), przejście przez bramkę, potem
   `select * from public.events order by ts desc limit 20` w panelu.
2. **`Prefer: return=minimal` wystarcza.** Zakładka Network: POST kończy się
   **`201`** z pustym ciałem, w konsoli zero czerwonego. Nagłówek powtarza
   domyślkę PostgREST — bez niego POST też daje `201` — i broni dopiero przed
   `return=representation`, które wymaga `SELECT`-a i odbija się `401`.
3. **RLS naprawdę blokuje odczyt:**
   `curl -H "apikey: <klucz>" "<URL>/rest/v1/events?select=*"` musi zwrócić
   pustą tablicę albo błąd uprawnień — **nigdy** danych.
4. **Grant kolumnowy działa:** POST z `"ts": "2020-01-01T00:00:00Z"` w ciele
   musi zostać odrzucony (albo `ts` musi wyjść serwerowe).
5. **`abandon` na `pagehide`:** zamknięcie karty w trakcie gry zostawia wiersz.
   Osobno na iOS Safari i osobno przy uruchomieniu PWA z ekranu początkowego.
6. **Pre-roll:** realna reklama ma dać `gate_click` **bez** `play_start`
   (przewidywane z ADR-0024, zmierzone dotąd tylko dla zegara).
7. **Bloker reklam / tryb prywatny:** zablokowany POST zostawia grę w pełni
   sprawną — klikanie, dźwięk, ekran wyniku.
8. **Workflow keepalive:** jedno `workflow_dispatch` i HTTP 200 w logu.
9. **Pięć zapytań na realnych danych:** po pierwszym dniu sprawdzić, czy liczby
   zgadzają się z tym, co faktycznie zrobiono (dwie własne rozgrywki muszą dać
   `osoby_wiecej_niz_raz = 1`).

---

## 7. Ograniczenia, o których trzeba pamiętać czytając liczby

- **`visitor_id` identyfikuje przeglądarkę, nie człowieka.** Tryb prywatny,
  uruchomienie PWA z ekranu początkowego (osobny storage!), drugie urządzenie
  i wyczyszczenie danych tworzą nowego „gracza". Odpowiedź na pytanie 4 jest
  przez to **dolnym oszacowaniem**.
- **`abandon` nie jest gwarantowany.** Twarde ubicie karty i bfcache potrafią
  go zgubić. Wiarygodna jest różnica `play_start − finish`, nie sam licznik
  porzuceń.
- **Endpoint jest publiczny.** Ktokolwiek z kluczem (jest w bundlu) może
  wstawiać wiersze — mitygacja w sekcji 3, plan awaryjny w punkcie 4 tej sekcji.
- **`npm run dev` nie wysyła nic** (kod jest za `import.meta.env.PROD`), więc
  nagrywanie beatmapy nie zaśmieca statystyk. Weryfikacja telemetrii wymaga
  zbudowanego `dist/`.
