import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoardState,
  findFirstLegalAnchor,
} from '../src/block-blast-board.js';
import { createProductionState } from '../src/production-model.js';
import {
  createRuntimeState,
  fastForwardRuntime,
  getRuntimeWaveProgress,
  placeRuntimePiece,
  selectRuntimeCard,
  selectRuntimeRole,
  stepRuntime,
} from '../src/runtime-controller.js';
import { ENEMY_PROFILES } from '../src/combat-model.js';
import { LEVEL_1_1 } from '../src/level-1-1.js';

const single = (id = 'single') => ({
  id,
  cells: [{ row: 0, col: 0 }],
});

function rackWith(...pieces) {
  return {
    rack: [...pieces, null, null].slice(0, 3),
    seed: 91,
    generationId: 0,
    usedSystemRescue: false,
  };
}

function boardWithMissingCross(board, { row, col }) {
  const cells = board.cells.slice();
  for (let currentCol = 0; currentCol < board.cols; currentCol += 1) {
    if (currentCol !== col) cells[row * board.cols + currentCol] = `row-${currentCol}`;
  }
  for (let currentRow = 0; currentRow < board.rows; currentRow += 1) {
    if (currentRow !== row) cells[currentRow * board.cols + col] = `col-${currentRow}`;
  }
  return { ...board, cells };
}

function runtimeAtTwentyThreeEnergy() {
  const state = createRuntimeState({ tutorial: false, seed: 7 });
  return {
    ...state,
    rack: rackWith(
      { id: 'I2-h', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      { id: 'I2-v', cells: [{ row: 0, col: 0 }, { row: 1, col: 0 }] },
      { id: 'O', cells: [
        { row: 0, col: 0 }, { row: 0, col: 1 },
        { row: 1, col: 0 }, { row: 1, col: 1 },
      ] },
    ),
    production: createProductionState({
      energy: 23,
      upgradeCount: state.production.upgradeCount,
    }),
    selectedRole: 'hero',
  };
}

function openDraft(state) {
  return {
    ...state,
    phase: 'draft',
    expedition: {
      ...state.expedition,
      phase: 'draft',
      draft: {
        segmentIndex: state.expedition.segmentIndex,
        cards: [
          { id: 'split-shot' },
          { id: 'rapid-loader' },
          { id: 'heavy-shell' },
        ],
        selectedCardId: null,
        reason: 'energy-full',
        sequence: 1,
      },
    },
    combat: { ...state.combat, phase: 'draft' },
    pendingUpgradeDraft: {
      sequence: 1,
      resumePhase: state.phase === 'draft' ? 'active' : state.phase,
      resumeCombatPhase: state.combat.phase === 'draft' ? 'active' : state.combat.phase,
      resumeExpeditionPhase: state.expedition.phase === 'draft' ? 'active' : state.expedition.phase,
    },
  };
}

function enemyTotal(composition = {}) {
  return ['grunt', 'runner', 'heavy', 'fragment', 'shooter', 'commander']
    .reduce((total, type) => total + (composition[type] ?? 0), 0);
}

function waveGaps(segment) {
  const times = segment.waves
    .filter((waveEntry) => waveEntry.trigger === 'time')
    .map((waveEntry) => waveEntry.at)
    .sort((a, b) => a - b);
  return times.slice(1).map((at, index) => at - times[index]);
}

function playerDeadlockState({ emergencySinglesRemaining = 0 } = {}) {
  const state = createRuntimeState({ tutorial: false });
  const board = createBoardState({ rows: 2, cols: 2 });
  return {
    ...state,
    board,
    rack: rackWith(single('last-legal'), {
      id: 'I5-h',
      cells: Array.from({ length: 5 }, (_, col) => ({ row: 0, col })),
    }),
    production: createProductionState({ energy: 10 }),
    selectedRole: 'hero',
    emergencySinglesRemaining,
  };
}

function clearAllEnemies(combat, dt) {
  return {
    ...combat,
    enemies: [],
    time: combat.time + dt,
    ticks: combat.ticks + 1,
    accumulator: 0,
  };
}

test('level 1-1 tutorial pacing gives players breathing room before S3', () => {
  const [s1, s2] = LEVEL_1_1.segments;
  assert.equal(s1.duration, 24);
  assert.equal(s2.duration, 24);
  assert.deepEqual(s1.waves.map((waveEntry) => waveEntry.at), [0, 12, 22]);
  assert.deepEqual(s2.waves.map((waveEntry) => waveEntry.at), [0, 11, 21]);
  assert.ok(enemyTotal(s1.waves[0].composition) <= 3);
  assert.ok(enemyTotal(s1.waves[1].composition) <= 4);
  assert.ok(Math.min(...waveGaps(s1)) >= 10);
  assert.ok(Math.min(...waveGaps(s2)) >= 10);
});

test('opening combat spawns enemies with the gentler tutorial move speed', () => {
  const level = {
    id: 'opening-speed-test',
    wallHp: 1000,
    segments: [{
      id: 'S1',
      duration: 24,
      waves: [{ trigger: 'time', at: 0, composition: { grunt: 1, runner: 1 } }],
    }],
  };
  let state = createRuntimeState({ tutorial: false, level });
  state = stepRuntime(state, 5);
  const grunt = state.combat.enemies.find((enemy) => enemy.type === 'grunt');
  const runner = state.combat.enemies.find((enemy) => enemy.type === 'runner');
  assert.equal(grunt.moveSpeed, ENEMY_PROFILES.grunt.moveSpeed * 0.32);
  assert.equal(runner.moveSpeed, ENEMY_PROFILES.runner.moveSpeed * 0.32);
});

function timedWaveRuntime(times, { productionLockRemaining = 0 } = {}) {
  const wave = (at) => ({
    trigger: 'time',
    at,
    composition: { grunt: 1 },
  });
  const level = {
    id: 'timed-boundary-test',
    wallHp: 1000,
    segments: [{
      id: 'S1',
      waves: times.map(wave),
    }],
  };
  const state = createRuntimeState({ tutorial: false, level });
  return {
    ...state,
    phase: 'active',
    prepRemaining: 0,
    battleTime: 10,
    expedition: { ...state.expedition, phase: 'active' },
    combat: { ...state.combat, phase: 'active' },
    productionLockRemaining,
    spawnedWaveKeys: [],
  };
}

function keepEnemiesAlive(combat, dt) {
  return {
    ...combat,
    time: combat.time + dt,
    ticks: combat.ticks + 1,
    accumulator: 0,
  };
}

function continuousSegmentRuntime() {
  const wave = (at, composition) => ({ trigger: 'time', at, composition });
  const level = {
    id: 'continuous-segment-test',
    wallHp: 1000,
    segments: [
      { id: 'S1', duration: 3, waves: [wave(0, { grunt: 1 }), wave(2, { runner: 1 })] },
      { id: 'S2', duration: 3, waves: [wave(0, { grunt: 1 })] },
    ],
  };
  let state = createRuntimeState({ tutorial: false, level });
  state = {
    ...state,
    phase: 'active',
    prepRemaining: 0,
    expedition: { ...state.expedition, phase: 'active' },
    combat: { ...state.combat, phase: 'active' },
  };
  return state;
}

test('S1 starts with one full-health fixed hero cannon', () => {
  const state = createRuntimeState({ tutorial: false });
  assert.equal(state.combat.fighters.length, 1);
  const hero = state.combat.fighters[0];
  assert.equal(hero.role, 'hero');
  assert.equal(hero.hp, hero.maxHp);
  assert.equal(hero.cells.length, 0);
  assert.equal(hero.fixedBody, true);
  assert.equal(hero.splashTargets, 4);
  assert.equal(hero.splashRadius, 90);
});

test('default opening has no forced first-block anchor', () => {
  const state = {
    ...createRuntimeState({ seed: 7 }),
    rack: rackWith(single('free-opening-piece')),
  };
  assert.equal(state.phase, 'prep');
  assert.deepEqual(state.tutorial, { active: false });

  const result = placeRuntimePiece(state, {
    slot: 0,
    anchor: { row: 2, col: 3 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.equal(result.state.board.cells[2 * result.state.board.cols + 3], 'free-opening-piece');
});

test('demo opening starts with a one-cell double-line clear setup', () => {
  const state = createRuntimeState({ demoOpening: true, seed: 7 });

  assert.equal(state.rack.rack[0].id, 'I1');
  assert.equal(state.rack.rack[1].id, 'I3-h');
  assert.equal(state.rack.rack[2].id, 'I3-v');
  assert.equal(state.board.cells.filter(Boolean).length, 14);

  const result = placeRuntimePiece(state, {
    slot: 0,
    anchor: { row: 6, col: 8 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.placement.clearedRows, [6]);
  assert.deepEqual(result.placement.clearedCols, [8]);
  assert.equal(result.placement.clearedCells.length, 15);
  assert.equal(result.gain, 30);
  assert.equal(result.state.production.energy, 6);
});

test('a placement without a clear does not charge energy or open a draft', () => {
  const before = runtimeAtTwentyThreeEnergy();
  const beforeSnapshot = structuredClone(before);
  const result = placeRuntimePiece(before, {
    slot: 0,
    anchor: { row: 0, col: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.gain, 0);
  assert.deepEqual(result.upgradeRequests, []);
  assert.equal(result.state.production.energy, 23);
  assert.equal(result.state.phase, 'prep');
  assert.equal(result.state.combat.fighters.length, 1);
  assert.equal(result.state.events.some(({ type }) => type === 'production-energy-gained'), false);
  assert.equal(before.production.energy, beforeSnapshot.production.energy);
});

test('a line clear shows a full-energy beat before opening the time-stopping upgrade draft', () => {
  const initial = runtimeAtTwentyThreeEnergy();
  const cells = initial.board.cells.slice();
  for (let col = 2; col < initial.board.cols; col += 1) cells[col] = `existing-${col}`;
  const before = {
    ...initial,
    phase: 'active',
    prepRemaining: 0,
    expedition: { ...initial.expedition, phase: 'active' },
    combat: { ...initial.combat, phase: 'active', time: 12 },
    board: { ...initial.board, cells },
  };
  const beforeSnapshot = structuredClone(before);
  const combatTime = before.combat.time;
  const result = placeRuntimePiece(before, {
    slot: 0,
    anchor: { row: 0, col: 0 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.upgradeRequests, [{ sequence: 1, source: 'line-clear-energy' }]);
  assert.deepEqual(result.spawnRequests, []);
  assert.equal(result.state.production.energy, 8);
  assert.equal(result.state.production.upgradeCount, 1);
  assert.equal(result.state.phase, 'upgrade-ready');
  assert.equal(result.state.combat.phase, 'draft');
  assert.equal(result.state.pendingUpgradeDraft.resumePhase, 'active');
  assert.equal(result.state.pendingUpgradeDraft.revealRemaining, 0.75);
  assert.equal(result.state.expedition.draft, null);
  assert.deepEqual(result.placement.clearedRows, [0]);
  assert.equal(result.state.board.cells.slice(0, result.state.board.cols).every((cell) => (
    cell === null
  )), true);
  assert.equal(result.state.rack.rack[0], null);
  assert.equal(result.state.combat.time, combatTime);
  const energyEvent = result.state.events.findLast(({ type }) => (
    type === 'production-energy-gained'
  ));
  assert.deepEqual(energyEvent.boardPoints, result.placement.clearedCells);
  assert.equal(energyEvent.placedCellCount, result.placement.placedCells.length);
  assert.equal(energyEvent.clearedLineCount, 1);
  assert.equal(energyEvent.beforeEnergy, before.production.energy);
  assert.equal(energyEvent.thresholdCrossings, result.upgradeRequests.length);
  assert.equal(energyEvent.remainder, result.state.production.energy);
  const held = stepRuntime(result.state, 0.5);
  assert.equal(held.combat.time, combatTime);
  assert.equal(held.phase, 'upgrade-ready');
  assert.equal(held.expedition.draft, null);
  const opened = stepRuntime(held, 0.25);
  assert.equal(opened.combat.time, combatTime);
  assert.equal(opened.phase, 'draft');
  assert.equal(opened.expedition.phase, 'draft');
  assert.equal(opened.expedition.draft.reason, 'energy-full');
  assert.equal(opened.events.at(-1).type, 'upgrade-draft-opened');
  assert.deepEqual(before, beforeSnapshot);
});

test('a simultaneous row and column clear applies the block blast x2 multiplier to energy', () => {
  const initial = createRuntimeState({ tutorial: false, seed: 9 });
  const before = {
    ...initial,
    phase: 'active',
    prepRemaining: 0,
    expedition: { ...initial.expedition, phase: 'active' },
    combat: { ...initial.combat, phase: 'active' },
    board: boardWithMissingCross(initial.board, { row: 6, col: 8 }),
    rack: rackWith(single('cross-finisher')),
    production: createProductionState({ energy: 0 }),
  };
  const result = placeRuntimePiece(before, {
    slot: 0,
    anchor: { row: 6, col: 8 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.placement.clearedCells.length, 15);
  assert.deepEqual(result.upgradeRequests, [{ sequence: 1, source: 'line-clear-energy' }]);
  assert.equal(result.state.production.energy, 6);
  const energyEvent = result.state.events.findLast(({ type }) => (
    type === 'production-energy-gained'
  ));
  assert.equal(energyEvent.baseEnergy, 15);
  assert.equal(energyEvent.clearMultiplier, 2);
  assert.equal(energyEvent.gain, 30);
  assert.equal(energyEvent.clearedLineCount, 2);
});

test('role selection is removed from the v1.0 runtime', () => {
  const state = createRuntimeState({ tutorial: false });
  assert.deepEqual(selectRuntimeRole(state, 'cannon'), {
    ok: false,
    reason: 'role-system-removed',
    state,
  });
});

test('board rack energy and hero persist through an energy draft without duplication', () => {
  const initial = createRuntimeState({ tutorial: false, seed: 19 });
  const board = {
    ...initial.board,
    cells: initial.board.cells.with(9, 'persisted-cell'),
  };
  const rack = rackWith(single('persisted-piece'), single('second-piece'));
  const production = createProductionState({ energy: 11, upgradeCount: 2 });
  const draft = openDraft({
    ...initial,
    board,
    rack,
    production,
    selectedRole: 'hero',
  });
  const result = selectRuntimeCard(draft, 'split-shot');
  assert.equal(result.ok, true);
  assert.equal(result.state.board, board);
  assert.equal(result.state.rack, rack);
  assert.equal(result.state.production, production);
  assert.equal(result.state.production.energy, 11);
  assert.equal(result.state.production.upgradeCount, 2);
  assert.equal(result.state.selectedRole, 'hero');
  assert.equal(result.state.combat.fighters.length, 1);
  assert.equal(result.state.combat.fighters[0].role, 'hero');
});

test('selecting an energy draft card resumes combat and strengthens the hero cannon', () => {
  const initial = runtimeAtTwentyThreeEnergy();
  const cells = initial.board.cells.slice();
  for (let col = 2; col < initial.board.cols; col += 1) cells[col] = `existing-${col}`;
  const active = {
    ...initial,
    phase: 'active',
    prepRemaining: 0,
    expedition: { ...initial.expedition, phase: 'active' },
    combat: { ...initial.combat, phase: 'active' },
    board: { ...initial.board, cells },
  };
  const openingBeat = placeRuntimePiece(active, { slot: 0, anchor: { row: 0, col: 0 } }).state;
  const opened = stepRuntime(openingBeat, 0.75);
  opened.expedition.draft.cards = [
    { id: 'split-shot' },
    { id: 'rapid-loader' },
    { id: 'heavy-shell' },
  ];

  const selected = selectRuntimeCard(opened, 'split-shot');

  assert.equal(selected.ok, true);
  assert.equal(selected.state.phase, 'active');
  assert.equal(selected.state.combat.phase, 'active');
  assert.equal(selected.state.pendingUpgradeDraft, null);
  assert.equal(selected.state.combat.fighters[0].splashTargets, 6);
  assert.deepEqual(
    selected.state.events.slice(opened.events.length).map(({ type }) => type),
    ['card-selected', 'draft-closed', 'upgrade-card-selected'],
  );
});

test('the third consumed piece refills from the post-clear board and emits refill after energy', () => {
  const initial = createRuntimeState({ tutorial: false, seed: 7 });
  const cells = Array(initial.board.cells.length).fill('blocked');
  for (let row = 1; row < initial.board.rows; row += 1) {
    for (let col = 0; col < initial.board.cols; col += 1) {
      if ((row + col) % 2 === 0) cells[row * initial.board.cols + col] = null;
    }
  }
  cells[8] = null;
  for (let col = 0; col < initial.board.cols - 1; col += 1) {
    cells[col] = `existing-${col}`;
  }
  const state = {
    ...initial,
    board: { ...initial.board, cells },
    rack: {
      rack: [null, null, single('row-finisher')],
      seed: 7,
      generationId: 4,
      usedSystemRescue: false,
    },
    production: createProductionState({ energy: 20 }),
    selectedRole: 'hero',
  };
  const eventStart = state.events.length;
  const result = placeRuntimePiece(state, {
    slot: 2,
    anchor: { row: 0, col: 8 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.placement.clearedRows, [0]);
  assert.equal(result.state.board.cells.slice(0, result.state.board.cols).every((cell) => cell === null), true);
  assert.equal(result.state.rack.generationId, 5);
  assert.equal(result.state.rack.usedSystemRescue, false);
  assert.equal(result.state.rack.rack.every(Boolean), true);
  assert.deepEqual(result.upgradeRequests, [{ sequence: 1, source: 'line-clear-energy' }]);
  assert.equal(result.state.phase, 'upgrade-ready');
  assert.deepEqual(
    result.state.events.slice(eventStart).map(({ type }) => type),
    [
      'piece-placed',
      'lines-cleared',
      'production-energy-gained',
      'upgrade-ready',
      'rack-refilled',
    ],
  );
  assert.deepEqual(result.state.events.findLast(({ type }) => type === 'rack-refilled'), {
    type: 'rack-refilled',
    generationId: 5,
    usedSystemRescue: false,
    reason: 'rack-consumed',
  });
});

test('isolated post-placement holes refill with ordinary one-cell pieces without penalty', () => {
  const initial = createRuntimeState({ tutorial: false });
  const cells = Array(initial.board.cells.length).fill('blocked');
  for (let row = 0; row < initial.board.rows; row += 1) {
    for (let col = 0; col < initial.board.cols; col += 1) {
      if ((row + col) % 2 === 0) cells[row * initial.board.cols + col] = null;
    }
  }
  const state = {
    ...initial,
    board: { ...initial.board, cells },
    rack: {
      rack: [null, null, single('last-piece')],
      seed: 7,
      generationId: 8,
      usedSystemRescue: false,
    },
    production: createProductionState({ energy: 10 }),
  };
  const eventStart = state.events.length;

  const result = placeRuntimePiece(state, {
    slot: 2,
    anchor: { row: 0, col: 0 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.state.rack.generationId, 9);
  assert.equal(result.state.rack.usedSystemRescue, false);
  assert.equal(result.state.rack.rack.some((piece) => piece?.cells.length === 1), true);
  assert.equal(result.state.production.energy, 10);
  assert.equal(result.state.productionLockRemaining, 0);
  assert.equal(result.state.events.some(({ type }) => type === 'production-deadlock'), false);
  assert.deepEqual(
    result.state.events.slice(eventStart).map(({ type }) => type),
    ['piece-placed', 'rack-refilled'],
  );
  assert.deepEqual(result.state.events.at(-1), {
    type: 'rack-refilled',
    generationId: 9,
    usedSystemRescue: false,
    reason: 'rack-consumed',
  });

  const singleSlot = result.state.rack.rack.findIndex((piece) => (
    piece?.cells.length === 1
  ));
  const singlePiece = result.state.rack.rack[singleSlot];
  const singleAnchor = findFirstLegalAnchor(result.state.board, singlePiece);
  const continuationEventStart = result.state.events.length;
  const continued = placeRuntimePiece(result.state, {
    slot: singleSlot,
    anchor: singleAnchor,
  });

  assert.equal(continued.ok, true);
  assert.equal(continued.state.board.cells[
    singleAnchor.row * continued.state.board.cols + singleAnchor.col
  ], singlePiece.id);
  assert.equal(continued.state.production.energy, 10);
  assert.equal(continued.state.productionLockRemaining, 0);
  assert.equal(continued.state.pendingRackRefill, false);
  assert.equal(continued.state.emergencySinglesRemaining, result.state.emergencySinglesRemaining);
  assert.equal(
    continued.state.events.slice(continuationEventStart)
      .some(({ type }) => ['production-deadlock', 'emergency-single-used'].includes(type)),
    false,
  );
});

test('a player-created deadlock resets the board halves post-placement energy and locks production', () => {
  const result = placeRuntimePiece(playerDeadlockState(), {
    slot: 0,
    anchor: { row: 0, col: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.board.cells.every((cell) => cell === null), true);
  assert.equal(result.state.production.energy, 5);
  assert.equal(result.state.productionLockRemaining, 3);
  assert.equal(result.state.pendingRackRefill, true);
  assert.equal(result.state.events.at(-1).type, 'production-deadlock');
});

test('combat advances while the production lock counts down and refills after expiry', () => {
  let state = createRuntimeState({ tutorial: false });
  state = stepRuntime(state, 5);
  state = {
    ...state,
    productionLockRemaining: 3,
    pendingRackRefill: true,
    rack: { ...state.rack, rack: [null, null, null] },
  };
  const beforeTime = state.combat.time;
  const afterOneSecond = stepRuntime(state, 1);
  assert.equal(afterOneSecond.productionLockRemaining, 2);
  assert.ok(afterOneSecond.combat.time > beforeTime);
  const unlocked = stepRuntime(afterOneSecond, 2);
  assert.equal(unlocked.productionLockRemaining, 0);
  assert.equal(unlocked.pendingRackRefill, false);
  assert.equal(unlocked.rack.rack.every(Boolean), true);
  assert.equal(unlocked.rack.generationId, state.rack.generationId + 1);
  assert.deepEqual(
    unlocked.events.slice(afterOneSecond.events.length).map(({ type }) => type),
    ['rack-refilled', 'production-unlocked'],
  );
  assert.equal(unlocked.events.at(-2).generationId, state.rack.generationId + 1);
  assert.equal(unlocked.events.at(-2).reason, 'production-unlock');
});

test('large dt consumes the time after one wave boundary and keeps production lock synchronized', () => {
  const calls = [];
  const state = timedWaveRuntime([12], { productionLockRemaining: 4 });
  const result = stepRuntime(state, 5, {
    combatStep(combat, dt) {
      calls.push(dt);
      return { ...combat, time: combat.time + dt };
    },
  });

  assert.deepEqual(calls, [2, 3]);
  assert.equal(result.battleTime, 15);
  assert.equal(result.combat.time, 5);
  assert.equal(result.productionLockRemaining, 0);
  assert.deepEqual(result.spawnedWaveKeys, ['0:0']);
  assert.deepEqual(getRuntimeWaveProgress(result), { current: 1, total: 1 });
});

test('large dt crosses every pending wave in order without swallowing remaining time', () => {
  const calls = [];
  const state = timedWaveRuntime([12, 14, 16], { productionLockRemaining: 7 });
  const result = stepRuntime(state, 7, {
    combatStep(combat, dt) {
      calls.push(dt);
      return { ...combat, time: combat.time + dt };
    },
  });

  assert.deepEqual(calls, [2, 2, 2, 1]);
  assert.equal(result.battleTime, 17);
  assert.equal(result.combat.time, 7);
  assert.equal(result.productionLockRemaining, 0);
  assert.deepEqual(result.spawnedWaveKeys, ['0:0', '0:1', '0:2']);
  assert.deepEqual(
    result.events
      .filter(({ type }) => type === 'time-wave-spawned')
      .map(({ waveIndex, at }) => ({ waveIndex, at })),
    [
      { waveIndex: 0, at: 12 },
      { waveIndex: 1, at: 14 },
      { waveIndex: 2, at: 16 },
    ],
  );
});

test('timeline segments advance by time and spawn the next wave without waiting for kills', () => {
  const result = fastForwardRuntime(continuousSegmentRuntime(), 3.1, {
    frameDt: 0.5,
    combatStep: keepEnemiesAlive,
  });

  assert.equal(result.phase, 'active');
  assert.equal(result.expedition.phase, 'active');
  assert.equal(result.expedition.segmentIndex, 1);
  assert.equal(result.expedition.segment.id, 'S2');
  assert.equal(result.expedition.draft, null);
  assert.ok(result.combat.enemies.some(({ id }) => id.startsWith('S1-')));
  assert.ok(result.combat.enemies.some(({ id }) => id.startsWith('S2-')));
  assert.equal(result.events.some(({ type }) => type === 'draft-opened'), false);
});

test('clearing a pre-final segment early does not skip the time-based wave schedule', () => {
  const result = fastForwardRuntime(continuousSegmentRuntime(), 1, {
    frameDt: 0.5,
    combatStep: clearAllEnemies,
  });

  assert.equal(result.phase, 'active');
  assert.equal(result.expedition.segmentIndex, 0);
  assert.equal(result.expedition.draft, null);
  assert.equal(result.events.some(({ type }) => type === 'segment-cleared'), false);
  assert.equal(result.events.some(({ type }) => type === 'draft-opened'), false);
});

test('defeat at a wave boundary stops remaining dt and only advances the matching production lock time', () => {
  const calls = [];
  const state = timedWaveRuntime([12, 14], { productionLockRemaining: 5 });
  const result = stepRuntime(state, 5, {
    combatStep(combat, dt) {
      calls.push(dt);
      return {
        ...combat,
        wallHp: 0,
        time: combat.time + dt,
      };
    },
  });

  assert.deepEqual(calls, [2]);
  assert.equal(result.phase, 'defeat');
  assert.equal(result.battleTime, 12);
  assert.equal(result.combat.time, 2);
  assert.equal(result.productionLockRemaining, 3);
  assert.deepEqual(result.spawnedWaveKeys, []);
  assert.equal(result.events.at(-1).type, 'defeat');
});

test('emergency single replaces one candidate instead of applying the deadlock penalty', () => {
  const result = placeRuntimePiece(playerDeadlockState({ emergencySinglesRemaining: 1 }), {
    slot: 0,
    anchor: { row: 0, col: 0 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.board.cells[0], 'last-legal');
  assert.equal(result.state.production.energy, 10);
  assert.equal(result.state.productionLockRemaining, 0);
  assert.equal(result.state.emergencySinglesRemaining, 0);
  assert.equal(result.state.rack.rack.some((piece) => piece?.cells.length === 1), true);
  assert.equal(result.state.events.at(-1).type, 'emergency-single-used');
});

test('stacked emergency singles receive unique monotonically increasing ids', () => {
  const first = placeRuntimePiece(playerDeadlockState({ emergencySinglesRemaining: 2 }), {
    slot: 0,
    anchor: { row: 0, col: 0 },
  });
  const firstId = first.state.rack.rack.find((piece) => (
    piece?.id.startsWith('emergency-single-')
  )).id;
  const reset = playerDeadlockState({ emergencySinglesRemaining: 1 });
  const secondInput = {
    ...first.state,
    board: reset.board,
    rack: reset.rack,
    emergencySinglesRemaining: 1,
  };
  const second = placeRuntimePiece(secondInput, {
    slot: 0,
    anchor: { row: 0, col: 0 },
  });
  const secondId = second.state.rack.rack.find((piece) => (
    piece?.id.startsWith('emergency-single-')
  )).id;

  assert.notEqual(firstId, secondId);
  assert.equal(first.state.emergencySingleSequence, 1);
  assert.equal(second.state.emergencySingleSequence, 2);
});

test('production lock and locked phases reject placements without mutation', () => {
  const state = runtimeAtTwentyThreeEnergy();
  const locked = { ...state, productionLockRemaining: 0.5 };
  assert.deepEqual(
    placeRuntimePiece(locked, { slot: 0, anchor: { row: 0, col: 0 } }),
    { ok: false, reason: 'production-locked', state: locked },
  );
  for (const phase of ['upgrade-ready', 'draft', 'victory', 'defeat']) {
    const phaseState = { ...state, phase };
    assert.deepEqual(
      placeRuntimePiece(phaseState, { slot: 0, anchor: { row: 0, col: 0 } }),
      { ok: false, reason: 'input-locked', state: phaseState },
    );
  }
});

test('invalid placement is atomic and preserves the original runtime identity', () => {
  const state = runtimeAtTwentyThreeEnergy();
  const result = placeRuntimePiece(state, { slot: 0, anchor: { row: -1, col: 0 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'out-of-bounds');
  assert.equal(result.state, state);
});

test('defeat has priority over segment clear or victory and rejects all input', () => {
  const state = createRuntimeState({ tutorial: false });
  const activeExpedition = {
    ...state.expedition,
    phase: 'active',
    segmentIndex: state.expedition.level.segments.length - 1,
    segment: state.expedition.level.segments.at(-1),
  };
  const allWaves = activeExpedition.segment.waves.map((_, index) => (
    `${activeExpedition.segmentIndex}:${index}`
  ));
  const doomed = {
    ...state,
    phase: 'active',
    expedition: activeExpedition,
    spawnedWaveKeys: allWaves,
    combat: { ...state.combat, phase: 'active', wallHp: 0, enemies: [] },
  };
  const resolved = stepRuntime(doomed, 1 / 30);
  assert.equal(resolved.phase, 'defeat');
  assert.equal(resolved.expedition.phase, 'defeat');
  assert.equal(resolved.events.at(-1).type, 'defeat');
  assert.deepEqual(
    selectRuntimeRole(resolved, 'sword'),
    { ok: false, reason: 'input-locked', state: resolved },
  );
  assert.deepEqual(
    selectRuntimeCard(resolved, 'heavy-shell'),
    { ok: false, reason: 'input-locked', state: resolved },
  );
});

test('accepted placement finishes before the next combat step can resolve defeat', () => {
  const state = {
    ...runtimeAtTwentyThreeEnergy(),
    phase: 'active',
  };
  state.expedition = { ...state.expedition, phase: 'active' };
  state.combat = { ...state.combat, phase: 'active', wallHp: 1 };
  const placed = placeRuntimePiece(state, { slot: 0, anchor: { row: 0, col: 0 } });
  assert.equal(placed.ok, true);
  assert.equal(placed.state.phase, 'active');
  assert.equal(placed.state.combat.wallHp, 1);
  assert.equal(placed.state.combat.fighters.at(-1).role, 'hero');

  const defeated = stepRuntime({
    ...placed.state,
    combat: { ...placed.state.combat, wallHp: 0 },
  }, 1 / 30);
  assert.equal(defeated.phase, 'defeat');
});

test('real runtime APIs clear segments without draft and advance through S6 victory', () => {
  let state = createRuntimeState({ tutorial: false, seed: 1 });
  state = stepRuntime(state, 1, { combatStep: clearAllEnemies });
  assert.equal(state.phase, 'prep');
  assert.equal(state.prepRemaining, 4);

  state = fastForwardRuntime(state, 540, {
    frameDt: 1,
    combatStep: clearAllEnemies,
  });

  assert.equal(state.phase, 'victory');
  assert.equal(state.expedition.phase, 'victory');
  assert.equal(state.events.at(-1).type, 'victory');
  assert.equal(state.expedition.draft, null);
  assert.equal(state.expedition.modifiers.chosenCards.length, 0);
  assert.equal(state.events.some(({ type }) => type === 'draft-opened'), false);
  assert.equal(
    state.combat.fighters.filter(({ id }) => id.startsWith('opening-')).length,
    1,
  );
});
