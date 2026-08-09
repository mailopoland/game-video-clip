import beatmapJson from './data/beatmap.json';
import { validateBeatmap } from './engine/beatmap.js';
import { mountGame } from './game.js';
import { SPRITE_KEYS } from './sprites.js';
import { createFullscreenController } from './ui/fullscreen.js';
import { createPlayer, type PlayerHandle } from './ui/youtube.js';
import type { Beatmap, TimeSource } from './engine/types.js';

const root = document.querySelector<HTMLElement>('#app')!;

async function bootstrap(): Promise<void> {
  const beatmap = validateBeatmap(beatmapJson as Beatmap, SPRITE_KEYS);

  // Player powstaje dopiero wewnatrz gotowej sceny, wiec do czasu jego
  // zaladowania gra widzi czas 0 w stanie zamrozonym.
  let player: PlayerHandle | null = null;
  const timeSource: TimeSource = {
    sample: () => player?.sample() ?? { timeSec: 0, playing: false, ended: false },
  };

  const game = mountGame(root, beatmap, timeSource, {
    onStart: () => player?.play(),
    getReferenceVolume: () => player?.getVolume() ?? 1,
  });
  game.ui.setStartEnabled(false);

  // Pelny ekran bierze cala ramke gry, nie iframe (ADR-0010). Gdyby YouTube
  // mimo wszystko przejal go dla siebie i nie dalo sie odzyskac — pauzujemy,
  // bo silnik zamarza tylko poza stanem PLAYING i inaczej naliczalby pudla.
  const fullscreen = createFullscreenController({
    target: game.ui.frame,
    playerHost: game.ui.playerHost,
    onChange: (active) => game.ui.setFullscreenActive(active),
    onLost: () => player?.pause(),
  });
  game.ui.enableFullscreen(() => void fullscreen.toggle());
  game.ui.setFullscreenActive(fullscreen.isActive());

  // Tryb nagrywania sciezki reki — wylacznie dev, wycinany z buildu produkcyjnego
  // przez import.meta.env.DEV (ADR-0016).
  let dev: { onFrame(): void } | undefined;
  if (import.meta.env.DEV) {
    const { mountDevRecorder } = await import('./dev/recorder.js');
    dev = mountDevRecorder({
      ui: game.ui,
      engine: game.engine,
      beatmap,
      getRate: () => player?.sample().rate ?? 1,
      setRate: (rate) => player?.setPlaybackRate(rate),
      getAvailableRates: () => player?.getAvailablePlaybackRates() ?? [],
    });
  }

  const loop = (): void => {
    game.frame();
    dev?.onFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const host = document.createElement('div');
  game.ui.playerHost.append(host);
  player = await createPlayer(host, beatmap.videoId);
  game.ui.setStartEnabled(true);
}

bootstrap().catch((error: unknown) => {
  root.textContent = `Nie udalo sie uruchomic gry: ${(error as Error).message}`;
});
