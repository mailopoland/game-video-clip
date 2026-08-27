# SEO — treści, metadane i podmiana domeny

Decyzja: [ADR-0027](decisions/ADR-0027-seo-tylko-w-metadanych.md).

Wymaganie brzegowe właściciela produktu:

> **Żaden tekst SEO nie jest widoczny w interfejsie gry.** Wchodzą wyłącznie tam, gdzie
> czytają je roboty: `<title>`, metatagi, Open Graph, JSON-LD, `alt`, `aria-label`,
> manifest, `robots.txt`, `sitemap.xml`.

Powód, dla którego to jest cała powierzchnia SEO: strona jest w całości renderowana
z JS, a widoczny tekst to trzy liczby i `PLAY AGAIN`. Google renderuje JS, więc zobaczy
DOM gry — a w nim brak nagłówków i akapitów. **Sufitu nie da się podnieść bez dodania
widocznej treści**, czego właściciel nie chce.

Klip w beatmapie (`videoId: 5OyTxEbT-fM`) to **LIL NAAY – MOOD BRAZIL**, więc metadane
celują najpierw we frazę z piosenką („mood brazil game", „lil naay game"), a dopiero
potem w gatunek („rhythm tap game") — długi ogon jest osiągalny, ogólne frazy nie.

---

## 1. Co gdzie leży

| Plik | Co niesie |
|---|---|
| `index.html` | `lang="en"`, `<title>`, `description`, `keywords`, `robots`, `canonical`, 9 tagów Open Graph, 5 tagów Twittera, JSON-LD `VideoGame`, `<noscript>` |
| `src/ui/render.ts` | `alt` bramki startowej, angielskie `aria-label` wszystkich kontrolek |
| `src/ui/result-image.ts` | `resultImageAlt(percent)` — `alt` grafiki wyniku, te same granice kubełków co `resultImageSrc` |
| `public/robots.txt` | `User-agent: *`, `Allow: /`, `Sitemap:` |
| `public/sitemap.xml` | jeden `<loc>` == `canonical` |
| `public/manifest.webmanifest` | `name`, `short_name`, `description`, `lang`, `dir`, `categories`, `id` |
| `public/og-image.png` | 1200×630, generowany przez `scripts/make-og-image.mjs` |
| `tests/seo.test.ts` | pilnuje kompletu tagów, poprawności JSON-LD i **spójności adresów** |

## 2. Treści (EN)

| Klucz | Treść | Zn. |
|---|---|---|
| `title` | `Mood Brazil Slap Game — LIL NAAY Rhythm Tap Game` | 48 |
| `description` | `Slap every hand that pops up on the LIL NAAY - MOOD BRAZIL music video. A free rhythm tap game in your browser - no download, no sign-up. One tap to start.` | 155 |
| `og:title` / `twitter:title` | `Mood Brazil Slap Game — LIL NAAY` | 32 |
| `og:description` | `Tap every hand that pops up on the LIL NAAY - MOOD BRAZIL video, score points and chase a perfect run. Free, in the browser, no download.` | 137 |
| `twitter:description` | `A free rhythm tap game played on the LIL NAAY - MOOD BRAZIL music video. Slap every hand you see, chase 100%. No download, no sign-up.` | 134 |
| `og:image:alt` | `A cartoon hand slapping a target on top of the Mood Brazil music video` | — |
| `alt` bramki | `Start screen: tap a hand the moment it appears on the Mood Brazil video to score a point` | — |
| `<noscript>` | jeden akapit opisujący grę zgodnie z prawdą | 240 |

`alt` grafik wyniku — sześć wariantów w `resultImageAlt`; nazwa utworu pada **wyłącznie**
w wariancie 100%, bo powtórzona w każdym kubełku byłaby keyword stuffingiem.
Testy pilnują obu rzeczy: granic kubełków i braku nazwy utworu w pozostałych pięciu.

`aria-label`: `Play the Mood Brazil slap game` / `Loading` (bramka), `Slap the hand` (cel),
`Play or pause the video`, `Seek through the video`, `Mute` / `Unmute`.

JSON-LD: `VideoGame` + `isBasedOn` typu `MusicRecording` (`Mood Brazil`, `byArtist:
MusicGroup LIL NAAY`). **Bez `aggregateRating`/`review`** — nie ma realnych ocen,
a zmyślone to fałszywe dane strukturalne i ryzyko manualnej kary (pilnuje tego test).

## 3. `robots.txt` a podścieżka GitHub Pages

Roboty czytają `robots.txt` **wyłącznie z korzenia domeny**. Dopóki strona stoi pod
`https://mailopoland.github.io/game-video-clip/`, plik leży pod
`/game-video-clip/robots.txt` i jest **ignorowany** — istnieje z wyprzedzeniem, bo po
podpięciu własnej domeny repo serwuje się z korzenia i plik zaczyna działać bez
dodatkowej pracy (trzeba tylko podmienić adres w linii `Sitemap:`).

Mapę witryny zgłasza się w Search Console **wprost adresem**, więc działa już teraz,
bez `robots.txt`.

## 4. Podmiana na własną domenę — checklista

Robiona **jednym commitem, w momencie ustawiania DNS** (wcześniej zepsułaby działający
adres `github.io`, bo `base: '/'` przestawia ścieżki do `assets/*`).

1. `vite.config.ts` — `base: command === 'build' ? '/game-video-clip/' : '/'` → `base: '/'`.
   GitHub Pages z własną domeną serwuje repo projektowe z **korzenia**.
2. `public/CNAME` (nowy plik) — jedna linia z domeną. Do tego `Settings → Pages →
   Custom domain` i rekordy DNS (`A`/`ALIAS` na adresy GitHub Pages albo `CNAME`
   na `mailopoland.github.io`).
3. Siedem miejsc z adresem absolutnym:
   - `index.html` — `canonical`, `og:url`, `og:image`, `twitter:image`,
     oraz `url`, `image`, `screenshot` w JSON-LD;
   - `public/robots.txt` — linia `Sitemap:`;
   - `public/sitemap.xml` — `<loc>`.
4. `npm test` — `tests/seo.test.ts` sprawdza, że **wszystkie własne adresy mają wspólny
   prefiks**, więc połowiczna podmiana wywala się lokalnie, a nie na produkcji.
5. Po deployu stary adres `github.io/game-video-clip/` przekierowuje na domenę (robi to
   GitHub). W Search Console dodaj nową usługę i zgłoś `https://<domena>/sitemap.xml`.

## 5. Weryfikacja

Lokalnie (build, bo `npm run preview` na tej maszynie jest zepsuty — procedura w README):
`view-source:` pokazuje metadane i JSON-LD w **statycznym** HTML-u, `/robots.txt`
i `/sitemap.xml` zwracają treść, a w oknie gry **nie widać żadnego nowego tekstu**.

Po deployu: Rich Results Test / Schema Markup Validator (JSON-LD bez błędów),
Search Console („Sprawdzenie URL" → renderowany HTML zawiera metadane; potem zgłoszenie
mapy), Facebook Sharing Debugger i LinkedIn Post Inspector (podgląd 1200×630),
Lighthouse → zakładka SEO.

## 6. Czego świadomie nie robimy

| Odrzucone | Dlaczego |
|---|---|
| Ukryty `<h1>` / `sr-only` z opisem gry | Cloaking i „hidden text" wprost w wytycznych Google jako spam. |
| Napchane frazami `alt` i `aria-label` | To samo; przy 73 celach powtórzony `alt` z frazą to klasyczny stuffing. |
| `aggregateRating` w JSON-LD | Brak realnych ocen — zmyślone = fałszywe dane strukturalne. |
| `hreflang` | Jeden język, jeden URL. |
| Pełne dane utworu (album, data wydania, ISRC) | Nieznane — zgadywanie wpisałoby nieprawdę w dane strukturalne. |
| Prerender / SSG / dodatkowe podstrony | Nie ma treści do wyrenderowania; podstrony bez treści to thin content. |
