import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoardState,
  findFirstLegalAnchor,
  hasLegalPlacement,
  listLegalAnchors,
  tryPlacePiece,
} from '../src/block-blast-board.js';

const singleCellPiece = (id) => ({ id, cells: [{ row: 0, col: 0 }] });

function boardWithMissingCross({ row, col }) {
  const board = createBoardState();
  const cells = board.cells.slice();
  for (let currentCol = 0; currentCol < board.cols; currentCol += 1) {
    if (currentCol !== col) cells[row * board.cols + currentCol] = `row-${currentCol}`;
  }
  for (let currentRow = 0; currentRow < board.rows; currentRow += 1) {
    if (currentRow !== row) cells[currentRow * board.cols + col] = `col-${currentRow}`;
  }
  return { ...board, cells };
}

test('creates exactly seven rows and nine columns', () => {
  const state = createBoardState();
  assert.equal(state.rows, 7);
  assert.equal(state.cols, 9);
  assert.equal(state.cells.length, 63);
  assert.equal(state.cells.every((cell) => cell === null), true);
});

test('rejects out-of-bounds and overlap atomically with the original board identity', () => {
  const board = {
    ...createBoardState(),
    cells: createBoardState().cells.with(0, 'occupied'),
  };
  const snapshot = structuredClone(board);

  const outOfBounds = tryPlacePiece(board, singleCellPiece('outside'), { row: -1, col: 0 });
  const overlap = tryPlacePiece(board, singleCellPiece('overlap'), { row: 0, col: 0 });

  assert.deepEqual(outOfBounds, { ok: false, reason: 'out-of-bounds', state: board });
  assert.deepEqual(overlap, { ok: false, reason: 'overlap', state: board });
  assert.equal(outOfBounds.state, board);
  assert.equal(overlap.state, board);
  assert.deepEqual(board, snapshot);
});

test('places pieces without requiring adjacency and leaves the input immutable', () => {
  const board = {
    ...createBoardState(),
    cells: createBoardState().cells.with(0, 'existing'),
  };
  const result = tryPlacePiece(board, singleCellPiece('remote'), { row: 6, col: 8 });

  assert.equal(result.ok, true);
  assert.notEqual(result.state, board);
  assert.notEqual(result.state.cells, board.cells);
  assert.equal(board.cells[62], null);
  assert.equal(result.state.cells[62], 'remote');
  assert.deepEqual(result.placedCells, [{ row: 6, col: 8 }]);
  assert.deepEqual(result.clearedRows, []);
  assert.deepEqual(result.clearedCols, []);
  assert.deepEqual(result.clearedCells, []);
});

test('completing a row clears exactly that row', () => {
  const board = createBoardState();
  const cells = board.cells.slice();
  for (let col = 0; col < board.cols - 1; col += 1) cells[col] = `row-${col}`;
  const before = { ...board, cells };

  const result = tryPlacePiece(before, singleCellPiece('row-finisher'), { row: 0, col: 8 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.clearedRows, [0]);
  assert.deepEqual(result.clearedCols, []);
  assert.deepEqual(result.clearedCells, Array.from({ length: 9 }, (_, col) => ({ row: 0, col })));
  assert.equal(result.state.cells.filter(Boolean).length, 0);
});

test('completing a column clears exactly that column', () => {
  const board = createBoardState();
  const cells = board.cells.slice();
  for (let row = 0; row < board.rows - 1; row += 1) cells[row * board.cols] = `col-${row}`;
  const before = { ...board, cells };

  const result = tryPlacePiece(before, singleCellPiece('col-finisher'), { row: 6, col: 0 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.clearedRows, []);
  assert.deepEqual(result.clearedCols, [0]);
  assert.deepEqual(result.clearedCells, Array.from({ length: 7 }, (_, row) => ({ row, col: 0 })));
  assert.equal(result.state.cells.filter(Boolean).length, 0);
});

test('simultaneous row and column clear counts two lines but clears their union once', () => {
  const before = boardWithMissingCross({ row: 6, col: 8 });
  const result = tryPlacePiece(before, singleCellPiece('rescue'), { row: 6, col: 8 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.clearedRows, [6]);
  assert.deepEqual(result.clearedCols, [8]);
  assert.equal(result.clearedCells.length, 15);
  assert.equal(result.state.cells.filter(Boolean).length, 0);
});

test('line clear is a single non-recursive transaction', () => {
  const board = createBoardState();
  const cells = board.cells.slice();
  for (let col = 0; col < board.cols - 1; col += 1) cells[col] = `clear-${col}`;
  for (let col = 0; col < board.cols - 2; col += 1) cells[board.cols + col] = `stay-${col}`;
  const before = { ...board, cells };

  const result = tryPlacePiece(before, singleCellPiece('finisher'), { row: 0, col: 8 });

  assert.deepEqual(result.clearedRows, [0]);
  assert.deepEqual(result.clearedCols, []);
  assert.equal(result.state.cells.filter(Boolean).length, 7);
  assert.deepEqual(result.state.cells.slice(board.cols, board.cols * 2), [
    'stay-0', 'stay-1', 'stay-2', 'stay-3', 'stay-4', 'stay-5', 'stay-6', null, null,
  ]);
});

test('legal-anchor helpers enumerate deterministic row-major placements', () => {
  const board = {
    ...createBoardState({ rows: 2, cols: 3 }),
    cells: [null, 'blocked', null, null, null, null],
  };
  const domino = { id: 'I2-h', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] };

  assert.deepEqual(listLegalAnchors(board, domino), [
    { row: 1, col: 0 },
    { row: 1, col: 1 },
  ]);
  assert.deepEqual(findFirstLegalAnchor(board, domino), { row: 1, col: 0 });
  assert.equal(hasLegalPlacement(board, domino), true);
  assert.equal(hasLegalPlacement(board, { id: 'I3-v', cells: [
    { row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 },
  ] }), false);
});
