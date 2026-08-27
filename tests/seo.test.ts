import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Metadane SEO (ADR-0027) sa jedyna trescia, jaka widzi wyszukiwarka — a zaden
 * inny test ich nie dotyka: `smoke.test.ts` buduje DOM z `createUi` i nie zaglada
 * do `index.html`. Testy czytaja pliki z dysku (cwd = katalog projektu).
 *
 * Najwazniejszy jest ostatni blok: SPOJNOSC ADRESOW. Podpiecie wlasnej domeny
 * wymaga podmiany tego samego URL-a w 7 miejscach (docs/SEO.md) — polowiczna
 * podmiana ma sie wywalic tutaj, a nie na produkcji.
 */
const read = (path: string): string => readFileSync(path, 'utf-8');

const html = read('index.html');
const robots = read('public/robots.txt');
const sitemap = read('public/sitemap.xml');
const manifest = JSON.parse(read('public/manifest.webmanifest')) as Record<string, unknown>;

/** Zawartosc `content` metatagu po nazwie (`name=` albo `property=`). */
function meta(nameOrProperty: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]*(?:name|property)="${nameOrProperty}"[^>]*content="([^"]*)"|` +
      `<meta[^>]*content="([^"]*)"[^>]*(?:name|property)="${nameOrProperty}"`,
    's',
  );
  const match = html.match(pattern);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/)![1]!;

describe('SEO: index.html', () => {
  it('deklaruje angielski, bo cala tresc metadanych jest po angielsku', () => {
    expect(html).toContain('<html lang="en">');
  });

  it('ma tytul i opis w dlugosciach, ktore SERP pokazuje bez uciecia', () => {
    const title = html.match(/<title>([^<]*)<\/title>/)![1]!;
    expect(title.length).toBeGreaterThan(10);
    expect(title.length).toBeLessThanOrEqual(60);

    const description = meta('description')!;
    expect(description).not.toBeNull();
    expect(description.length).toBeGreaterThan(50);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it('ma komplet Open Graph i Twittera (podglad linku w social mediach)', () => {
    for (const property of [
      'og:type',
      'og:site_name',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'og:image:alt',
      'og:locale',
    ]) {
      expect(meta(property), property).toBeTruthy();
    }
    for (const name of [
      'twitter:card',
      'twitter:title',
      'twitter:description',
      'twitter:image',
      'twitter:image:alt',
    ]) {
      expect(meta(name), name).toBeTruthy();
    }
  });

  it('ma poprawny JSON-LD typu VideoGame, bez zmyslonych ocen', () => {
    const raw = html.match(
      /<script type="application\/ld\+json">\s*(\{.*?\})\s*<\/script>/s,
    )![1]!;
    const data = JSON.parse(raw) as Record<string, unknown>;

    expect(data['@type']).toBe('VideoGame');
    expect(data['name']).toBeTruthy();
    expect(data['url']).toBe(canonical);
    // Zmyslone oceny to falszywe dane strukturalne i ryzyko manualnej kary.
    expect(data['aggregateRating']).toBeUndefined();
    expect(data['review']).toBeUndefined();
  });

  it('ma <noscript> — jedyny tekst w body, nigdy widoczny dla gracza', () => {
    expect(html).toMatch(/<noscript>[\s\S]*\S[\s\S]*<\/noscript>/);
  });
});

describe('SEO: robots.txt, sitemap.xml i manifest', () => {
  it('robots.txt wpuszcza roboty i wskazuje mape witryny', () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
  });

  it('sitemap.xml wskazuje dokladnie canonical i nie klamie data', () => {
    expect(sitemap).toContain(`<loc>${canonical}</loc>`);
    expect(sitemap).not.toContain('<lastmod>');
  });

  it('manifest ma pola czytane przez roboty i zachowuje pelny ekran iOS', () => {
    expect(manifest['description']).toBeTruthy();
    expect(manifest['lang']).toBe('en');
    expect(manifest['categories']).toEqual(['games', 'entertainment']);
    // Warunki pelnego ekranu z ADR-0021 — SEO nie moze ich ruszyc.
    expect(manifest['display']).toBe('fullscreen');
    expect(manifest['orientation']).toBe('landscape');
    expect(manifest['start_url']).toBe('.');
    expect(manifest['scope']).toBe('.');
  });
});

describe('SEO: spojnosc adresow (bezpiecznik podmiany domeny)', () => {
  it('kazdy wlasny URL absolutny zaczyna sie od canonical', () => {
    // Adresy slownikow schema.org / sitemaps.org sa zewnetrzne z definicji.
    const external = /^https?:\/\/(www\.)?(schema\.org|sitemaps\.org)/;
    const urls = [html, robots, sitemap]
      .flatMap((file) => file.match(/https?:\/\/[^\s"'<>]+/g) ?? [])
      .filter((url) => !external.test(url));

    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) expect(url.startsWith(canonical), url).toBe(true);
  });
});
