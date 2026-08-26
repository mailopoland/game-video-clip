import beatmapJson from './data/beatmap.json';
import { validateBeatmap } from './engine/beatmap.js';
import { mountGame } from './game.js';
import { SPRITE_KEYS } from './sprites.js';
import { createPlayer, type PlayerHandle } from './ui/youtube.js';
import type { Beatmap, TimeSource } from './engine/types.js';
import type { DevHandEditorHandle } from './dev/hand-editor.js';
import { createTelemetry, type Telemetry } from './telemetry/telemetry.js';

const root = document.querySelector<HTMLElement>('#app')!;

/**
 * Telemetria (ADR-0026) jest AKTYWNA wylacznie w buildzie produkcyjnym —
 * `npm run dev` nie wysyla nic, wiec nagrywanie beatmapy nie zasmieca
 * statystyk.
 *
 * Bramka jest RUNTIME'owa (`import.meta.env.PROD`), a import statyczny —
 * celowo, w odroznieniu od `src/dev/*`, ktore jest wycinane dynamicznym
 * importem (ADR-0016). Osobny chunk oznaczalby, ze start gry czeka na
 * zadanie sieciowe o sciezce zawierajacej „telemetry" — czyli na cos, co
 * filtry blokerow tresci lapia wprost. Przegrany wyscig gubilby `gate_click`,
 * a razem z nim `play_start` i caly lejek. Doklejone do glownego chunka
 * ~2 kB (0,7 kB po gzipie) nie da sie zablokowac bez zablokowania calej gry.
 *
 * Nigdy nie rzuca: gdyby cokolwiek tu zawiodlo, gra ma ruszyc tak samo jak
 * przy zablokowanym zapytaniu.
 */
function startTelemetry(): Telemetry | undefined {
  if (!import.meta.env.PROD) return undefined;
  try {
    const telemetry = createTelemetry();
    telemetry.visit();
    // `pagehide`, nie `unload`: `unload` bywa pomijany przez bfcache (iOS),
    // a `pagehide` leci takze przy przejsciu karty w tlo.
    window.addEventListener('pagehide', () => telemetry.pageHide());
    return telemetry;
  } catch {
    return undefined;
  }
}

async function bootstrap(): Promise<void> {
  const beatmap = validateBeatmap(beatmapJson as Beatmap, SPRITE_KEYS);

  const telemetry = startTelemetry();

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
    onStart: () => {
      telemetry?.gateClick();
      player?.play();
    },
    getReferenceVolume: () => player?.getVolume() ?? 1,
    // Poza produkcja `onFrame` w ogole nie istnieje — zero pracy na klatke.
    onFrame: telemetry && ((view) => telemetry.frame(view)),
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
    seekTo: (sec) => {
      // Jedyne zrodlo przewiniec w produkcji: suwak transportu i PLAY AGAIN
      // (tryb dev jest wyciety z buildu). Stad flaga `seeked` bez zadnych
      // heurystyk na skokach `timeSec` — patrz ADR-0026.
      telemetry?.seek(sec);
      player?.seekTo(sec);
    },
    getDuration: () => player?.getDuration() ?? 0,
    isMuted: () => player?.isMuted() ?? false,
    setMuted: (muted) => player?.setMuted(muted),
  });
}

bootstrap().catch((error: unknown) => {
  root.textContent = `Nie udalo sie uruchomic gry: ${(error as Error).message}`;
});
