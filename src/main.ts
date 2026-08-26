import beatmapJson from './data/beatmap.json';
import { validateBeatmap } from './engine/beatmap.js';
import { mountGame } from './game.js';
import { SPRITE_KEYS } from './sprites.js';
import { createPlayer, type PlayerHandle } from './ui/youtube.js';
import type { Beatmap, TimeSource } from './engine/types.js';
import type { DevHandEditorHandle } from './dev/hand-editor.js';

const root = document.querySelector<HTMLElement>('#app')!;

async function bootstrap(): Promise<void> {
  const beatmap = validateBeatmap(beatmapJson as Beatmap, SPRITE_KEYS);

  // Player powstaje dopiero wewnatrz gotowej sceny, wiec do czasu jego
  // zaladowania gra widzi czas 0 w stanie zamrozonym.
  let player: PlayerHandle | null = null;
  const timeSource: TimeSource = {
    sample: () => player?.sample() ?? { timeSec: 0, playing: false, ended: false },
  };

  // Ramka gry jest zawsze zmaksymalizowana na viewport przez CSS (`.frame`,
  // ADR-0021) — nie ma tu juz nic do zrobienia, w odroznieniu od dawnego
  // requestFullscreen wymagajacego gestu uzytkownika.
  const game = mountGame(root, beatmap, timeSource, {
    onStart: () => player?.play(),
    getReferenceVolume: () => player?.getVolume() ?? 1,
  });
  game.ui.setStartEnabled(false);

  // Tryby deweloperskie (nagrywanie + edycja punktow) — wylacznie dev,
  // wycinane z buildu produkcyjnego przez import.meta.env.DEV (ADR-0016).
  // Wzajemnie wykluczajace sie: aktywacja jednego dezaktywuje i blokuje drugi.
  let dev: { onFrame(): void } | undefined;
  if (import.meta.env.DEV) {
    const { mountDevRecorder } = await import('./dev/recorder.js');
    const { mountDevHandEditor } = await import('./dev/hand-editor.js');
    const { createBeatmapStore } = await import('./dev/beatmap-store.js');
    const store = createBeatmapStore(beatmap);

    let handEditor: DevHandEditorHandle | undefined;

    const recorder = mountDevRecorder({
      ui: game.ui,
      engine: game.engine,
      store,
      getRate: () => player?.sample().rate ?? 1,
      setRate: (rate) => player?.setPlaybackRate(rate),
      getAvailableRates: () => player?.getAvailablePlaybackRates() ?? [],
      seekBy: (deltaSec) => player?.seekBy(deltaSec),
      pause: () => player?.pause(),
      play: () => player?.play(),
      playHitSound: () => game.sound.play(),
      describeHitSound: () => game.sound.describe(),
      onActiveChange: (active) => {
        if (active) handEditor?.deactivate();
        handEditor?.setDisabled(active);
      },
    });

    handEditor = mountDevHandEditor({
      ui: game.ui,
      engine: game.engine,
      store,
      seekBy: (deltaSec) => player?.seekBy(deltaSec),
      pause: () => player?.pause(),
      onActiveChange: (active) => {
        if (active) recorder.deactivate();
        recorder.setDisabled(active);
      },
    });

    dev = {
      onFrame(): void {
        recorder.onFrame();
        handEditor?.onFrame();
      },
    };
  }

  const loop = (): void => {
    game.frame();
    dev?.onFrame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const host = document.createElement('div');
  game.ui.playerHost.append(host);
  player = await createPlayer(host, beatmap.videoId, beatmap.videoDurationSec);
  game.ui.setStartEnabled(true);
  game.ui.enableTransport({
    play: () => player?.play(),
    pause: () => player?.pause(),
    seekTo: (sec) => player?.seekTo(sec),
    getDuration: () => player?.getDuration() ?? 0,
    isMuted: () => player?.isMuted() ?? false,
    setMuted: (muted) => player?.setMuted(muted),
  });
}

bootstrap().catch((error: unknown) => {
  root.textContent = `Nie udalo sie uruchomic gry: ${(error as Error).message}`;
});
