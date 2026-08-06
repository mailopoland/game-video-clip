/**
 * Rejestr sprite'ow — jedyne miejsce w kodzie, ktore zna assety (ADR-0005).
 *
 * Podmiana placeholdera na prawdziwy asset = zmiana jednej linii tutaj:
 *   star: { kind: 'image', src: '/sprites/star.webp' }
 * Renderer nie wymaga zadnych zmian. Preferowany format docelowy: animowany
 * WebP (pelna alfa, mniejsza waga niz GIF); GIF tez zadziala bez zmian w kodzie.
 */
export type Sprite = { kind: 'css'; className: string } | { kind: 'image'; src: string };

export const SPRITES: Record<string, Sprite> = {
  circle: { kind: 'css', className: 'sprite-circle' },
  star: { kind: 'css', className: 'sprite-star' },
  diamond: { kind: 'css', className: 'sprite-diamond' },
};

export const SPRITE_KEYS = Object.keys(SPRITES);
