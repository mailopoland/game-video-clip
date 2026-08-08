/**
 * Rejestr sprite'ow — jedyne miejsce w kodzie, ktore zna assety (ADR-0005).
 *
 * Podmiana obrazka = zmiana jednej linii tutaj, renderer nie wymaga zadnych zmian.
 * Sciezki licza sie od import.meta.env.BASE_URL, bo GitHub Pages serwuje spod
 * podsciezki /game-video-clip/ (ADR-0007) — plik w public/sprites/ musi byc
 * znaleziony niezaleznie od tego, czy odpalamy dev server (BASE_URL === '/') czy
 * build produkcyjny.
 *
 * Wariant `image` ma opcjonalne `hitSrc` — grafike pokazywana wylacznie w stanie
 * `outcome === 'hit'` (ADR-0011). `miss` nie zmienia grafiki, wiec to jedyny
 * dodatkowy stan wizualny, jakiego wymaga maszyna stanow celu.
 */
export type Sprite =
  | { kind: 'css'; className: string }
  | { kind: 'image'; src: string; hitSrc?: string };

const asset = (file: string) => `${import.meta.env.BASE_URL}sprites/${file}`;

export const SPRITES: Record<string, Sprite> = {
  hand: { kind: 'image', src: asset('hand-idle.gif'), hitSrc: asset('hand-hit.gif') },
};

export const SPRITE_KEYS = Object.keys(SPRITES);

/** Sciezka dzwieku trafienia (ADR-0011) — liczona tak samo od BASE_URL jak sprite'y. */
export const HIT_SOUND_SRC = `${import.meta.env.BASE_URL}sounds/clap.mp3`;
