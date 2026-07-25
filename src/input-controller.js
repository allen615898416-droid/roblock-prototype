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
  feedback,
}) {
  const board = root.querySelector('[data-board]');
  const ghostEl = root.querySelector('[data-ghost]') || root.querySelector('.ghost');
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
    // Bottom-align: finger stays above the piece so the placement target stays visible.
    // row offset = piece height (lowest row + 1); col offset = where the finger grabbed.
    const pieceHeight = drag
      ? Math.max(0, ...drag.piece.cells.map((cell) => cell.row)) + 1
      : 1;
    const offset = {
      row: pieceHeight,
      col: drag ? drag.grabOffset.col : 0,
    };
    return PointerMapping.pointerToBoardAnchor(
      event.clientX,
      event.clientY,
      liveRect(),
      rows,
      cols,
      offset,
    );
  };
  const draw = (event) => {
    if (!drag) return;
    const anchor = anchorFor(event);
    const preview = tryPreview?.(drag.piece, anchor) || { ok: true };
    drag.anchor = anchor;
    drag.valid = preview.ok !== false;
    // Pass willClear info to ghost so the rows/cols that will be cleared
    // can be highlighted as a preview before the player releases.
    renderer.renderGhost({
      candidate: drag.piece,
      piece: drag.piece,
      anchor,
      valid: drag.valid,
      rect: liveRect(),
      clientX: event.clientX,
      clientY: event.clientY,
      willClearRows: preview.clearedRows || [],
      willClearCols: preview.clearedCols || [],
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
    // Capture ghost info before cancelDrag clears it
    const ghostRect = ghostEl?.getBoundingClientRect?.();
    const buttonRect = completed.button?.getBoundingClientRect?.();
    if (canDrop) {
      cancelDrag();
      const dropResult = onDrop({
        slot: completed.slot,
        candidate: completed.piece,
        piece: completed.piece,
        anchor: completed.anchor,
      });
      // After a successful drop with clears, trigger the cell-clearing animation
      if (dropResult && (dropResult.clearedRows?.length || dropResult.clearedCols?.length)) {
        renderer.triggerClearing?.(
          dropResult.clearedCells || [],
          completed.piece.id,
        );
      }
    } else if (!cancelled) {
      // Invalid drop (out of bounds or overlap): bounce back to rack slot
      const targetX = buttonRect ? (buttonRect.left + buttonRect.right) / 2 : null;
      const targetY = buttonRect ? (buttonRect.top + buttonRect.bottom) / 2 : null;
      if (targetX !== null && targetY !== null && ghostRect) {
        // Keep ghost visible for rebound; don't clearGhost yet
        renderer.reboundGhost?.(targetX, targetY);
        // Clear drag state but skip clearGhost (reboundGhost handles it)
        drag = null;
        if (completed.button.hasPointerCapture?.(completed.pointerId)) {
          completed.button.releasePointerCapture(completed.pointerId);
        }
        completed.button.setAttribute?.('aria-grabbed', 'false');
        root.classList?.remove('is-dragging');
      } else {
        cancelDrag();
      }
    } else {
      cancelDrag();
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
