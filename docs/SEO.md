# SEO — treści i plan wdrożenia

Dokument definiuje **wszystkie teksty SEO** (po angielsku) oraz **dokładny plan**, gdzie
je wstawić. Wymaganie brzegowe właściciela produktu:

> **Żaden z tych tekstów nie może być widoczny w interfejsie gry.** Wchodzą wyłącznie
> tam, gdzie czytają je roboty: `<title>`, metatagi, Open Graph, JSON-LD, `alt`,
> `aria-label`, manifest, `sitemap.xml`.

Stan wyjściowy (przed wdrożeniem): `index.html` ma `lang="pl"`, `<title>`, ikony i
manifest — i **nic więcej**: zero `description`, zero `canonical`, zero Open Graph,
zero danych strukturalnych. Cała treść strony powstaje z JS (`render.ts`), a widoczny
tekst to trzy liczby i `PLAY AGAIN`. Dla wyszukiwarki strona jest dziś praktycznie pusta.

---

## 0. Ograniczenia, które kształtują ten plan

1. **Nie ma treści tekstowej do zaindeksowania i nie będzie.** Google renderuje JS, więc
   zobaczy DOM gry — a w nim brak nagłówków i akapitów. Cała powierzchnia SEO to
   metadane + JSON-LD + `alt` + jeden `<noscript>`. To jest sufit, jaki ta strona ma;
   nie da się go podnieść bez dodania widocznej treści (czego właściciel nie chce).
2. **Ukryty tekst „dla robota" to cloaking.** Dlatego świadomie **nie** wstawiamy
   ukrytych `<h1>`/akapitów `display:none`, `sr-only` z opisem gry ani `alt` napchanych
   frazami. Wszystko poniżej jest opisem tego, co realnie jest na ekranie — to jest
   granica między optymalizacją a karą od Google.
3. **Hosting to GitHub Pages w podścieżce** `https://mailopoland.github.io/game-video-clip/`
   (ADR-0007, `base` w `vite.config.ts`). Konsekwencje:
   - `robots.txt` **działa wyłącznie w katalogu głównym domeny** —
     `mailopoland.github.io/robots.txt` należy do repo `mailopoland.github.io`, nie do
     tego repo. Plik w `public/` wylądowałby pod `/game-video-clip/robots.txt` i byłby
     **ignorowany**. Dlatego go nie dodajemy (szczegóły: krok 6).
   - `sitemap.xml` da się zgłosić w Search Console **bezpośrednio adresem**, bez
     `robots.txt` — więc ma sens mimo podścieżki.
   - Wszystkie URL-e absolutne (canonical, `og:url`, `og:image`) muszą zawierać
     `/game-video-clip/`.
4. **Jedna strona = jeden URL.** Bez paginacji, kategorii, `hreflang` (jeden język) i
   bez sensownego drzewa linkowania wewnętrznego.
5. **Zero zależności produkcyjnych zostaje zerem.** Nic tu nie wymaga biblioteki.

---

## 1. Docelowe frazy

Kolejność = priorytet. Fraza główna wchodzi do `<title>`, `og:title` i JSON-LD `name`.

| Fraza | Gdzie użyta |
|---|---|
| music video slap game | `<title>`, `og:title`, `name` w JSON-LD, `og:site_name` |
| rhythm tap game | `<title>`, `description`, `genre` w JSON-LD |
| free browser game / play in browser | `description`, `og:description`, `gamePlatform` |
| no download, no sign-up | `description`, `og:description` |
| clicking game / tapping game | `keywords`, `alternateName`, `alt` bramki |
| hand slap game | `alt` bramki, `aria-label` celu |
| music rhythm game online | `keywords`, `twitter:description` |

⚠️ Fraz związanych z **konkretnym utworem/wykonawcą** z klipu (`videoId: 5OyTxEbT-fM`)
tu **nie ma** — nie znam tytułu ani wykonawcy, a zgadywanie wpisałoby nieprawdę w
metadane. Jeśli chcesz celować w „<artysta> <tytuł> game", podaj te dane; wtedy
dopisujemy je do `description`, `keywords` i JSON-LD (`about`/`isBasedOn`) — to jedna
dodatkowa iteracja, nie przebudowa.

---

## 2. Treści — jedno źródło prawdy

Wszystkie teksty w jednym miejscu; kroki z sekcji 3 tylko je przenoszą do plików.

### 2.1 Tytuł i opis

| Klucz | Treść | Znaki |
|---|---|---|
| `title` | `Music Video Slap Game — Free Rhythm Tap Game` | 44 |
| `description` | `Slap every hand that pops up on the music video. A free rhythm tap game in your browser - no download, no sign-up. One tap to start, then chase 100%.` | 149 |
| `keywords` (opcjonalne) | `music video slap game, rhythm tap game, browser game, clicking game, tapping game, free online game, no download game, music rhythm game` | — |

`title` mieści się w ~60 znakach SERP-a, `description` w ~155 — oba bez ucięcia
wielokropkiem. `keywords` Google ignoruje od 2009; zostaje jako tani wpis dla
pozostałych silników — **nie rozdmuchujemy go** (patrz sekcja 6).

### 2.2 Open Graph (Facebook, Messenger, LinkedIn, Discord)

| Właściwość | Wartość |
|---|---|
| `og:type` | `website` |
| `og:site_name` | `Music Video Slap Game` |
| `og:title` | `Music Video Slap Game` |
| `og:description` | `Tap every hand that pops up on the music video, score points and chase a perfect run. Free, in the browser, no download.` |
| `og:url` | `https://mailopoland.github.io/game-video-clip/` |
| `og:image` | `https://mailopoland.github.io/game-video-clip/og-image.png` |
| `og:image:width` / `og:image:height` | `1200` / `630` |
| `og:image:alt` | `A cartoon hand slapping a target on top of a music video` |
| `og:locale` | `en_US` |

### 2.3 Twitter / X

| Nazwa | Wartość |
|---|---|
| `twitter:card` | `summary_large_image` |
| `twitter:title` | `Music Video Slap Game` |
| `twitter:description` | `A free rhythm tap game played on top of a music video. Slap every hand you see, chase 100%. No download, no sign-up.` |
| `twitter:image` | `https://mailopoland.github.io/game-video-clip/og-image.png` |
| `twitter:image:alt` | `A cartoon hand slapping a target on top of a music video` |

### 2.4 Dane strukturalne (JSON-LD, schema.org)

Typ `VideoGame` (gra przeglądarkowa, darmowa, bez instalacji). **Bez
`aggregateRating` i `review`** — nie ma realnych ocen, a wymyślone to fałszywe dane
strukturalne i ryzyko manualnej kary.

```json
{
  "@context": "https://schema.org",
  "@type": "VideoGame",
  "name": "Music Video Slap Game",
  "alternateName": "Click the Target",
  "url": "https://mailopoland.github.io/game-video-clip/",
  "description": "A free rhythm tap game played on top of a music video. Hands appear in time with the track; tap each one before it disappears to score a point, then see your final score as a percentage of every hand in the run.",
  "genre": ["Rhythm game", "Casual game", "Arcade game"],
  "applicationCategory": "GameApplication",
  "gamePlatform": "Web browser",
  "operatingSystem": "Any",
  "browserRequirements": "Requires JavaScript. Works in any modern desktop or mobile browser.",
  "playMode": "SinglePlayer",
  "inLanguage": "en",
  "isAccessibleForFree": true,
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  },
  "image": "https://mailopoland.github.io/game-video-clip/og-image.png",
  "screenshot": "https://mailopoland.github.io/game-video-clip/og-image.png"
}
```

### 2.5 `<noscript>` — jedyny tekst w `<body>`

Widoczny **wyłącznie** przy wyłączonym JS, czyli nigdy dla gracza. Jeden akapit,
opis zgodny z prawdą, zero powtórzeń frazy:

```
Music Video Slap Game is a free rhythm game played on top of a music video: hands pop
up in time with the track and every one you tap in time is a point. It runs entirely in
the browser and needs JavaScript enabled.
```

### 2.6 `alt` obrazków

| Element | `alt` | Uzasadnienie |
|---|---|---|
| `#gate-image` (bramka startowa) | `Start screen: tap a hand the moment it appears on the video to score a point` | Grafika naprawdę niesie instrukcję i „tap to start" — `alt` ją oddaje. |
| `#r-image` 0% | `Score screen: no hands slapped in this run` | dobierane funkcją, patrz krok 4 |
| `#r-image` 1–25% | `Score screen: a few hands slapped out of the whole music video` | |
| `#r-image` 26–50% | `Score screen: about half of the hands slapped` | |
| `#r-image` 51–75% | `Score screen: most of the hands slapped` | |
| `#r-image` 76–99% | `Score screen: almost every hand slapped` | |
| `#r-image` 100% | `Score screen: perfect run - every hand on the music video slapped` | |
| `.sprite` w celu (`img` w `.obj`) | `""` (bez zmian) | Dekoracyjny, powtarzany do 73 razy; opis niesie `aria-label` przycisku. |
| `#hud-hand img` | `""` (bez zmian) | Kontener ma już `aria-hidden="true"`. |

### 2.7 `aria-label` — dziś po polsku, docelowo po angielsku

Niewidoczne dla gracza, czytane przez czytniki ekranu **i** przez roboty jako opis
kontrolek. Po zmianie `lang` na `en` polskie etykiety byłyby dodatkowo niespójne
z deklarowanym językiem dokumentu.

| Element | Teraz | Docelowo |
|---|---|---|
| `#start` (gotowy) | `Graj` | `Play the music video slap game` |
| `#start` (ładowanie) | `Ladowanie…` | `Loading` |
| `.obj` (cel) | `Cel` | `Slap the hand` |
| `#transport-play`, `#yt-button-proxy` | `Odtwarzaj lub wstrzymaj` | `Play or pause the video` |
| `#transport-seek` | `Przewijanie` | `Seek through the video` |
| `#transport-mute` (gra dźwięk) | `Wycisz` | `Mute` |
| `#transport-mute` (wyciszone) | `Wlacz dzwiek` | `Unmute` |
| `#r-again` | `Play again` | bez zmian |

### 2.8 Manifest PWA

| Klucz | Teraz | Docelowo |
|---|---|---|
| `name` | `Click the target` | `Music Video Slap Game` |
| `short_name` | `Click` | `Slap Game` |
| `description` | brak | `A free rhythm tap game played on top of a music video. Tap every hand you see.` |
| `lang` | brak | `en` |
| `dir` | brak | `ltr` |
| `categories` | brak | `["games", "entertainment"]` |
| `id` | brak | `.` |

⚠️ `name`/`short_name` **są widoczne** — pod ikoną na ekranie początkowym po
zainstalowaniu PWA. To jedyne miejsce, w którym te treści widać, i jest poza stroną;
jeśli i to jest niepożądane, zostawiamy manifest bez zmian (koszt: brak).
Razem z manifestem idzie `<meta name="apple-mobile-web-app-title" content="Slap Game">`
w `index.html` (iOS bierze nazwę stąd, nie z manifestu).

---

## 3. Krok 1 — `index.html`

Jedyny plik, w którym powstaje 90% efektu. Zmiany:

1. `<html lang="pl">` → `<html lang="en">` — **najważniejsza pojedyncza poprawka**:
   dziś strona deklaruje polski, a cała jej treść jest po angielsku.
2. `<title>` → treść z 2.1.
3. Dopisać w `<head>`, w tej kolejności: `description`, `robots`, `canonical`,
   blok Open Graph, blok Twittera, JSON-LD.
4. `apple-mobile-web-app-title` → `Slap Game`.
5. `<body>`: `<noscript>` z 2.5 **przed** `<div id="app">`.

Docelowy `<head>` (istniejące linie zachowane, nowe oznaczone `<!-- SEO -->`):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Music Video Slap Game — Free Rhythm Tap Game</title>

    <!-- SEO: strona jest w calosci renderowana z JS i nie ma widocznego tekstu,
         wiec metadane sa jedyna powierzchnia dla wyszukiwarek (docs/SEO.md). -->
    <meta name="description" content="Slap every hand that pops up on the music video. A free rhythm tap game in your browser - no download, no sign-up. One tap to start, then chase 100%." />
    <meta name="keywords" content="music video slap game, rhythm tap game, browser game, clicking game, tapping game, free online game, no download game, music rhythm game" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="https://mailopoland.github.io/game-video-clip/" />

    <!-- SEO: Open Graph — podglad linku na FB/Messengerze/LinkedInie/Discordzie. -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Music Video Slap Game" />
    <meta property="og:title" content="Music Video Slap Game" />
    <meta property="og:description" content="Tap every hand that pops up on the music video, score points and chase a perfect run. Free, in the browser, no download." />
    <meta property="og:url" content="https://mailopoland.github.io/game-video-clip/" />
    <meta property="og:image" content="https://mailopoland.github.io/game-video-clip/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="A cartoon hand slapping a target on top of a music video" />
    <meta property="og:locale" content="en_US" />

    <!-- SEO: Twitter/X. -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Music Video Slap Game" />
    <meta name="twitter:description" content="A free rhythm tap game played on top of a music video. Slap every hand you see, chase 100%. No download, no sign-up." />
    <meta name="twitter:image" content="https://mailopoland.github.io/game-video-clip/og-image.png" />
    <meta name="twitter:image:alt" content="A cartoon hand slapping a target on top of a music video" />

    <!-- iPhone nie ma Fullscreen API (ADR-0021) — te linie daja pelny ekran z PWA. -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Slap Game" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#101014" />
    <link rel="manifest" href="manifest.webmanifest" />
    <link rel="icon" type="image/png" href="favicon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="icons/icon-180.png" />
    <link rel="stylesheet" href="/src/styles.css" />

    <!-- SEO: dane strukturalne. Bez aggregateRating — nie ma realnych ocen. -->
    <script type="application/ld+json">
      { … blok z sekcji 2.4 … }
    </script>
  </head>
  <body>
    <noscript>
      Music Video Slap Game is a free rhythm game played on top of a music video: hands
      pop up in time with the track and every one you tap in time is a point. It runs
      entirely in the browser and needs JavaScript enabled.
    </noscript>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

⚠️ **URL-e absolutne są celowo zapisane wprost**, nie przez `import.meta.env.BASE_URL`
— Vite nie podmienia zmiennych w `index.html` poza `%VITE_*%` w trybie env, a
`og:image` musi być absolutny (crawler social nie rozwiąże ścieżki względnej).
Zmiana repozytorium/hostingu = ręczna zmiana tych pięciu URL-i; wpis idzie do tabeli
„Gdzie co zmieniać" w README (krok 8).

---

## 4. Krok 2 — `src/ui/render.ts` i `src/ui/result-image.ts`

**`render.ts`** (`createUi`, jeden szablon `innerHTML` + trzy miejsca `setAttribute`):

| Linia (dziś) | Zmiana |
|---|---|
| `aria-label="Odtwarzaj lub wstrzymaj"` (×2: `#yt-button-proxy`, `#transport-play`) | `Play or pause the video` |
| `aria-label="Graj"` (`#start`) | `Play the music video slap game` |
| `alt="Klikaj dlonie, gdy sie pojawia"` (`#gate-image`) | `alt` z 2.6 |
| `aria-label="Przewijanie"` (`#transport-seek`) | `Seek through the video` |
| `aria-label="Wycisz"` (`#transport-mute`, statyczny HTML) | `Mute` |
| `element.setAttribute('aria-label', 'Cel')` (`createObjectElement`) | `Slap the hand` |
| `transportMute.setAttribute('aria-label', muted ? 'Wlacz dzwiek' : 'Wycisz')` | `muted ? 'Unmute' : 'Mute'` |
| `startButton.setAttribute('aria-label', enabled ? 'Graj' : 'Ladowanie…')` | `enabled ? 'Play the music video slap game' : 'Loading'` |
| `<img class="results-image" id="r-image" alt="" />` | `alt` ustawiany razem z `src` (niżej) |

**`result-image.ts`** — nowa czysta funkcja obok `resultImageSrc`, żeby `alt` i grafika
nie mogły się rozjechać (ten sam wzorzec co procent ↔ grafika, ADR-0025):

```ts
/** Kubelek procentowy -> `alt` grafiki wyniku. Ta sama granica co `resultImageSrc`. */
export function resultImageAlt(percent: number): string { … }
```

W `render()` (blok `showResults`) obok `resultsImage.src = resultImageSrc(percent)`
dochodzi `resultsImage.alt = resultImageAlt(percent)`.

**Testy do poprawienia/dopisania** (`npm test` musi zostać w 100% zielony):

- `tests/smoke.test.ts:619,624` — asercje `'Wlacz dzwiek'` / `'Wycisz'` → `'Unmute'` / `'Mute'`.
- `tests/smoke.test.ts` — dopisać test: `#gate-image` i `#r-image` mają niepusty `alt`,
  a `alt` grafiki wyniku zmienia się wraz z kubełkiem.
- `tests/result-image.test.ts` — dopisać przypadki `resultImageAlt` na tych samych
  granicach co `resultImageSrc` (0 / 1 / 25 / 26 / 50 / 51 / 75 / 76 / 99 / 100).

---

## 5. Krok 3 — `public/manifest.webmanifest`

Wartości z 2.8. Reszta pól (`start_url`, `scope`, `display`, `orientation`, kolory,
`icons`) **bez zmian** — są warunkiem pełnego ekranu na iOS (ADR-0021).

---

## 6. Krok 4 — `public/sitemap.xml` (nowy), `robots.txt` (świadomie pomijamy)

`public/sitemap.xml` (Vite kopiuje `public/` 1:1 do `dist/`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://mailopoland.github.io/game-video-clip/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
```

Bez `<lastmod>` — data w repo szybko kłamie, a Google traktuje niewiarygodny `lastmod`
jako sygnał do zignorowania całej mapy.

**`robots.txt` nie powstaje.** Pod `/game-video-clip/robots.txt` jest bezużyteczny
(roboty czytają wyłącznie korzeń domeny), a korzeń `mailopoland.github.io` to inne
repozytorium. Jeśli je masz — dopisz tam `Sitemap: https://mailopoland.github.io/game-video-clip/sitemap.xml`.
Niezależnie od tego mapę zgłasza się wprost w Search Console (krok 9).

---

## 7. Krok 5 — `public/og-image.png` (1200×630)

Bez tego pliku `og:image` wskazuje w pustkę i podgląd linku jest goły. Trzy opcje,
w kolejności preferencji:

1. **Wygenerować proceduralnie** `scripts/make-og-image.mjs` — dokładnie tak jak
   `scripts/make-icons.mjs` (enkoder PNG na `node:zlib`) plus dekoder GIF-a z
   `scripts/make-favicon.mjs`: ciemne tło `#101014` + wyskalowany `hand-hit.gif`.
   Zero zależności, zero pobierania z internetu — zgodne z zasadami projektu.
2. **Przeskalować lokalnie `ffmpeg`-iem** jeden z `images/score*.png` do 1200×630 na
   ciemnym tle (ta sama droga co GIF-y wyniku).
3. **Tymczasowo** wskazać `og:image` na `icons/icon-512.png` (512×512, kwadrat —
   podgląd będzie mały; wtedy `twitter:card` na `summary`, nie `summary_large_image`,
   i bez `og:image:width/height`).

Rekomendacja: 1, jako osobny commit po metadanych — metadane działają dla Google od
razu, obrazek dotyczy głównie podglądów w social mediach.

---

## 8. Krok 6 — dokumentacja projektu

- **`README.md`**: nowa sekcja „SEO i metadane" (co jest w `<head>`, dlaczego treści
  nie ma w widocznym DOM, gdzie leży canonical) + wiersze w tabeli „Gdzie co zmieniać":
  `zmienić treści SEO / canonical / Open Graph` → `index.html` (+ `docs/SEO.md`),
  `zmienić alt grafik wyniku` → `src/ui/result-image.ts`.
  README idzie **w tym samym commicie** co zmiana zachowania (zasada z CLAUDE.md).
- **`docs/decisions/ADR-0027-seo-tylko-w-metadanych.md`** (nowy ADR + link w README
  i CLAUDE.md): decyzja „SEO wyłącznie w metadanych, zero widocznej i zero ukrytej
  treści w DOM", z odrzuconymi alternatywami: ukryty `<h1>`/`sr-only` (cloaking),
  strona-lądowanie z opisem gry nad grą (właściciel nie chce treści na ekranie),
  prerender/SSG (nie ma czego prerenderować — treść to gra).

---

## 9. Kolejność wdrożenia i weryfikacja

| # | Commit | Zawartość |
|---|---|---|
| 1 | `seo: metadane, canonical, OG, JSON-LD w index.html` | krok 1 + `lang="en"` + `<noscript>` |
| 2 | `seo: angielskie aria-label i alt grafik` | krok 2 + testy |
| 3 | `seo: manifest i sitemap` | kroki 3–4 |
| 4 | `seo: obrazek podgladu og-image` | krok 5 |
| 5 | `docs: ADR-0027 + sekcja SEO w README` | krok 6 (albo dołączone do commitu 1) |

Po każdym commicie: **`npm test` zielone w 100%** (zasada z CLAUDE.md).

Weryfikacja po deployu (`docs/DEPLOY.md`, ręcznie):

1. `view-source:https://mailopoland.github.io/game-video-clip/` — metatagi i JSON-LD
   są w **statycznym** HTML-u, nie dopisywane z JS.
2. Google Rich Results Test / Schema Markup Validator — JSON-LD bez błędów.
3. Search Console: „Sprawdzenie URL" → renderowany HTML zawiera metadane; następnie
   „Mapy witryny" → zgłoszenie `https://mailopoland.github.io/game-video-clip/sitemap.xml`.
4. Debugger podglądów: Facebook Sharing Debugger, LinkedIn Post Inspector,
   `https://cards-dev.twitter.com/validator` — obrazek 1200×630 się pokazuje.
5. W przeglądarce: **żaden nowy tekst nie jest widoczny na ekranie gry** — to warunek
   odbioru całości.
6. Lighthouse → zakładka SEO (oczekiwane 100; brak `robots.txt` nie obniża wyniku).

---

## 10. Czego świadomie nie robimy

| Odrzucone | Dlaczego |
|---|---|
| Ukryty `<h1>` / `sr-only` / `display:none` z opisem gry | Cloaking i „hidden text" wprost w wytycznych Google jako spam. Ryzyko kary większe niż zysk z jednego nagłówka. |
| Napchane frazami `alt` i `aria-label` | To samo. `alt` opisuje obrazek; przy 73 celach powtórzony `alt` z frazą to klasyczny keyword stuffing. |
| `aggregateRating` / `review` w JSON-LD | Nie ma realnych ocen. Zmyślone = fałszywe dane strukturalne, manualna kara. |
| `hreflang` | Jeden język, jeden URL. |
| `robots.txt` w `public/` | Nie działa w podścieżce GitHub Pages (sekcja 6). |
| Zmiana `<title>` na dłuższy „keyword stack" | Ucięcie w SERP-ie i gorszy CTR; 44 znaki mieszczą frazę główną w całości. |
| Prerender / SSG / dodatkowe podstrony | Nie ma treści do wyrenderowania; podstrony bez treści to thin content. |
| Dane utworu/wykonawcy z klipu | Nieznane — zgadywanie wpisałoby nieprawdę w metadane (sekcja 1). |
