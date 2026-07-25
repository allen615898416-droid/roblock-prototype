export function pointerToBoardAnchor(
  clientX,
  clientY,
  rect,
  rows,
  cols,
  grabOffset = { row: 0, col: 0 },
) {
  return {
    row: Math.floor(((clientY - rect.top) / rect.height) * rows) - grabOffset.row,
    col: Math.floor(((clientX - rect.left) / rect.width) * cols) - grabOffset.col,
  };
}
