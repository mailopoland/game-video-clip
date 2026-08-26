// @vitest-environment jsdom
/**
 * ⚠️ Test TYMCZASOWEJ sondy diagnostycznej — kasowany razem z
 * `src/debug-probe.ts` (instrukcja w naglowku tamtego pliku).
 * Sonda jedzie na produkcje, wiec musi byc pewne, ze pasek sie rysuje,
 * zanim ktos pojedzie z tym na GitHub Pages i wroci z niczym.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdProbe } from '../src/debug-probe.js';

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

  it('nie przechwytuje klikniec rozgrywki', () => {
    vi.stubEnv('MODE', 'production');
    createAdProbe(inputs);

    expect(box()!.style.pointerEvents).toBe('none');
  });
});
