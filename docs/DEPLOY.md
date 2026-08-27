# Deploy — GitHub Pages

Hosting wybrany w [ADR-0007](decisions/ADR-0007-hosting-github-pages.md). Aplikacja
jest w 100% statyczna: `npm run build` produkuje `dist/`, który wystarczy podać jako
katalog publiczny.

> ⚠️ Deploy **nie jest** uruchamiany automatycznie przez agenta. Kroki 3–5 wykonujesz
> świadomie, sam.

## 0. Wymóg: nazwa repozytorium

`vite.config.ts` ustawia przy buildzie `base: '/game-video-clip/'`, bo Pages serwuje
projekt z podścieżki `https://<user>.github.io/<nazwa-repo>/`.

**Jeśli repozytorium nazywa się inaczej niż `game-video-clip`, zmień `base`
w `vite.config.ts`** — inaczej przeglądarka nie znajdzie `assets/*` (biała strona,
404 na CSS i JS).

Wyjątek: dla repo `<user>.github.io` ustaw `base: '/'`.

## 1. Weryfikacja lokalna

```bash
npm ci
npm test        # musi być zielone w 100% — warunek odbioru
npm run build   # tsc --noEmit + vite build -> dist/
npm run preview # podgląd builda pod http://localhost:4173/game-video-clip/
```

## 2. Wypchnięcie repozytorium

```bash
git remote add origin git@github.com:<user>/game-video-clip.git
git push -u origin master
```

## 3. Włączenie GitHub Pages

W repozytorium: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## 4. Workflow

Plik `.github/workflows/deploy.yml` jest już w repo. Uruchamia się przy pushu na
`master` oraz ręcznie (**Actions → Deploy → Run workflow**).

## 5. Weryfikacja po deployu

Strona: `https://<user>.github.io/game-video-clip/`

- [ ] strona się ładuje, widać odtwarzacz i przycisk **Graj**
- [ ] przycisk startuje wideo z dźwiękiem (wymagany gest — [ADR-0009](decisions/ADR-0009-start-gate-i-mobile-first.md))
- [ ] obiekty pojawiają się w momentach z `src/data/beatmap.json`
- [ ] pauza zamraża grę, przewijanie w obie strony nie psuje wyniku
- [ ] na końcu pojawia się ekran wyniku
- [ ] sprawdzone przy 375 px i 1440 px szerokości, w pionie i poziomie

Pełna checklista ręczna: [`PLAN.md`](PLAN.md), krok 15.

## 6. Własna domena

Podpięcie domeny do repozytorium projektowego sprawia, że treść serwuje się z **korzenia**
tej domeny, a nie z podścieżki `/game-video-clip/`. To zmienia trzy rzeczy naraz, więc
robi się je **jednym commitem, w momencie ustawiania DNS** — wcześniej zepsułyby działający
adres `github.io` (przeglądarka nie znalazłaby `assets/*`).

1. `vite.config.ts` — `base: '/'`.
2. `public/CNAME` — jedna linia z domeną; w repo: **Settings → Pages → Custom domain**
   plus rekordy DNS (`A`/`ALIAS` na adresy GitHub Pages albo `CNAME` na
   `<user>.github.io`). Zaznacz **Enforce HTTPS**, gdy certyfikat się wystawi.
3. Adresy absolutne w metadanych SEO — **siedem miejsc**, pełna checklista w
   [`SEO.md`](SEO.md) §4. `npm test` (`tests/seo.test.ts`) sprawdza, że wszystkie mają
   wspólny prefiks, więc połowiczna podmiana wywala się lokalnie.

Po deployu stary adres przekierowuje na domenę (robi to GitHub). W Search Console dodaj
nową usługę i zgłoś `https://<domena>/sitemap.xml` — od tego momentu działa też
`robots.txt`, który w podścieżce był ignorowany.

## Alternatywy

Jeśli zamiast Pages wybierzesz Netlify lub Cloudflare Pages: build command
`npm run build`, publish directory `dist`, a w `vite.config.ts` ustaw `base: '/'`
(oba serwują z korzenia domeny). Zmiana hostingu wymaga nowego ADR-a.
