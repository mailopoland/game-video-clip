# ADR-0007: Hosting statyczny — GitHub Pages

Status: Zaakceptowany (Faza 1)
Data: 2026-08-06

## Kontekst

Aplikacja jest w 100% client-side: bez backendu, bez zapisu wyników, bez logowania,
bez analityki. Potrzebny jest tylko serwer plików statycznych z HTTPS
(YouTube IFrame API wymaga bezpiecznego kontekstu w praktyce; `localhost` też jest
traktowany jako bezpieczny).

## Opcje

| | GitHub Pages | Netlify | Cloudflare Pages |
|---|---|---|---|
| Konto poza istniejącym repo | nie | tak | tak |
| Deploy z repo | natywny (Actions) | tak | tak |
| HTTPS + własna domena | tak | tak | tak |
| Nagłówki/redirecty | ograniczone | pełne | pełne |
| Zależności w projekcie | zero | CLI/integracja | CLI/integracja |

Wszystkie trzy mają darmowy plan wystarczający dla tego projektu.

## Decyzja

**GitHub Pages**, deploy z GitHub Actions (`actions/deploy-pages`). Projekt jest
już repozytorium git; to jedyna opcja, która nie wymaga zakładania konta w kolejnej
usłudze ani instalowania CLI.

Konsekwencja konfiguracyjna: strona serwowana jest z podścieżki
`/<nazwa-repo>/`, więc `vite.config.ts` musi ustawiać `base: '/<nazwa-repo>/'`.

## Konsekwencje

- Zero dodatkowych zależności w `package.json`.
- Brak kontroli nad nagłówkami HTTP (m.in. CSP) — dla tej gry bez znaczenia.
- Deploy **nie jest** uruchamiany automatycznie w Fazie 2; workflow zostaje
  opisany w `docs/DEPLOY.md` i wymaga świadomego włączenia Pages w ustawieniach repo.
- Przy zmianie hostingu zmienia się tylko `base` + instrukcja deployu (nowy ADR).
