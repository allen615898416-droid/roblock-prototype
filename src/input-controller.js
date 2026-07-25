import * as PointerMapping from './pointer-mapping.js';
import { measureBoardGeometry } from './render.js';

export function geometryToPointerRect(geometry, rows, cols) {
  return {
    left: geometry.left,
    top: geometry.top,
    width: geometry.stepX * cols,
    height: geometry.stepY * rows,
  };
}

export function createInputController({
  root,
  getPiece,
  getBoardState,
  tryPreview,
  onDrop,
  renderer,
}) {
  const board = root.querySelector('[data-board]');
  const view = root.ownerDocument?.defaultView ?? globalThis.window;
  let drag = null;

  const modalOwnsInput = () => Boolean(
    root.querySelector('[aria-modal="true"]:not([hidden])'),
  );
  const dimensions = () => ({
    rows: getBoardState()?.rows || 7,
    cols: getBoardState()?.cols || 8,
  });
  const liveRect = () => {
    const { rows, cols } = dimensions();
    const geometry = measureBoardGeometry(board);
    return geometry
      ? geometryToPointerRect(geometry, rows, cols)
      : board.getBoundingClientRect();
  };
  const anchorFor = (event) => {
    const { rows, cols } = dimensions();
    return PointerMapping.pointerToBoardAnchor(
      event.clientX,
      event.clientY,
      liveRect(),
      rows,
      cols,
      drag.grabOffset,
    );
  };
  const draw = (event) => {
    if (!drag) return;
    const anchor = anchorFor(event);
    const preview = tryPreview?.(drag.piece, anchor) || { ok: true };
    drag.anchor = anchor;
    drag.valid = preview.ok !== false;
    renderer.renderGhost({
      candidate: drag.piece,
      piece: drag.piece,
      anchor,
      valid: drag.valid,
      rect: liveRect(),
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  function begin(event) {
    if (modalOwnsInput()) return;
    const button = event.target.closest('[data-rack-slot]');
    if (!button || button.disabled || event.button > 0) return;
    const slot = Number(button.dataset.rackSlot);
    const piece = getPiece(slot);
    if (!piece) return;
    const grabbed = event.target.closest('[data-piece-cell]');
    drag = {
      pointerId: event.pointerId,
      slot,
      piece,
      grabOffset: {
        row: Number(grabbed?.dataset.row || 0),
        col: Number(grabbed?.dataset.col || 0),
      },
      anchor: null,
      valid: false,
      button,
    };
    button.setAttribute?.('aria-grabbed', 'true');
    button.setPointerCapture?.(event.pointerId);
    root.classList?.add('is-dragging');
    event.preventDefault();
    draw(event);
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (modalOwnsInput()) {
      finish(event, true);
      return;
    }
    event.preventDefault();
    draw(event);
  }

  function cancelDrag() {
    if (!drag) return;
    const cancelled = drag;
    drag = null;
    if (cancelled.button.hasPointerCapture?.(cancelled.pointerId)) {
      cancelled.button.releasePointerCapture(cancelled.pointerId);
    }
    cancelled.button.setAttribute?.('aria-grabbed', 'false');
    root.classList?.remove('is-dragging');
    renderer.clearGhost();
  }

  function finish(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const completed = drag;
    const canDrop = (
      !cancelled
      && !modalOwnsInput()
      && completed.valid === true
      && completed.anchor
    );
    cancelDrag();
    if (canDrop) {
      onDrop({
        slot: completed.slot,
        candidate: completed.piece,
        piece: completed.piece,
        anchor: completed.anchor,
      });
    }
  }

  const pointerUp = (event) => finish(event);
  const pointerCancel = (event) => finish(event, true);
  const resize = () => cancelDrag();
  root.addEventListener('pointerdown', begin);
  root.addEventListener('pointermove', move, { passive: false });
  root.addEventListener('pointerup', pointerUp);
  root.addEventListener('pointercancel', pointerCancel);
  view?.addEventListener('resize', resize);

  return {
    destroy() {
      cancelDrag();
      root.removeEventListener('pointerdown', begin);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', pointerUp);
      root.removeEventListener('pointercancel', pointerCancel);
      view?.removeEventListener?.('resize', resize);
    },
  };
}
