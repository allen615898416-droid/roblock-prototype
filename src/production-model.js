export const PRODUCTION_MAX = 24;

export function createProductionState({ energy = 0, upgradeCount = 0 } = {}) {
  return {
    energy: Math.max(0, Math.floor(energy)) % PRODUCTION_MAX,
    max: PRODUCTION_MAX,
    upgradeCount: Math.max(0, Math.floor(upgradeCount)),
  };
}

export function energyForPlacement(result, modifiers = {}) {
  return baseEnergyForPlacement(result, modifiers) * clearMultiplierForPlacement(result);
}

export function baseEnergyForPlacement(result, modifiers = {}) {
  const lines = result.clearedRows.length + result.clearedCols.length;
  if (!lines) return 0;
  return result.clearedCells.length
    + lines * (modifiers.lineEnergyBonus ?? 0);
}

export function clearMultiplierForPlacement(result) {
  const rowCount = result.clearedRows.length;
  const colCount = result.clearedCols.length;
  return rowCount > 0 && colCount > 0 ? 2 : 1;
}

export function applyProductionGain(state, gain) {
  const total = state.energy + Math.max(0, Math.floor(gain));
  const count = Math.floor(total / PRODUCTION_MAX);
  return {
    state: { ...state, energy: total % PRODUCTION_MAX, upgradeCount: state.upgradeCount + count },
    upgradeRequests: Array.from({ length: count }, (_, index) => ({
      sequence: state.upgradeCount + index + 1,
      source: 'line-clear-energy',
    })),
  };
}
