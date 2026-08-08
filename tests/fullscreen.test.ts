// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFullscreenController } from '../src/ui/fullscreen.js';

/**
 * jsdom nie implementuje Fullscreen API w ogole, wiec podstawiamy minimalna,
 * wierna atrapa: `requestFullscreen` ustawia `document.fullscreenElement`
 * i emituje `fullscreenchange` — dokladnie tak, jak robi to przegladarka.
 */
class FakeFullscreen {
  element: Element | null = null;
  /** Elementy, ktorym `requestFullscreen` ma odmowic (brak gestu uzytkownika). */
  denied = new Set<Element>();
  requests: Element[] = [];
  exits = 0;

  install(doc: Document): void {
    Object.defineProperty(doc, 'fullscreenElement', {
      configurable: true,
      get: () => this.element,
    });
    Object.defineProperty(doc, 'fullscreenEnabled', { configurable: true, value: true });
    doc.exitFullscreen = () => {
      this.exits++;
      return this.set(doc, null);
    };
    // Konstruktor Element jsdom jest wspolny dla calego dokumentu.
    (doc.defaultView!.Element.prototype as Element & { requestFullscreen(): Promise<void> })
      .requestFullscreen = function (this: Element) {
      const fs = fakeFullscreen;
      fs.requests.push(this);
      if (fs.denied.has(this)) return Promise.reject(new Error('permissions check failed'));
      return fs.set(doc, this);
    };
  }

  /** Symuluje przejscie w pelny ekran wywolane z wnetrza iframe'a (przycisk YT). */
  hijack(doc: Document, iframe: Element): Promise<void> {
    return this.set(doc, iframe);
  }

  private set(doc: Document, element: Element | null): Promise<void> {
    this.element = element;
    doc.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  }
}

let fakeFullscreen: FakeFullscreen;

function buildDom(): { frame: HTMLElement; player: HTMLElement; iframe: HTMLElement } {
  document.body.innerHTML = `
    <div id="frame">
      <div id="stage"><div id="player"><iframe id="yt"></iframe></div></div>
      <div id="hud"></div>
    </div>`;
  return {
    frame: document.querySelector<HTMLElement>('#frame')!,
    player: document.querySelector<HTMLElement>('#player')!,
    iframe: document.querySelector<HTMLElement>('#yt')!,
  };
}

describe('kontroler pelnego ekranu', () => {
  beforeEach(() => {
    fakeFullscreen = new FakeFullscreen();
    fakeFullscreen.install(document);
  });

  it('rozszerza cala ramke gry, a nie sam odtwarzacz', async () => {
    const { frame, player } = buildDom();
    const fs = createFullscreenController({ target: frame, playerHost: player });

    await fs.toggle();

    expect(fakeFullscreen.requests).toEqual([frame]);
    expect(fs.isActive()).toBe(true);
  });

  it('drugie wywolanie toggle wychodzi z pelnego ekranu', async () => {
    const { frame, player } = buildDom();
    const fs = createFullscreenController({ target: frame, playerHost: player });

    await fs.toggle();
    await fs.toggle();

    expect(fakeFullscreen.exits).toBe(1);
    expect(fs.isActive()).toBe(false);
  });

  it('odbiera pelny ekran, gdy przejmie go iframe YouTube', async () => {
    const { frame, player, iframe } = buildDom();
    const onLost = vi.fn();
    createFullscreenController({ target: frame, playerHost: player, onLost });

    await fakeFullscreen.hijack(document, iframe);
    await vi.waitFor(() => expect(fakeFullscreen.element).toBe(frame));

    expect(fakeFullscreen.exits).toBe(1);
    expect(fakeFullscreen.requests).toEqual([frame]);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('gdy odzyskanie pelnego ekranu sie nie uda, zglasza utrate warstwy gry', async () => {
    const { frame, player, iframe } = buildDom();
    const onLost = vi.fn();
    fakeFullscreen.denied.add(frame);
    createFullscreenController({ target: frame, playerHost: player, onLost });

    await fakeFullscreen.hijack(document, iframe);
    await vi.waitFor(() => expect(onLost).toHaveBeenCalledTimes(1));
  });

  it('raportuje zmiane stanu, takze przy wyjsciu klawiszem Esc', async () => {
    const { frame, player } = buildDom();
    const onChange = vi.fn();
    createFullscreenController({ target: frame, playerHost: player, onChange });

    await frame.requestFullscreen();
    expect(onChange).toHaveBeenLastCalledWith(true);

    await document.exitFullscreen();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('w trybie natywnym raportuje mode "native"', () => {
    const { frame, player } = buildDom();
    expect(createFullscreenController({ target: frame, playerHost: player }).mode).toBe('native');
  });

  describe('bez Fullscreen API (iPhone)', () => {
    beforeEach(() => {
      // @ts-expect-error celowo usuwamy API, zeby odwzorowac iPhone'a
      delete document.defaultView!.Element.prototype.requestFullscreen;
    });

    it('przechodzi w zastepczy tryb CSS zamiast chowac funkcje', async () => {
      const { frame, player } = buildDom();
      const onChange = vi.fn();
      const fs = createFullscreenController({ target: frame, playerHost: player, onChange });

      expect(fs.mode).toBe('css');
      expect(fs.isActive()).toBe(false);

      await fs.toggle();

      expect(fs.isActive()).toBe(true);
      expect(frame.classList.contains('is-pseudo-fullscreen')).toBe(true);
      // Tlo nie moze sie przewijac pod rozpychana ramka.
      expect(document.documentElement.classList.contains('has-pseudo-fullscreen')).toBe(true);
      expect(onChange).toHaveBeenLastCalledWith(true);
    });

    it('drugie wywolanie toggle wraca do widoku okna', async () => {
      const { frame, player } = buildDom();
      const fs = createFullscreenController({ target: frame, playerHost: player });

      await fs.toggle();
      await fs.toggle();

      expect(fs.isActive()).toBe(false);
      expect(frame.classList.contains('is-pseudo-fullscreen')).toBe(false);
      expect(document.documentElement.classList.contains('has-pseudo-fullscreen')).toBe(false);
    });
  });
});
