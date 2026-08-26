import type { TimeSample, TimeSource } from '../engine/types.js';

/** Stany odtwarzacza wg IFrame Player API. */
const PLAYING = 1;
const ENDED = 0;

interface YtPlayer {
  getCurrentTime(): number;
  getPlayerState(): number;
  getVolume(): number;
  isMuted(): boolean;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  playVideo(): void;
  pauseVideo(): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  getDuration(): number;
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

/**
 * O ile `getDuration()` moze sie roznic od dlugosci z beatmapy, zeby nadal
 * uchodzic za wlasciwy film. YouTube potrafi zwrocic wartosc zaokraglona
 * inaczej niz podana w beatmapie — reklamy roznia sie o dziesiatki sekund,
 * wiec margines jest hojny celowo: falszywe "to reklama" zamraza gre przy
 * lecacym filmie, a falszywe "to film" kosztuje tylko chwile rak nad reklama.
 * Przy `videoDurationSec: 150` (2:30) progiem jest 148 s, czyli 2:28.
 */
const AD_DURATION_TOLERANCE_SEC = 2;

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
  /** Absolutne przewiniecie — pasek transportu (ADR-0019). */
  seekTo(sec: number): void;
  /** Dlugosc wideo w sekundach; `0` do czasu, gdy YouTube dostarczy metadane. */
  getDuration(): number;
  isMuted(): boolean;
  /** `false` odcisza i ustawia glosnosc na 100% (ADR-0019). */
  setMuted(muted: boolean): void;
}

/**
 * Adapter miedzy IFrame Player API a `TimeSource` silnika (ADR-0003).
 * To jedyne miejsce w projekcie, ktore wie o istnieniu YouTube.
 */
export async function createPlayer(
  host: HTMLElement,
  videoId: string,
  /** Dlugosc filmu z beatmapy — odniesienie do wykrywania reklam (ADR-0022). */
  expectedDurationSec?: number,
): Promise<PlayerHandle> {
  const YT = await loadApi();

  const player = await new Promise<YtPlayer>((resolve) => {
    const instance = new YT.Player(host, {
      videoId,
      // fs: 0 usuwa przycisk pelnego ekranu YouTube. Rozszerzalby sam iframe,
      // ktory w top layer zaslonilby cala warstwe gry (ADR-0010) — pelny ekran
      // obsluguje wlasny przycisk w HUD.
      // controls: 0 i disablekb: 1 wylaczaja wlasne kontrolki playera —
      // klik w kadr obok celu psul rozgrywke (kontrolki YT + pauza na dotyku).
      // Sterowanie przenosi sie w calosci do paska transportu pod scena
      // (ADR-0019).
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, fs: 0, controls: 0, disablekb: 1 },
      events: { onReady: () => resolve(instance) },
    });
  });

  const expected =
    expectedDurationSec !== undefined && Number.isFinite(expectedDurationSec) && expectedDurationSec > 0
      ? expectedDurationSec
      : 0;

  if (expected === 0) {
    // Bez odniesienia nie da sie odroznic reklamy od filmu — wypisujemy
    // aktualna dlugosc, zeby dalo sie ja wpisac do beatmapy bez zgadywania.
    console.warn(
      `Beatmapa nie ma videoDurationSec — wykrywanie reklam wylaczone. ` +
        `Dlugosc wg playera: ${player.getDuration()} s (ADR-0022).`,
    );
  }

  /**
   * W trakcie reklamy `getDuration()` zwraca dlugosc kreacji, a nie filmu —
   * to jedyny sygnal reklamy dostepny w IFrame API (ADR-0022). `0` oznacza
   * brak metadanych, nie reklame.
   */
  const isAd = (): boolean => {
    if (expected === 0) return false;
    const duration = player.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return false;
    return Math.abs(duration - expected) > AD_DURATION_TOLERANCE_SEC;
  };

  /** Ostatni czas *tresci* — reklama ma wlasny zegar, ktorego silnik nie moze zobaczyc. */
  let lastContentTimeSec = 0;

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
    seekTo: (sec) => player.seekTo(sec, true),
    // Dlugosc z beatmapy ma pierwszenstwo: inaczej suwak transportu skakalby
    // do dlugosci reklamy i wracal (ADR-0022).
    getDuration: () => (expected > 0 ? expected : player.getDuration()),
    isMuted: () => player.isMuted(),
    setMuted: (muted) => {
      if (muted) {
        player.mute();
      } else {
        player.unMute();
        player.setVolume(100);
      }
    },
    sample: (): TimeSample => {
      const state = player.getPlayerState();

      if (isAd()) {
        // Reklama to dla API zwykle PLAYING. Meldujemy zamrozenie (silnik nie
        // spawnuje ani nie ocenia niczego) i **ostatni czas tresci** — podanie
        // czasu reklamy zresynchronizowaloby silnik do zera i przy mid-rollu
        // skasowalo dotychczasowe wyniki (ADR-0022).
        return { timeSec: lastContentTimeSec, playing: false, ended: false, rate: 1 };
      }

      lastContentTimeSec = player.getCurrentTime();
      return {
        timeSec: lastContentTimeSec,
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
