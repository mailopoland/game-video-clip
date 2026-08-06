# ADR-0008: Warstwa gry nad playerem a YouTube Terms of Service

Status: **Zaakceptowany — Wariant A (overlay), ryzyko świadomie przyjęte**
Data: 2026-08-06 (potwierdzone na checkpoincie Fazy 1)

## Kontekst

Wymaganie #2 mówi wprost: warstwa gry **nad** odtwarzaczem, klikalne obiekty na
obrazie wideo. To jest miejsce, w którym produkt spotyka się z regulaminem YouTube.

### Co wiem na pewno

- Osadzanie wideo z użyciem IFrame Player API podlega **YouTube API Services
  Terms of Service** oraz **YouTube API Services — Developer Policies**.
- Polityki wprost zakazują **zasłaniania, zakrywania i modyfikowania**
  jakiejkolwiek części osadzonego odtwarzacza, w tym nakładania na niego własnych
  treści, oraz ukrywania/blokowania kontrolek odtwarzacza.
- Polityki wymagają, aby odtwarzacz był realnie widoczny dla użytkownika (nie
  ukryty, nie zepchnięty poza ekran, nie o zerowym rozmiarze) i miał minimalny
  rozmiar rzędu **200×200 px**.
- Nie wolno zasłaniać ani modyfikować reklam wyświetlanych w odtwarzaczu.

### Czego nie jestem pewien — `[do weryfikacji]`

- Dokładna numeracja i brzmienie klauzul (polityki są aktualizowane).
- Czy przezroczysta warstwa nieprzechwytująca kontrolek i niezasłaniająca reklam
  byłaby uznana za dopuszczalną — **moja ocena: nie, klauzula o zasłanianiu jest
  sformułowana szeroko i overlay z klikalnymi elementami mieści się w jej zakresie.**
- Praktyka egzekwowania (istnieją publicznie działające projekty z overlayem —
  to nie dowód zgodności, tylko braku egzekucji).

**To nie jest porada prawna.** Przed publikacją pod własną marką warto przeczytać
aktualne polityki samodzielnie.

## Opcje

### Wariant A — overlay nad playerem (zgodny z wymaganiem #2, ryzykowny wobec ToS)

Kontener `position: relative` z iframe i warstwą `position: absolute; inset: 0`.
Obiekty gry leżą na obrazie wideo.

- ✅ Dokładnie taki produkt, jaki opisano w wymaganiach.
- ❌ Narusza (w mojej ocenie) zakaz zasłaniania odtwarzacza. Ryzyko: odcięcie
  dostępu do API / żądanie zmiany, jeśli projekt stanie się widoczny.

Mitygacje, jeśli wybierzemy A: pasek kontrolek YouTube pozostaje odsłonięty i
klikalny (warstwa gry kończy się nad nim), warstwa ma `pointer-events: none`
poza samymi obiektami, obiekty nie pojawiają się w rogach zajmowanych przez
elementy brandingu YouTube.

### Wariant B — pole gry wokół playera (zgodny z ToS)

Player 16:9 nietknięty, w pełni widoczny, z kontrolkami. Obiekty pojawiają się w
**ramce wokół** playera: na mobile (pion) w pasie pod playerem, na desktopie
w pasach po bokach. Ta sama beatmapa, to samo `x%`/`y%` — zmienia się wyłącznie
kontener, względem którego liczone są procenty.

- ✅ Zgodny z politykami, player w pełni widoczny i nienaruszony.
- ❌ Inny feel gry; wzrok dzieli się między wideo a pole gry.

## Decyzja

**W v1 implementujemy Wariant A**, ponieważ jest to jawne, powtórzone wymaganie
produktowe, a ryzyko jest tu opisane i świadomie przyjęte przez właściciela
produktu. Ryzyko ToS zostaje udokumentowane w tym ADR-ze i w `CLAUDE.md`.

Ponieważ oba warianty różnią się **wyłącznie kontenerem pozycjonującym**, przejście
na Wariant B to zmiana CSS + jednego elementu-rodzica, bez dotykania silnika ani
beatmapy. Nie budujemy pod to żadnej abstrakcji ani przełącznika z góry.

> ✅ **Potwierdzone na checkpoincie Fazy 1: Wariant A.** Ryzyko zgodności z ToS
> zostało przedstawione i przyjęte przez właściciela produktu.

## Konsekwencje

- Produkt v1 jest zgodny z wymaganiami, ale nie jest zgodny z politykami YouTube
  w stopniu, jaki byłby potrzebny do publicznej publikacji pod marką.
- Kontrolki YouTube pozostają dostępne — użytkownik może zapauzować i przewinąć,
  co jest zresztą wymagane przez wymaganie #5.
- Wymaganie #7 (bez backendu, logowania, analityki) jest niezależne od tej decyzji
  i pozostaje spełnione.
