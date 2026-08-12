/**
 * Dzwiek trafienia. Sciezka glowna to **Web Audio na zdekodowanym buforze**
 * (`AudioBufferSourceNode` -> `GainNode`), nie `HTMLAudioElement` — ADR-0017.
 * Powod: iOS/WebKit utrzymuje sesje audio dla jednego elementu medialnego naraz,
 * wiec gdy rusza `<video>` YouTube'a, kazdy nasz `<audio>` milknie. Web Audio nie
 * jest elementem medialnym, wiec wspolistnieje z odtwarzanym wideo i pozwala na
 * wzmocnienie powyzej 1.0, ktorego `HTMLAudioElement.volume` fizycznie nie umie.
 *
 * Pula `<audio>` zostaje jako **droga zapasowa** dla srodowisk bez Web Audio
 * (jsdom w testach, stare przegladarki). Pula, a nie jeden element, bo restart
 * przez `currentTime = 0` ucinalby poprzedni klaps przy dwoch szybkich trafieniach.
 */
export interface HitSound {
  /**
   * Wolane w obrebie gestu uzytkownika („Graj"): startuje `AudioContext`
   * (rodzi sie `suspended`) i pobiera + dekoduje plik do `AudioBuffer`.
   * Odblokowuje tez pule zapasowa, na wypadek gdyby dekodowanie zawiodlo.
   */
  unlock(): void;
  /** Odtwarza klaps: nowy `AudioBufferSourceNode`, a bez niego kolejny element puli. */
  play(): void;
  /**
   * Jednolinijkowy opis stanu sciezki dzwieku — do diagnostyki na urzadzeniach
   * bez dostepu do devtoolsow (iOS: Chrome i Brave to WKWebView bez konsoli).
   * Konsumentem jest guzik „Test dzwieku" w pasku trybu dev.
   */
  describe(): string;
}

/**
 * Wzmocnienie glosnosci wzgledem `getReferenceVolume() === 1` (ADR-0013).
 * Na sciezce buforowej dziala naprawde (GainNode nie ma pulapu 1.0); na drodze
 * zapasowej jest przycinane do 1.0 przez `HTMLAudioElement.volume`.
 */
const LOUDNESS_BOOST = 2;

export interface HitSoundOptions {
  /** Rozmiar puli zapasowej `<audio>`. */
  size?: number;
  /** Fabryka elementu puli zapasowej — podmieniana w testach. */
  make?: (src: string) => HTMLAudioElement;
  /** Aktualna glosnosc playera, 0–1 (ADR-0013). */
  getReferenceVolume?: () => number;
  /** Fabryka `AudioContext` — `null` wymusza droge zapasowa. Podmieniana w testach. */
  createContext?: () => AudioContext | null;
  /** Pobranie pliku do dekodowania — podmieniane w testach. */
  fetchBuffer?: (src: string) => Promise<ArrayBuffer>;
  /** Wzmocnienie ponad `getReferenceVolume()`; domyslnie `LOUDNESS_BOOST`. */
  boost?: number;
}

function defaultContext(): AudioContext | null {
  const Ctor =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

export function createHitSound(src: string, options: HitSoundOptions = {}): HitSound {
  const size = options.size ?? 4;
  const make = options.make ?? ((s: string) => new Audio(s));
  const getReferenceVolume = options.getReferenceVolume ?? (() => 1);
  const createContext = options.createContext ?? defaultContext;
  const fetchBuffer =
    options.fetchBuffer ?? ((s: string) => fetch(s).then((response) => response.arrayBuffer()));
  const boost = options.boost ?? LOUDNESS_BOOST;

  const pool: HTMLAudioElement[] = [];
  for (let i = 0; i < size; i++) {
    const el = make(src);
    el.preload = 'auto';
    el.volume = 1;
    pool.push(el);
  }

  let next = 0;
  let unlockAttempted = false;
  let context: AudioContext | null = null;
  let buffer: AudioBuffer | null = null;

  // Stan wylacznie do diagnostyki (`describe()`), nie wplywa na odtwarzanie.
  let unlocked = 0;
  let lastError: string | null = null;
  let lastPlayed: HTMLAudioElement | null = null;
  let bufferPlays = 0;

  /** Wzmocniona glosnosc; ujemna referencja traktowana jak cisza. */
  function gainValue(): number {
    return Math.max(0, getReferenceVolume()) * boost;
  }

  function startAudioGraph(): void {
    let ctx: AudioContext | null;
    try {
      ctx = createContext();
    } catch (error) {
      lastError = `ctx: ${String(error)}`;
      return;
    }
    if (!ctx) return;
    context = ctx;
    // Kontekst rodzi sie `suspended` — `resume()` przechodzi tylko w gescie.
    if (ctx.state === 'suspended') void ctx.resume();

    fetchBuffer(src)
      .then((data) => ctx.decodeAudioData(data))
      .then((decoded) => {
        buffer = decoded;
      })
      .catch((error: unknown) => {
        // Bez bufora zostaje droga zapasowa przez pule <audio>.
        buffer = null;
        lastError = `dekod: ${String(error)}`;
      });
  }

  /** Odblokowanie puli zapasowej — patrz ADR-0011; uzywane tylko gdy brak bufora. */
  function unlockPool(): void {
    for (const el of pool) {
      el.muted = true;
      try {
        // pause()/currentTime dopiero po ustabilizowaniu play() — wywolanie
        // pause() zanim przegladarka zdazyla faktycznie ruszyc odtwarzanie
        // przerywa `play()` bledem, ktory na czesci przegladarek (Safari)
        // liczy sie jako niedokonczone odblokowanie elementu.
        el.play()
          ?.then(() => {
            el.pause();
            el.currentTime = 0;
            el.muted = false;
            unlocked += 1;
          })
          .catch((error: unknown) => {
            el.muted = false;
            lastError = `unlock: ${String(error)}`;
          });
      } catch (error) {
        // Srodowiska bez pelnej implementacji HTMLMediaElement (np. testy) nie maja play().
        el.muted = false;
        lastError = `unlock: ${String(error)}`;
      }
    }
  }

  function playFromBuffer(): boolean {
    if (!context || !buffer) return false;
    try {
      // Nowy source na kazde trafienie — `AudioBufferSourceNode` jest
      // jednorazowy z definicji, wiec nakladanie sie klapsow jest darmowe
      // i pula przestaje byc do czegokolwiek potrzebna.
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = gainValue();
      source.connect(gain);
      gain.connect(context.destination);
      source.start();
      bufferPlays += 1;
      return true;
    } catch (error) {
      lastError = `buffer: ${String(error)}`;
      return false;
    }
  }

  function playFromPool(): void {
    const el = pool[next]!;
    next = (next + 1) % pool.length;
    lastPlayed = el;
    el.currentTime = 0;
    // Bez Web Audio nie da sie przekroczyc 1.0 — proporcja wzgledem youtube
    // dziala, ale bez wzmocnienia ponad naturalny poziom pliku.
    el.volume = Math.min(1, Math.max(0, getReferenceVolume()));

    try {
      el.play()?.catch((error: unknown) => {
        lastError = `play: ${String(error)}`;
        console.warn('Dzwiek trafienia nie odtworzyl sie.', error);
      });
    } catch (error) {
      lastError = `play: ${String(error)}`;
      console.warn('Dzwiek trafienia nie odtworzyl sie.', error);
    }
  }

  return {
    unlock(): void {
      if (unlockAttempted) return;
      unlockAttempted = true;
      startAudioGraph();
      unlockPool();
    },
    play(): void {
      if (playFromBuffer()) return;
      playFromPool();
    },
    describe(): string {
      const el = lastPlayed;
      return [
        `tryb=${buffer ? 'bufor' : 'pula'}`,
        `ctx=${context ? context.state : 'brak'}`,
        `gain=${gainValue().toFixed(2)}`,
        `bufor=${bufferPlays}`,
        `odblokowane=${unlocked}/${pool.length}`,
        `ready=${pool[0]!.readyState}`,
        `t=${el ? el.currentTime.toFixed(2) : '-'}`,
        `paused=${el ? String(el.paused) : '-'}`,
        `vol=${el ? el.volume.toFixed(2) : '-'}`,
        `blad=${lastError ?? 'brak'}`,
      ].join(' ');
    },
  };
}
