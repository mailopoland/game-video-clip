/**
 * Rejestr sprite'ow — jedyne miejsce w kodzie, ktore zna assety (ADR-0005).
 *
 * Podmiana obrazka = zmiana jednej linii tutaj, renderer nie wymaga zadnych zmian.
 * Sciezki licza sie od import.meta.env.BASE_URL, bo GitHub Pages serwuje spod
 * podsciezki /game-video-clip/ (ADR-0007) — plik w public/sprites/ musi byc
 * znaleziony niezaleznie od tego, czy odpalamy dev server (BASE_URL === '/') czy
 * build produkcyjny.
 */
export type Sprite = { kind: 'css'; className: string } | { kind: 'image'; src: string };

const asset = (file: string) => `${import.meta.env.BASE_URL}sprites/${file}`;

export const SPRITES: Record<string, Sprite> = {
  guy: { kind: 'image', src: asset('guy.webp') },
  girl: { kind: 'image', src: asset('girl.webp') },
};

export const SPRITE_KEYS = Object.keys(SPRITES);
