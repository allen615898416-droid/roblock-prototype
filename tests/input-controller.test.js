import assert from 'node:assert/strict';
import test from 'node:test';

import { createInputController } from '../src/input-controller.js';

function makeHarness({ modalOpen = false, scale = 1 } = {}) {
  const listeners = new Map();
  const windowListeners = new Map();
  const captured = new Set();
  const cellWidth = 38 * scale;
  const cellHeight = (267 / 7) * scale;
  const board = {
    getBoundingClientRect: () => ({
      left: 20,
      top: 40,
      width: 304 * scale,
      height: 267 * scale,
    }),
    querySelector(selector) {
      const row = Number(selector.match(/data-row="(\d+)"/)?.[1]);
      const col = Number(selector.match(/data-col="(\d+)"/)?.[1]);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
      return {
        getBoundingClientRect: () => ({
          left: 20 + col * cellWidth,
          top: 40 + row * cellHeight,
          width: cellWidth,
          height: cellHeight,
        }),
      };
    },
  };
  const button = {
    disabled: false,
    dataset: { rackSlot: '1' },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  };
  const rootClasses = new Set();
  const defaultView = {
    addEventListener: (type, fn) => windowListeners.set(type, fn),
    removeEventListener: (type) => windowListeners.delete(type),
  };
  const root = {
    ownerDocument: { defaultView },
    classList: {
      add: (name) => rootClasses.add(name),
      remove: (name) => rootClasses.delete(name),
      contains: (name) => rootClasses.has(name),
    },
    querySelector(selector) {
      if (selector === '[data-board]') return board;
      if (selector === '[aria-modal="true"]:not([hidden])') return modalOpen ? {} : null;
      if (selector === '[data-rack-slot="1"]') return button;
      return null;
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  const pieceCell = {
    dataset: { row: '1', col: '1' },
    closest(selector) {
      if (selector === '[data-rack-slot]') return button;
      if (selector === '[data-piece-cell]') return this;
      return null;
    },
  };
  return {
    root,
    board,
    button,
    pieceCell,
    listeners,
    windowListeners,
    captured,
    rootClasses,
  };
}

function pointerEvent(target, overrides = {}) {
  return {
    target,
    button: 0,
    pointerId: 7,
    clientX: 20 + 3.5 * 38,
    clientY: 40 + 4.5 * (267 / 7),
    preventDefault() {},
    ...overrides,
  };
}

test('drag uses the grabbed cell and measured DOM geometry for preview and drop', () => {
  const harness = makeHarness();
  const previews = [];
  const drops = [];
  const ghosts = [];
  const controller = createInputController({
    root: harness.root,
    getPiece: (slot) => slot === 1 ? {
      id: 'L3',
      cells: [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }],
    } : null,
    getBoardState: () => ({ rows: 7, cols: 9 }),
    tryPreview: (piece, anchor) => {
      previews.push({ piece, anchor });
      return { ok: true };
    },
    onDrop: (payload) => drops.push(payload),
    renderer: {
      renderGhost: (payload) => ghosts.push(payload),
      clearGhost: () => ghosts.push('cleared'),
    },
  });

  const event = pointerEvent(harness.pieceCell);
  harness.listeners.get('pointerdown')(event);
  harness.listeners.get('pointermove')(event);
  harness.listeners.get('pointerup')(event);

  // With bottom-align: grabOffset.row is replaced by pieceHeight (=2 for an
  // L-shaped piece whose lowest row is 1). Raw finger row is 4, so anchor.row
  // = 4 - 2 = 2.
  assert.deepEqual(previews.at(-1).anchor, { row: 2, col: 2 });
  assert.deepEqual(drops[0].anchor, { row: 2, col: 2 });
  assert.equal(drops[0].slot, 1);
  assert.equal(ghosts.at(-1), 'cleared');
  controller.destroy();
});

test('half-scale measured board produces the same logical drop anchor', () => {
  const harness = makeHarness({ scale: 0.5 });
  const drops = [];
  createInputController({
    root: harness.root,
    getPiece: () => ({ id: 'O', cells: [{ row: 0, col: 0 }, { row: 1, col: 1 }] }),
    getBoardState: () => ({ rows: 7, cols: 9 }),
    tryPreview: () => ({ ok: true }),
    onDrop: (payload) => drops.push(payload),
    renderer: { renderGhost() {}, clearGhost() {} },
  });
  const event = pointerEvent(harness.pieceCell, {
    clientX: 20 + 3.5 * 19,
    clientY: 40 + 4.5 * (267 / 14),
  });
  harness.listeners.get('pointerdown')(event);
  harness.listeners.get('pointerup')(event);
  // Bottom-align: piece is 2 rows tall (cells 0,0 and 1,1), so anchor.row
  // = raw_finger_row(=4) - 2 = 2.
  assert.deepEqual(drops[0].anchor, { row: 2, col: 2 });
});

test('visible modal isolates gameplay pointer input', () => {
  const harness = makeHarness({ modalOpen: true });
  let ghostCalls = 0;
  let dropCalls = 0;
  createInputController({
    root: harness.root,
    getPiece: () => ({ id: 'I2', cells: [{ row: 0, col: 0 }] }),
    getBoardState: () => ({ rows: 7, cols: 9 }),
    tryPreview: () => ({ ok: true }),
    onDrop: () => { dropCalls += 1; },
    renderer: { renderGhost: () => { ghostCalls += 1; }, clearGhost() {} },
  });
  const event = pointerEvent(harness.pieceCell);
  harness.listeners.get('pointerdown')(event);
  harness.listeners.get('pointerup')(event);
  assert.equal(ghostCalls, 0);
  assert.equal(dropCalls, 0);
});

test('invalid preview never commits a drop', () => {
  const harness = makeHarness();
  const drops = [];
  createInputController({
    root: harness.root,
    getPiece: () => ({ id: 'I2', cells: [{ row: 0, col: 0 }] }),
    getBoardState: () => ({ rows: 7, cols: 9 }),
    tryPreview: () => ({ ok: false, reason: 'overlap' }),
    onDrop: (payload) => drops.push(payload),
    renderer: { renderGhost() {}, clearGhost() {} },
  });
  const event = pointerEvent(harness.pieceCell);
  harness.listeners.get('pointerdown')(event);
  harness.listeners.get('pointerup')(event);
  assert.equal(drops.length, 0);
});

test('resize cancels the whole drag and restores capture, aria and root state', () => {
  const harness = makeHarness();
  let clears = 0;
  const drops = [];
  createInputController({
    root: harness.root,
    getPiece: () => ({ id: 'I2', cells: [{ row: 0, col: 0 }] }),
    getBoardState: () => ({ rows: 7, cols: 9 }),
    tryPreview: () => ({ ok: true }),
    onDrop: (payload) => drops.push(payload),
    renderer: { renderGhost() {}, clearGhost: () => { clears += 1; } },
  });
  const event = pointerEvent(harness.pieceCell);
  harness.listeners.get('pointerdown')(event);
  assert.equal(harness.captured.has(7), true);
  assert.equal(harness.button.getAttribute('aria-grabbed'), 'true');
  assert.equal(harness.rootClasses.has('is-dragging'), true);

  harness.windowListeners.get('resize')();
  assert.equal(harness.captured.has(7), false);
  assert.equal(harness.button.getAttribute('aria-grabbed'), 'false');
  assert.equal(harness.rootClasses.has('is-dragging'), false);
  assert.equal(clears, 1);
  harness.listeners.get('pointerup')(event);
  assert.equal(drops.length, 0);
});

test('destroy releases an active pointer capture and clears drag state', () => {
  const harness = makeHarness();
  let clears = 0;
  const controller = createInputController({
    root: harness.root,
    getPiece: () => ({ id: 'I2', cells: [{ row: 0, col: 0 }] }),
    getBoardState: () => ({ rows: 7, cols: 9 }),
    tryPreview: () => ({ ok: true }),
    onDrop() {},
    renderer: { renderGhost() {}, clearGhost: () => { clears += 1; } },
  });
  harness.listeners.get('pointerdown')(pointerEvent(harness.pieceCell));
  controller.destroy();
  assert.equal(harness.captured.has(7), false);
  assert.equal(harness.button.getAttribute('aria-grabbed'), 'false');
  assert.equal(harness.rootClasses.has('is-dragging'), false);
  assert.equal(clears, 1);
  assert.equal(harness.listeners.size, 0);
  assert.equal(harness.windowListeners.size, 0);
});
