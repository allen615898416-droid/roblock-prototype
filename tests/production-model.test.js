import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_MAX,
  applyProductionGain,
  createProductionState,
  energyForPlacement,
} from '../src/production-model.js';

const singleLinePlacement = {
  placedCells: Array(4).fill({}),
  clearedRows: [6],
  clearedCols: [],
};

test('placing blocks without a clear grants zero energy', () => {
  assert.equal(energyForPlacement({
    placedCells: Array(4).fill({}),
    clearedRows: [],
    clearedCols: [],
    clearedCells: [],
  }), 0);
});

test('a nine-cell row clear grants nine energy', () => {
  assert.equal(energyForPlacement({
    placedCells: Array(4).fill({}),
    clearedRows: [6],
    clearedCols: [],
    clearedCells: Array(9).fill({}),
  }), 9);
});

test('simultaneous row and column clears grant x2 energy on their union', () => {
  assert.equal(energyForPlacement({
    placedCells: Array(4).fill({}),
    clearedRows: [6],
    clearedCols: [6],
    clearedCells: Array(15).fill({}),
  }), 30);
});

test('line-energy card bonus applies once to every cleared line', () => {
  assert.equal(energyForPlacement({
    ...singleLinePlacement,
    clearedCells: Array(9).fill({}),
  }, { lineEnergyBonus: 3 }), 12);
});

test('production state is a role-free upgrade meter with a fixed maximum of twenty-four', () => {
  const state = createProductionState();
  assert.equal(PRODUCTION_MAX, 24);
  assert.deepEqual(state, {
    energy: 0,
    max: 24,
    upgradeCount: 0,
  });
});

test('crossing multiple thresholds queues upgrade drafts and preserves remainder', () => {
  const state = createProductionState({ energy: 23 });
  const result = applyProductionGain(state, 52, 'cannon');
  assert.equal(result.state.energy, 3);
  assert.equal(result.upgradeRequests.length, 3);
});

test('queued upgrade drafts receive sequential ids', () => {
  const state = createProductionState({ energy: 22, upgradeCount: 4 });
  const result = applyProductionGain(state, 50);
  assert.deepEqual(result.state, {
    energy: 0,
    max: 24,
    upgradeCount: 7,
  });
  assert.deepEqual(result.upgradeRequests, [
    { sequence: 5, source: 'line-clear-energy' },
    { sequence: 6, source: 'line-clear-energy' },
    { sequence: 7, source: 'line-clear-energy' },
  ]);
});
