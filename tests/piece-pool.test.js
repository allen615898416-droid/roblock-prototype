import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoardState, hasLegalPlacement } from '../src/block-blast-board.js';
import {
  PIECE_TEMPLATES,
  SIZE_WEIGHTS,
  consumeRackSlot,
  createRack,
} from '../src/piece-pool.js';

function isFourDirectionConnected(template) {
  const keys = new Set(template.cells.map(({ row, col }) => `${row}:${col}`));
  const visited = new Set();
  const pending = [template.cells[0]];
  while (pending.length > 0) {
    const cell = pending.pop();
    const key = `${cell.row}:${cell.col}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [rowDelta, colDelta] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const neighbor = `${cell.row + rowDelta}:${cell.col + colDelta}`;
      if (keys.has(neighbor) && !visited.has(neighbor)) {
        const [row, col] = neighbor.split(':').map(Number);
        pending.push({ row, col });
      }
    }
  }
  return visited.size === template.cells.length;
}

test('ordinary templates cover flexible sizes one through five for demo-friendly clears', () => {
  assert.deepEqual(SIZE_WEIGHTS, [
    { size: 1, weight: 2 },
    { size: 2, weight: 8 },
    { size: 3, weight: 24 },
    { size: 4, weight: 36 },
    { size: 5, weight: 30 },
    { size: 6, weight: 6 },   // 2x3 rectangle (Block Blast Large Rectangle)
    { size: 9, weight: 2 },   // 3x3 big square (Block Blast Large Square)
  ]);
  assert.deepEqual(
    Object.fromEntries([1, 2, 3, 4, 5, 6, 9].map((size) => [
      size,
      PIECE_TEMPLATES.filter((piece) => piece.cells.length === size).length > 0,
    ])),
    { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 9: true },
  );
  assert.ok(PIECE_TEMPLATES.filter((piece) => piece.cells.length === 5).length >= 10);
  assert.ok(PIECE_TEMPLATES.filter((piece) => piece.cells.length === 6).length === 2);
  assert.ok(PIECE_TEMPLATES.filter((piece) => piece.cells.length === 9).length === 1);
});

test('all ordinary templates are internally connected in four directions', () => {
  for (const template of PIECE_TEMPLATES) {
    assert.equal(isFourDirectionConnected(template), true, template.id);
  }
});

test('size-four pool preserves the nineteen V07 direction-fixed templates', () => {
  assert.deepEqual(
    PIECE_TEMPLATES
      .filter((template) => template.cells.length === 4)
      .map((template) => template.id),
    [
      'I-h', 'I-v', 'O',
      'T-up', 'T-right', 'T-down', 'T-left',
      'L-0', 'L-1', 'L-2', 'L-3',
      'J-0', 'J-1', 'J-2', 'J-3',
      'S-h', 'S-v', 'Z-h', 'Z-v',
    ],
  );
});

test('the same board and seed produce the same deterministic three-piece rack', () => {
  const board = createBoardState();
  const first = createRack({ board, seed: 7 });
  const second = createRack({ board, seed: 7 });

  assert.equal(first.rack.length, 3);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), [
    'generationId', 'rack', 'seed', 'usedSystemRescue',
  ]);
});

test('open-board racks surface mostly big complete blocks instead of tiny filler', () => {
  const board = createBoardState();
  const state = createRack({ board, seed: 31 });
  const sizes = state.rack.map((template) => template.cells.length);

  assert.ok(
    sizes.filter((size) => size >= 4).length >= 2,
    `expected at least two big blocks, got ${sizes.join(',')}`,
  );
  assert.ok(
    sizes.filter((size) => size <= 2).length <= 1,
    `expected at most one tiny block, got ${sizes.join(',')}`,
  );
});

test('forced template ids fill the three rack slots in the requested order', () => {
  const state = createRack({
    board: createBoardState(),
    seed: 11,
    forcedTemplateIds: ['I1', 'I2-h', 'O'],
  });
  assert.deepEqual(state.rack.map((template) => template.id), ['I1', 'I2-h', 'O']);
});

test('a used slot stays empty until all three slots have been consumed', () => {
  const board = createBoardState();
  const initial = createRack({
    board,
    seed: 13,
    forcedTemplateIds: ['I2-h', 'L3-0', 'O'],
  });

  const afterFirst = consumeRackSlot(initial, 0, board);
  assert.equal(afterFirst.rack[0], null);
  assert.deepEqual(afterFirst.rack.slice(1).map((template) => template.id), ['L3-0', 'O']);
  assert.equal(afterFirst.generationId, initial.generationId);
  assert.equal(initial.rack[0].id, 'I2-h');

  const afterSecond = consumeRackSlot(afterFirst, 1, board);
  assert.deepEqual(afterSecond.rack.map((template) => template?.id ?? null), [null, null, 'O']);
  assert.equal(afterSecond.generationId, initial.generationId);

  const afterThird = consumeRackSlot(afterSecond, 2, board);
  assert.equal(afterThird.rack.every(Boolean), true);
  assert.equal(afterThird.generationId, initial.generationId + 1);
});

test('rack generation replaces an unplayable draw with a legal ordinary template when one exists', () => {
  const board = createBoardState();
  const cells = Array(board.cells.length).fill('blocked');
  cells[0] = null;
  cells[1] = null;
  const constrained = { ...board, cells };

  const state = createRack({ board: constrained, seed: 7 });

  assert.equal(state.usedSystemRescue, false);
  assert.equal(state.rack.every((template) => hasLegalPlacement(constrained, template)), true);
});

test('ordinary one-cell pieces fit isolated holes without system rescue', () => {
  const board = createBoardState();
  const cells = Array(board.cells.length).fill('blocked');
  for (const [row, col] of [[0, 0], [0, 2], [2, 0], [2, 2]]) {
    cells[row * board.cols + col] = null;
  }
  const isolatedHoles = { ...board, cells };

  assert.equal(PIECE_TEMPLATES.some((template) => hasLegalPlacement(isolatedHoles, template)), true);
  const state = createRack({ board: isolatedHoles, seed: 7 });

  assert.equal(state.usedSystemRescue, false);
  assert.equal(state.rack.some((template) => hasLegalPlacement(isolatedHoles, template)), true);
});

test('system rescue remains reserved for a completely full board', () => {
  const board = createBoardState();
  const fullBoard = { ...board, cells: Array(board.cells.length).fill('blocked') };

  assert.equal(PIECE_TEMPLATES.some((template) => hasLegalPlacement(fullBoard, template)), false);
  const state = createRack({ board: fullBoard, seed: 7 });

  assert.equal(state.usedSystemRescue, true);
  assert.equal(state.rack[0].cells.length, 1);
});
