import { validateBeatmap } from '../engine/beatmap.js';
import { SPRITE_KEYS } from '../sprites.js';
import {
  computeDragResize,
  distancePercent,
  formatClock,
  insertPathPoint,
  MIN_PATH_POINTS,
  removePathPoint,
  toOverlayPercent,
  updatePathPoint,
} from './record.js';
import type { BeatmapStore } from './beatmap-store.js';
import type { Engine } from '../engine/engine.js';
import type { Ui } from '../ui/render.js';
import type { Beatmap, PathPoint } from '../engine/types.js';

const POINT_FIELDS = ['t', 'size', 'x', 'y'] as const;
type PointField = (typeof POINT_FIELDS)[number];
const FIELD_LABELS: Record<PointField, string> = { t: 't', size: 's', x: 'x', y: 'y' };

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
  let draftGapIndex: number | null = null;
  let draftValues: Partial<Record<PointField, number>> = {};

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

  function fieldStep(field: PointField): string {
    return field === 't' ? '0.1' : field === 'size' ? '1' : '0.1';
  }

  function renderPointRow(point: PathPoint, index: number, pointCount: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'dev-edit-point';
    li.dataset.index = String(index);
    if (index === selectedPointIndex) li.classList.add('is-selected');

    const seekButton = document.createElement('button');
    seekButton.type = 'button';
    seekButton.className = 'dev-edit-point-seek';
    seekButton.textContent = selectedObjectId ?? `#${index}`;
    seekButton.addEventListener('click', () => selectPoint(index));
    li.append(seekButton);

    POINT_FIELDS.forEach((field) => {
      const label = document.createElement('label');
      label.className = 'dev-edit-point-label';
      label.append(`${FIELD_LABELS[field]}:`);

      const input = document.createElement('input');
      input.type = 'number';
      input.className = `dev-edit-point-field dev-edit-point-${field}`;
      input.step = fieldStep(field);
      input.value = String(point[field]);
      input.addEventListener('change', () => {
        const value = input.valueAsNumber;
        if (Number.isNaN(value)) {
          input.value = String(selectedObject()?.path[index]?.[field] ?? point[field]);
          return;
        }
        applyPointPatchAt(index, { [field]: value });
      });
      label.append(input);
      li.append(label);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'dev-edit-point-delete';
    deleteButton.textContent = '−';
    deleteButton.disabled = pointCount <= MIN_PATH_POINTS;
    deleteButton.title =
      pointCount <= MIN_PATH_POINTS ? 'Sciezka musi miec co najmniej 2 punkty' : 'Usun punkt';
    deleteButton.addEventListener('click', () => deletePoint(index));
    li.append(deleteButton);

    return li;
  }

  function currentDraftDefaults(): Partial<Record<PointField, number>> {
    const timeSec = engine.getView().timeSec;
    const defaults: Partial<Record<PointField, number>> = { t: timeSec };
    if (selectedObjectId) {
      const visible = engine.getView().visible.find((v) => v.object.id === selectedObjectId);
      if (visible) {
        defaults.x = visible.x;
        defaults.y = visible.y;
        defaults.size = visible.size;
      }
    }
    return defaults;
  }

  function renderGap(gapIndex: number): HTMLElement {
    const li = document.createElement('li');
    li.className = 'dev-edit-gap';

    if (draftGapIndex === gapIndex) {
      POINT_FIELDS.forEach((field) => {
        const label = document.createElement('label');
        label.className = 'dev-edit-point-label';
        label.append(`${FIELD_LABELS[field]}:`);

        const input = document.createElement('input');
        input.type = 'number';
        input.className = `dev-edit-point-field dev-edit-point-${field}`;
        input.step = fieldStep(field);
        if (draftValues[field] !== undefined) input.value = String(draftValues[field]);
        input.addEventListener('change', () => {
          const value = input.valueAsNumber;
          if (Number.isNaN(value)) {
            delete draftValues[field];
            return;
          }
          draftValues[field] = value;
          tryCommitDraft();
        });
        label.append(input);
        li.append(label);
      });

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'dev-edit-gap-cancel';
      cancelButton.textContent = '×';
      cancelButton.title = 'Anuluj nowy punkt';
      cancelButton.addEventListener('click', () => {
        draftGapIndex = null;
        draftValues = {};
        rebuildPanel();
      });
      li.append(cancelButton);
    } else {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'dev-edit-gap-add';
      addButton.textContent = '+';
      addButton.title = 'Dodaj punkt';
      addButton.addEventListener('click', () => {
        draftGapIndex = gapIndex;
        draftValues = currentDraftDefaults();
        tryCommitDraft();
        rebuildPanel();
      });
      li.append(addButton);
    }

    return li;
  }

  function rebuildPanel(): void {
    const object = selectedObject();
    if (!active || !object) {
      panel.hidden = true;
      panelPoints.innerHTML = '';
      panelObjectLabel.textContent = '';
      draftGapIndex = null;
      draftValues = {};
      return;
    }

    panel.hidden = false;
    panelObjectLabel.textContent = object.id;
    panelPoints.innerHTML = '';
    panelPoints.append(renderGap(0));
    object.path.forEach((point, index) => {
      panelPoints.append(renderPointRow(point, index, object.path.length));
      panelPoints.append(renderGap(index + 1));
    });
  }

  function refreshPointRow(index: number): void {
    const object = selectedObject();
    const point = object?.path[index];
    if (!point) return;
    const li = panelPoints.querySelector<HTMLElement>(`.dev-edit-point[data-index="${index}"]`);
    if (!li) return;
    POINT_FIELDS.forEach((field) => {
      const input = li.querySelector<HTMLInputElement>(`.dev-edit-point-${field}`);
      if (input && document.activeElement !== input) input.value = String(point[field]);
    });
  }

  function tryCommitDraft(): void {
    if (!selectedObjectId) return;
    const { t, x, y, size } = draftValues;
    if (t === undefined || x === undefined || y === undefined || size === undefined) return;

    const beatmap = currentBeatmap();
    const updated = insertPathPoint(beatmap, selectedObjectId, { t, x, y, size });

    try {
      validateBeatmap(updated, SPRITE_KEYS);
    } catch (error) {
      setStatus(`Blad: ${(error as Error).message}`);
      return;
    }

    store.set(updated);
    engine.setObjects(updated.objects);
    dirty = true;
    draftGapIndex = null;
    draftValues = {};
    selectedPointIndex = null;
    rebuildPanel();
  }

  function deletePoint(index: number): void {
    if (!selectedObjectId) return;
    const beatmap = currentBeatmap();
    const updated = removePathPoint(beatmap, selectedObjectId, index);
    if (updated === beatmap) return;

    store.set(updated);
    engine.setObjects(updated.objects);
    dirty = true;
    if (selectedPointIndex !== null && index <= selectedPointIndex) selectedPointIndex = null;
    rebuildPanel();
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
