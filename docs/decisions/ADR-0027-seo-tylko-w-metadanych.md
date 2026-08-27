# ADR-0027 — SEO wyłącznie w metadanych: zero treści w widocznym DOM

**Status:** przyjęte
**Data:** 2026-08-27
**Kontekst:** [ADR-0007](ADR-0007-hosting-github-pages.md) (Pages w podścieżce),
[ADR-0008](ADR-0008-overlay-a-youtube-tos.md) (overlay a YouTube ToS),
[ADR-0025](ADR-0025-obrazkowy-ekran-wyniku-i-restart.md) (bezsłowny interfejs),
treści i checklisty: [`docs/SEO.md`](../SEO.md)

---

## Problem

`index.html` miał `lang="pl"`, `<title>` i ikony — i nic poza tym: zero `description`,
`canonical`, Open Graph i danych strukturalnych. Cała treść strony powstaje z JS,
a widoczny tekst to trzy liczby i `PLAY AGAIN` (ADR-0025). Dla wyszukiwarki strona
była praktycznie pusta, a dla robota social media link do niej nie miał ani tytułu,
ani obrazka.

Warunek właściciela produktu: **żaden tekst SEO nie może pojawić się w interfejsie
gry.** To wyklucza jedyne rozwiązanie, które podniosłoby sufit — realną treść na
stronie (opis gry, nagłówki, FAQ).

## Decyzja

**Cała powierzchnia SEO to metadane, dane strukturalne i atrybuty dostępności.**
Konkretnie: `<title>`, `description`, `keywords`, `robots`, `canonical`, Open Graph,
Twitter card, JSON-LD `VideoGame`, `alt`, `aria-label`, manifest PWA, `robots.txt`
i `sitemap.xml`. Treści są po angielsku, bo `lang` dokumentu zmienia się z `pl` na `en`
(interfejs i tak jest bezsłowny, a wszystkie metadane są angielskie).

Cztery zasady, które z tego wynikają:

1. **Zero ukrytej treści.** Żadnego `<h1>` pod `display: none`, żadnego `sr-only`
   z opisem gry, żadnych `alt` napchanych frazami. To jest granica między
   optymalizacją a cloakingiem, który Google wymienia wprost jako spam.
   `alt` opisuje to, co realnie widać na obrazku — nic więcej.
2. **`alt` nie może rozjechać się z grafiką.** `resultImageAlt(percent)` żyje obok
   `resultImageSrc(percent)` w `src/ui/result-image.ts` i ma **te same granice
   kubełków**; test przechodzi po wszystkich 100 wartościach i sprawdza, że opis
   zmienia się dokładnie tam, gdzie zmienia się plik. To ten sam wzorzec co procent
   ↔ grafika z ADR-0025: jedno źródło, dwa wyjścia.
3. **Zero zmyślonych danych strukturalnych.** Brak `aggregateRating` i `review` —
   nie ma realnych ocen, a wymyślone są fałszywe i grożą manualną karą. Z tego
   samego powodu JSON-LD niesie tylko te dane o utworze, które znamy (tytuł
   i wykonawca), bez albumu, daty wydania czy ISRC.
4. **Adresy absolutne mają jeden prefiks i jest to testowane.** `tests/seo.test.ts`
   czyta `index.html`, `robots.txt` i `sitemap.xml`, i sprawdza, że każdy własny URL
   zaczyna się od `canonical`. Podpięcie domeny wymaga podmiany tego samego adresu
   w siedmiu miejscach — połowiczna podmiana ma się wywalić na `npm test`, a nie na
   produkcji.

`robots.txt` powstaje **mimo** że dziś nie działa: roboty czytają go wyłącznie
z korzenia domeny, a strona stoi w podścieżce `/game-video-clip/` (ADR-0007). Po
podpięciu własnej domeny repo serwuje się z korzenia i plik zaczyna działać bez
dodatkowej pracy. Sama podmiana domeny (`base: '/'`, `CNAME`, siedem adresów) jest
świadomie **odłożona do momentu ustawiania DNS** — wykonana wcześniej zepsułaby
działający adres `github.io`, bo `assets/*` przestałyby się rozwiązywać.

## Alternatywy odrzucone

| Rozwiązanie | Dlaczego nie |
|---|---|
| Ukryty `<h1>` / `sr-only` / `display:none` z opisem gry | Cloaking. Ryzyko kary większe niż zysk z jednego nagłówka. |
| Strona-lądowanie z opisem gry nad grą | Właściciel nie chce treści na ekranie — to jest warunek zadania, nie preferencja. |
| Prerender / SSG | Nie ma czego prerenderować: treścią jest gra, nie tekst. |
| Podstrony (o grze, FAQ, jak grać) | Bez realnej treści to thin content — szkodzi, nie pomaga. |
| `@supabase/supabase-js`-style biblioteka do JSON-LD | Zero zależności produkcyjnych zostaje zerem; JSON-LD to statyczny blok w HTML-u. |

## Konsekwencje

- **Ryzyko z ADR-0008 staje się bardziej widoczne.** Metadane wprost nazywają utwór
  i wykonawcę, więc gra jest łatwiejsza do znalezienia przez zainteresowanych — w tym
  przez posiadaczy praw do klipu. To **nie zmienia** oceny ryzyka z ADR-0008 (overlay
  nad cudzym wideo), ale przestaje ją maskować niewidocznością strony. Wycofanie jest
  tanie: usunięcie nazwy utworu z metadanych to kilka linii w `index.html`,
  `result-image.ts` i `docs/SEO.md`.
- **Zmiana klipu = przepisanie metadanych.** Frazy celują w konkretny utwór; podmiana
  `videoId` bez aktualizacji `index.html` zostawiłaby metadane kłamiące o treści.
- **Sufit SEO jest niski i to jest świadome.** Bez widocznej treści strona nigdy nie
  wygra ogólnych fraz. Realny cel to długi ogon wokół nazwy utworu i podgląd linku,
  który wygląda jak produkt.
