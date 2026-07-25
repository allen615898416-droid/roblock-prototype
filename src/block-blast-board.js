const indexOf = (board, row, col) => row * board.cols + col;

const occupiedBy = (piece, anchor) => piece.cells.map((cell) => ({
  row: anchor.row + cell.row,
  col: anchor.col + cell.col,
}));

export function createBoardState({ rows = 7, cols = 9 } = {}) {
  return {
    rows,
    cols,
    cells: Array(rows * cols).fill(null),
  };
}

export function tryPlacePiece(board, piece, anchor) {
  const placedCells = occupiedBy(piece, anchor);
  if (placedCells.some(({ row, col }) => (
    row < 0 || row >= board.rows || col < 0 || col >= board.cols
  ))) {
    return { ok: false, reason: 'out-of-bounds', state: board };
  }
  if (placedCells.some(({ row, col }) => board.cells[indexOf(board, row, col)] !== null)) {
    return { ok: false, reason: 'overlap', state: board };
  }

  const nextCells = board.cells.slice();
  for (const { row, col } of placedCells) {
    nextCells[indexOf(board, row, col)] = piece.id;
  }

  const clearedRows = Array.from({ length: board.rows }, (_, row) => row)
    .filter((row) => Array.from(
      { length: board.cols },
      (_, col) => nextCells[indexOf(board, row, col)],
    ).every(Boolean));
  const clearedCols = Array.from({ length: board.cols }, (_, col) => col)
    .filter((col) => Array.from(
      { length: board.rows },
      (_, row) => nextCells[indexOf(board, row, col)],
    ).every(Boolean));
  const clearKeys = new Set([
    ...clearedRows.flatMap((row) => Array.from(
      { length: board.cols },
      (_, col) => `${row}:${col}`,
    )),
    ...clearedCols.flatMap((col) => Array.from(
      { length: board.rows },
      (_, row) => `${row}:${col}`,
    )),
  ]);
  const clearedCells = [...clearKeys]
    .map((key) => {
      const [row, col] = key.split(':').map(Number);
      return { row, col };
    })
    .sort((a, b) => indexOf(board, a.row, a.col) - indexOf(board, b.row, b.col));

  for (const { row, col } of clearedCells) {
    nextCells[indexOf(board, row, col)] = null;
  }

  return {
    ok: true,
    state: { ...board, cells: nextCells },
    placedCells,
    clearedRows,
    clearedCols,
    clearedCells,
  };
}

export function listLegalAnchors(board, piece) {
  const anchors = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      const anchor = { row, col };
      if (tryPlacePiece(board, piece, anchor).ok) anchors.push(anchor);
    }
  }
  return anchors;
}

export function findFirstLegalAnchor(board, piece) {
  return listLegalAnchors(board, piece)[0] ?? null;
}

export function hasLegalPlacement(board, piece) {
  return findFirstLegalAnchor(board, piece) !== null;
}
