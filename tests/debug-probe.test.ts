// @vitest-environment jsdom
/**
 * ⚠️ Test TYMCZASOWEJ sondy diagnostycznej — kasowany razem z
 * `src/debug-probe.ts` (instrukcja w naglowku tamtego pliku).
 * Sonda jedzie na produkcje, wiec musi byc pewne, ze pasek sie rysuje,
 * zanim ktos pojedzie z tym na GitHub Pages i wroci z niczym.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdProbe, setProbeStatus } from '../src/debug-probe.js';

const inputs = {
  expected: 150,
  getDuration: () => 30,
  getVideoId: () => 'abc123',
};

const box = () => document.querySelector('pre');

describe('createAdProbe — tymczasowa sonda na ekranie (ADR-0022)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
  });

  it('jest wylaczona w testach (MODE === "test"), zeby nie smiecic w jsdom', () => {
    expect(createAdProbe(inputs)).toBeUndefined();
    expect(box()).toBeNull();
  });

  it('rysuje pasek z linia startowa, gdy jest wlaczona', () => {
    vi.stubEnv('MODE', 'production');

    const probe = createAdProbe(inputs);

    expect(probe).toBeDefined();
    expect(box()?.textContent).toContain('start dur=30 oczek=150 vid=abc123');
  });

  it('dopisuje linie przy zmianie stanu i pomija powtorzenia', () => {
    vi.stubEnv('MODE', 'production');
    const probe = createAdProbe(inputs)!;

    probe(1, 30, 5, true);
    probe(1, 30, 6, true); // ten sam stan — bez nowej linii
    probe(1, 150, 91, false);

    const text = box()!.textContent!;
    expect(text).toContain('=> REKLAMA');
    expect(text).toContain('=> TRESC');
    expect(text.split('\n')).toHaveLength(3); // start + reklama + tresc
  });

  it('setProbeStatus nadpisuje linie stanu gry, nie kasujac historii', () => {
    vi.stubEnv('MODE', 'production');
    const probe = createAdProbe(inputs)!;
    probe(1, 30, 5, true);

    setProbeStatus('gra t=0.0 ZAMROZONA obiekty=0 bramka=WIDOCZNA');
    setProbeStatus('gra t=4.2 idzie obiekty=1 bramka=ukryta');

    const text = box()!.textContent!;
    expect(text).toContain('start dur=30'); // historia przetrwala
    expect(text).toContain('=> REKLAMA');
    expect(text).toContain('gra t=4.2 idzie obiekty=1 bramka=ukryta');
    expect(text).not.toContain('ZAMROZONA'); // stan nadpisany, nie dopisany
  });

  it('pokazuje pierwszy blad JS i nie nadpisuje go kolejnymi', () => {
    vi.stubEnv('MODE', 'production');
    createAdProbe(inputs);

    window.dispatchEvent(
      new ErrorEvent('error', { message: 'boom', filename: 'main.ts', lineno: 42 }),
    );
    window.dispatchEvent(new ErrorEvent('error', { message: 'drugi', lineno: 7 }));

    const text = box()!.textContent!;
    expect(text).toContain('BLAD: boom @ main.ts:42');
    expect(text).not.toContain('drugi');
  });

  it('nie przechwytuje klikniec rozgrywki', () => {
    vi.stubEnv('MODE', 'production');
    createAdProbe(inputs);

    expect(box()!.style.pointerEvents).toBe('none');
  });
});
