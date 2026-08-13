import { validateBeatmap } from '../engine/beatmap.js';
import { SPRITE_KEYS } from '../sprites.js';
import { computeDragResize, distancePercent, formatClock, toOverlayPercent, updatePathPoint } from './record.js';
import type { BeatmapStore } from './beatmap-store.js';
import type { Engine } from '../engine/engine.js';
import type { Ui } from '../ui/render.js';
import type { Beatmap } from '../engine/types.js';

export interface DevHandEditorHandle {
  /** Wolane z petli rAF, po `game.frame()`. */
  onFrame(): void;
  /** Programowe wylaczenie trybu dev: odznacza checkbox, czysci zaznaczenie/drag,
      chowa panel. Idempotentne. */
  deactivate(): void;
  /** Ustawia `checkbox.disabled` — blokuje wlaczenie trybu dev z UI. */
  setDisabled(disabled: boolean): void;
}

/**
 * Tryb deweloperski edycji punktow sciezki juz nagranego obiektu: wybor
 * obiektu, klik na punkt w panelu -> seek, przeciagniecie reki -> zmiana
 * pozycji punktu, przeciagniecie uchwytu -> zmiana rozmiaru. Dziala wylacznie
 * przy zamrozonym silniku (pauza).
 */
export function mountDevHandEditor(options: {
  ui: Ui;
  engine: Engine;
  store: BeatmapStore;
  seekBy: (deltaSec: number) => void;
  pause: () => void;
  onActiveChange?: (active: boolean) => void;
}): DevHandEditorHandle {
  const { ui, engine, store } = options;

  let active = false;
  let selectedObjectId: string | null = null;
  let selectedPointIndex: number | null = null;
  let dragMode: 'move' | 'resize' | null = null;
  let dragCenter = { x: 0, y: 0 };
  let dragInitialDistance = 0;
  let dragInitialSize = 0;
  let capturedPointerId: number | null = null;
  let dirty = false;
  let persistInFlight = false;

  const bar = document.createElement('div');
  bar.className = 'dev-bar';
  bar.innerHTML = `
    <label class="dev-toggle">
      <input type="checkbox" id="dev-edit-hand-toggle" />
      Developer: edycja punktow sciezki
    </label>
    <span class="dev-status" id="dev-edit-hand-status"></span>
  `;
  ui.frame.append(bar);

  const checkbox = bar.querySelector<HTMLInputElement>('#dev-edit-hand-toggle')!;
  const status = bar.querySelector<HTMLElement>('#dev-edit-hand-status')!;

  const panel = document.createElement('aside');
  panel.className = 'dev-edit-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <h2>Sciezka: <span class="dev-edit-panel-object"></span></h2>
    <ol class="dev-edit-panel-points"></ol>
  `;
  const panelObjectLabel = panel.querySelector<HTMLElement>('.dev-edit-panel-object')!;
  const panelPoints = panel.querySelector<HTMLOListElement>('.dev-edit-panel-points')!;

  const parent = ui.frame.parentElement!;
  const layout = document.createElement('div');
  layout.className = 'dev-edit-layout';
  parent.insertBefore(layout, ui.frame);
  layout.append(ui.frame, panel);

  const timeDisplay = document.createElement('div');
  timeDisplay.className = 'dev-time-display';
  timeDisplay.hidden = true;
  ui.frame.insertBefore(timeDisplay, ui.stage);

  function setStatus(text: string): void {
    status.textContent = text;
  }

  function currentBeatmap(): Beatmap {
    return store.get();
  }

  function selectedObject() {
    if (!selectedObjectId) return null;
    return currentBeatmap().objects.find((o) => o.id === selectedObjectId) ?? null;
  }

  function rebuildPanel(): void {
    const object = selectedObject();
    if (!active || !object) {
      panel.hidden = true;
      panelPoints.innerHTML = '';
      panelObjectLabel.textContent = '';
      return;
    }

    panel.hidden = false;
    panelObjectLabel.textContent = object.id;
    panelPoints.innerHTML = '';
    object.path.forEach((point, index) => {
      const li = document.createElement('li');
      li.className = 'dev-edit-point';
      li.dataset.index = String(index);
      if (index === selectedPointIndex) li.classList.add('is-selected');

      const seekButton = document.createElement('button');
      seekButton.type = 'button';
      seekButton.className = 'dev-edit-point-seek';
      seekButton.textContent = `#${index}`;
      seekButton.addEventListener('click', () => selectPoint(index));
      li.append(seekButton);

      (['t', 'x', 'y', 'size'] as const).forEach((field) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = `dev-edit-point-field dev-edit-point-${field}`;
        input.step = field === 't' ? '0.001' : field === 'size' ? '1' : '0.1';
        input.value = String(point[field]);
        input.addEventListener('change', () => {
          const value = input.valueAsNumber;
          if (Number.isNaN(value)) {
            input.value = String(selectedObject()?.path[index]?.[field] ?? point[field]);
            return;
          }
          applyPointPatchAt(index, { [field]: value });
        });
        li.append(input);
      });

      panelPoints.append(li);
    });
  }

  function refreshPointRow(index: number): void {
    const object = selectedObject();
    const point = object?.path[index];
    if (!point) return;
    const li = panelPoints.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!li) return;
    (['t', 'x', 'y', 'size'] as const).forEach((field) => {
      const input = li.querySelector<HTMLInputElement>(`.dev-edit-point-${field}`);
      if (input && document.activeElement !== input) input.value = String(point[field]);
    });
  }

  function clearRing(): void {
    ui.setHandSelection(null);
  }

  function deselect(): void {
    selectedObjectId = null;
    selectedPointIndex = null;
    rebuildPanel();
    clearRing();
  }

  function releaseCapture(): void {
    if (capturedPointerId === null) return;
    try {
      ui.stage.releasePointerCapture(capturedPointerId);
    } catch {
      // jsdom / brak wsparcia — bez znaczenia dla logiki.
    }
    capturedPointerId = null;
  }

  function endDrag(): void {
    dragMode = null;
    releaseCapture();
  }

  function setActive(nextActive: boolean): void {
    active = nextActive;
    ui.overlay.classList.toggle('dev-active', active);
    timeDisplay.hidden = !active;
    if (active) {
      // Odswiezenie z magazynu — dogania zmiany zrobione w innym trybie dev.
      selectedObjectId = null;
      selectedPointIndex = null;
      options.pause();
    } else {
      endDrag();
      deselect();
    }
    rebuildPanel();
    options.onActiveChange?.(active);
  }

  checkbox.addEventListener('change', () => {
    setActive(checkbox.checked);
  });

  function persist(): void {
    if (!dirty || persistInFlight) return;
    const snapshot = store.get();
    persistInFlight = true;
    dirty = false;
    setStatus('Zapisywanie…');
    fetch('/__beatmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setStatus('Zapisano.');
      })
      .catch((error: unknown) => {
        console.error('Zapis beatmapy nie powiodl sie:', error);
        setStatus(`Blad zapisu: ${(error as Error).message}`);
      })
      .finally(() => {
        persistInFlight = false;
      });
  }

  function applyPointPatchAt(index: number, patch: { t?: number; x?: number; y?: number; size?: number }): void {
    if (!selectedObjectId) return;
    const beatmap = currentBeatmap();
    const updated = updatePathPoint(beatmap, selectedObjectId, index, patch);
    if (updated === beatmap) return;

    try {
      validateBeatmap(updated, SPRITE_KEYS);
    } catch (error) {
      setStatus(`Blad: ${(error as Error).message}`);
      refreshPointRow(index);
      return;
    }

    store.set(updated);
    engine.setObjects(updated.objects);
    dirty = true;
    refreshPointRow(index);
  }

  function applyPointPatch(patch: { x?: number; y?: number; size?: number }): void {
    if (selectedPointIndex === null) return;
    applyPointPatchAt(selectedPointIndex, patch);
  }

  function selectPoint(index: number): void {
    const object = selectedObject();
    const point = object?.path[index];
    if (!point) return;
    selectedPointIndex = index;
    options.seekBy(point.t - engine.getView().timeSec);
    rebuildPanel();
  }

  ui.stage.addEventListener('pointerdown', (event) => {
    if (!active || event.button !== 0) return;
    if (!engine.getView().frozen) return;

    const target = event.target as Element;

    const handleHit = target.closest('.dev-size-handle');
    if (handleHit) {
      if (!selectedObjectId || selectedPointIndex === null) return;
      const view = engine.getView();
      const visible = view.visible.find((v) => v.object.id === selectedObjectId);
      if (!visible) return;

      dragCenter = { x: visible.x, y: visible.y };
      dragInitialSize = visible.size;
      const rect = ui.overlay.getBoundingClientRect();
      const pos = toOverlayPercent(rect, event.clientX, event.clientY);
      dragInitialDistance = distancePercent(dragCenter, pos);
      dragMode = 'resize';
      capturedPointerId = event.pointerId;
      try {
        ui.stage.setPointerCapture(event.pointerId);
      } catch {
        // jsdom nie ma prawdziwych PointerEvent — drag i tak dziala, bo liczy
        // sie tylko pointermove.
      }
      return;
    }

    const objectHit = target.closest('.obj:not(.is-preview)');
    if (objectHit) {
      const id = (objectHit as HTMLElement).dataset.id;
      if (!id) return;

      if (id !== selectedObjectId) {
        selectedObjectId = id;
        selectedPointIndex = null;
        rebuildPanel();
        return;
      }

      if (selectedPointIndex !== null) {
        dragMode = 'move';
        capturedPointerId = event.pointerId;
        try {
          ui.stage.setPointerCapture(event.pointerId);
        } catch {
          // jsdom — bez znaczenia.
        }
      }
      return;
    }

    deselect();
  });

  ui.stage.addEventListener('pointermove', (event) => {
    if (!active || !dragMode) return;
    const rect = ui.overlay.getBoundingClientRect();
    const pos = toOverlayPercent(rect, event.clientX, event.clientY);

    if (dragMode === 'move') {
      applyPointPatch({ x: pos.x, y: pos.y });
    } else {
      const currentDistance = distancePercent(dragCenter, pos);
      const size = computeDragResize(dragInitialSize, dragInitialDistance, currentDistance);
      applyPointPatch({ size });
    }
  });

  ui.stage.addEventListener('pointerup', () => {
    if (dragMode) endDrag();
  });
  ui.stage.addEventListener('pointercancel', () => {
    if (dragMode) endDrag();
  });
  ui.stage.addEventListener('pointerleave', () => {
    if (dragMode) endDrag();
  });

  return {
    onFrame(): void {
      timeDisplay.hidden = !active;
      if (active) timeDisplay.textContent = formatClock(engine.getView().timeSec);

      if (active && selectedObjectId) {
        const visible = engine.getView().visible.find((v) => v.object.id === selectedObjectId);
        ui.setHandSelection(visible ? { x: visible.x, y: visible.y, size: visible.size } : null);
      }
      persist();
    },

    deactivate(): void {
      if (!active) return;
      checkbox.checked = false;
      setActive(false);
    },

    setDisabled(disabled: boolean): void {
      checkbox.disabled = disabled;
    },
  };
}
