import type { TimeSample, TimeSource } from '../engine/types.js';

/** Stany odtwarzacza wg IFrame Player API. */
const PLAYING = 1;
const ENDED = 0;

interface YtPlayer {
  getCurrentTime(): number;
  getPlayerState(): number;
  getVolume(): number;
  isMuted(): boolean;
  playVideo(): void;
  pauseVideo(): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}

interface YtNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, number>;
      events: { onReady: () => void };
    },
  ) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_URL = 'https://www.youtube.com/iframe_api';

function loadApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const script = document.createElement('script');
    script.src = API_URL;
    document.head.append(script);
  });
}

export interface PlayerHandle extends TimeSource {
  /** Musi byc wolane z gestu uzytkownika — autoplay z dzwiekiem jest blokowany. */
  play(): void;
  /** Awaryjne zatrzymanie: pauza zamraza silnik, wiec nic nie jest oceniane. */
  pause(): void;
  /** Aktualna glosnosc playera, 0–1. 0, gdy wyciszony (ADR-0013). */
  getVolume(): number;
  /** Trybu deweloperskiego: zmiana tempa odtwarzania (ADR-0016). */
  setPlaybackRate(rate: number): void;
  /** Trybu deweloperskiego: lista temp dostepnych dla biezacego wideo. */
  getAvailablePlaybackRates(): number[];
  /** Trybu deweloperskiego: przesuniecie czasu wideo o `deltaSec` (moze byc ujemne). */
  seekBy(deltaSec: number): void;
}

/**
 * Adapter miedzy IFrame Player API a `TimeSource` silnika (ADR-0003).
 * To jedyne miejsce w projekcie, ktore wie o istnieniu YouTube.
 */
export async function createPlayer(host: HTMLElement, videoId: string): Promise<PlayerHandle> {
  const YT = await loadApi();

  const player = await new Promise<YtPlayer>((resolve) => {
    const instance = new YT.Player(host, {
      videoId,
      // fs: 0 usuwa przycisk pelnego ekranu YouTube. Rozszerzalby sam iframe,
      // ktory w top layer zaslonilby cala warstwe gry (ADR-0010) — pelny ekran
      // obsluguje wlasny przycisk w HUD.
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0 },
      events: { onReady: () => resolve(instance) },
    });
  });

  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    getVolume: () => (player.isMuted() ? 0 : player.getVolume() / 100),
    setPlaybackRate: (rate) => player.setPlaybackRate(rate),
    getAvailablePlaybackRates: () => player.getAvailablePlaybackRates(),
    seekBy: (deltaSec) => {
      const wasPlaying = player.getPlayerState() === PLAYING;
      player.seekTo(player.getCurrentTime() + deltaSec, true);
      // Na pauzie samo seekTo() nie odswieza wyswietlanej klatki (znany
      // quirk IFrame API) — krotkie playVideo()/pauseVideo() wymusza
      // przemalowanie bez wznawiania odtwarzania.
      if (!wasPlaying) {
        player.playVideo();
        player.pauseVideo();
      }
    },
    sample: (): TimeSample => {
      const state = player.getPlayerState();
      return {
        timeSec: player.getCurrentTime(),
        // PLAYING to jedyny stan, w ktorym czas gry plynie. Buffering, pauza,
        // cued i ended zamrazaja gre (wymaganie #5).
        playing: state === PLAYING,
        ended: state === ENDED,
        // Odczytywane co klatke (bez cache'a), zeby reset tempa po reklamie
        // czy zmianie z menu playera byl widoczny natychmiast (ADR-0016).
        rate: player.getPlaybackRate(),
      };
    },
  };
}
