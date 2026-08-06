import beatmapJson from './data/beatmap.json';
import { validateBeatmap } from './engine/beatmap.js';
import { mountGame } from './game.js';
import { SPRITE_KEYS } from './sprites.js';
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

  const game = mountGame(root, beatmap, timeSource, { onStart: () => player?.play() });
  game.ui.setStartEnabled(false);

  const loop = (): void => {
    game.frame();
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
