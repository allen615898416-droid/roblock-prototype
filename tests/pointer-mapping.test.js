import assert from 'node:assert/strict';
import test from 'node:test';

import { pointerToBoardAnchor } from '../src/pointer-mapping.js';
import { measureBoardGeometry } from '../src/render.js';

function measuredBoard(scale) {
  const origin = { left: 17, top: 29 };
  const cell = { width: 38 * scale, height: (267 / 7) * scale };
  const rects = new Map();
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      rects.set(`${row}:${col}`, {
        left: origin.left + col * cell.width,
        top: origin.top + row * cell.height,
        width: cell.width,
        height: cell.height,
      });
    }
  }
  return {
    querySelector(selector) {
      const row = Number(selector.match(/data-row="(\d+)"/)?.[1]);
      const col = Number(selector.match(/data-col="(\d+)"/)?.[1]);
      const rect = rects.get(`${row}:${col}`);
      return rect ? { getBoundingClientRect: () => rect } : null;
    },
  };
}

for (const scale of [1, 0.5]) {
  test(`measured 7x9 DOM cells preserve grabbed-cell anchor at ${scale}x`, () => {
    const geometry = measureBoardGeometry(measuredBoard(scale));
    const rect = {
      left: geometry.left,
      top: geometry.top,
      width: geometry.stepX * 8,
      height: geometry.stepY * 7,
    };
    const anchor = { row: 2, col: 2 };
    const grabbedCells = [
      { row: 0, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 3 },
    ];

    for (const grabOffset of grabbedCells) {
      const clientX = rect.left + (anchor.col + grabOffset.col + 0.5) * geometry.stepX;
      const clientY = rect.top + (anchor.row + grabOffset.row + 0.5) * geometry.stepY;
      assert.deepEqual(
        pointerToBoardAnchor(clientX, clientY, rect, 7, 8, grabOffset),
        anchor,
      );
    }
  });
}

test('pointer coordinates outside the measured board remain out of bounds', () => {
  const rect = { left: 10, top: 20, width: 304, height: 267 };
  assert.deepEqual(pointerToBoardAnchor(9, 19, rect, 7, 8), { row: -1, col: -1 });
  assert.deepEqual(pointerToBoardAnchor(314, 287, rect, 7, 8), { row: 7, col: 8 });
});
