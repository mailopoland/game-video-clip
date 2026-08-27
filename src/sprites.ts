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
  hand: { kind: 'image', src: asset('hand-idle.png'), hitSrc: asset('hand-hit.png') },
};

export const SPRITE_KEYS = Object.keys(SPRITES);

/**
 * Sciaga do cache przegladarki wszystkie warianty graficzne z rejestru.
 * Wolane raz przy montazu UI, jeszcze przed startem odtwarzania — inaczej plik
 * jest pobierany dopiero przy pierwszym montazu obiektu, a pierwszy cel zyje
 * ~2 s: na pierwszym przebiegu widac pusty obiekt, a dlon pojawia sie dopiero
 * po przewinieciu w tyl (gdy plik jest juz w cache).
 */
export function preloadSprites(): void {
  if (typeof Image === 'undefined') return;
  for (const sprite of Object.values(SPRITES)) {
    if (sprite.kind !== 'image') continue;
    new Image().src = sprite.src;
    if (sprite.hitSrc) new Image().src = sprite.hitSrc;
  }
}

/** Sciezka dzwieku trafienia (ADR-0011) — liczona tak samo od BASE_URL jak sprite'y. */
export const HIT_SOUND_SRC = `${import.meta.env.BASE_URL}sounds/clap.mp3`;

const resultAsset = (file: string) => `${import.meta.env.BASE_URL}results/${file}`;

/**
 * Grafiki ekranu wyniku (ADR-0025). Indeks = kubelek procentowy:
 * 0 -> 0%, 1 -> 1-25%, 2 -> 26-50%, 3 -> 51-75%, 4 -> 76-99%, 5 -> 100%.
 * Kolejnosc jest kontraktem — `resultImageSrc` indeksuje ta tablice wprost.
 */
export const RESULT_IMAGES = [0, 1, 2, 3, 4, 5].map((i) => resultAsset(`score${i}.png`));

/**
 * Sciaga do cache JEDNA grafike wyniku. Wczesniej pobieranych bylo wszystkie
 * szesc (~0,5 MB) mimo ze pokazywana jest dokladnie jedna — teraz `src/game.ts`
 * wola to dopiero pod koniec klipu, dla aktualnego kubelka procentowego
 * (ADR-0027). Wywolanie z tym samym `src` co poprzednio jest po stronie
 * wolajacego, tutaj nie ma stanu.
 */
export function preloadResultImage(src: string): void {
  if (typeof Image === 'undefined') return;
  new Image().src = src;
}
