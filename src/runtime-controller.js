import * as Board from './block-blast-board.js';
import * as Combat from './combat-model.js';
import * as Flow from './expedition-flow.js';
import { LEVEL_1_1 } from './level-1-1.js';
import * as PiecePool from './piece-pool.js';
import * as Production from './production-model.js';

const PREP_SECONDS = 5;
const SPAWN_ORDER = ['grunt', 'runner', 'heavy', 'fragment', 'shooter', 'commander'];
const SPAWN_LANES = [110, 195, 280, 145, 245];
const ENEMY_SPAWN_Y = 1000;
const S1_ENEMY_SPEED_MULTIPLIER = 0.32;
const LATER_ENEMY_SPEED_MULTIPLIER = 0.42;
const DEFAULT_SEGMENT_DURATION = 16;
const UPGRADE_REVEAL_SECONDS = 0.75;
const EPSILON = 1e-9;

const alive = (unit) => unit.hp > 0;
const waveKey = (segmentIndex, waveIndex) => `${segmentIndex}:${waveIndex}`;

function appendRuntimeEvent(state, event) {
  return { ...state, events: [...state.events, event].slice(-200) };
}

function appendUpgradeReadyEvents(state, upgradeRequests) {
  let next = state;
  for (const request of upgradeRequests) {
    next = appendRuntimeEvent(next, {
      type: 'upgrade-ready',
      sequence: request.sequence,
      source: request.source,
    });
  }
  return next;
}

function appendRackRefillEvents(state, rack, reason) {
  let next = appendRuntimeEvent(state, {
    type: 'rack-refilled',
    generationId: rack.generationId,
    usedSystemRescue: rack.usedSystemRescue,
    reason,
  });
  if (rack.usedSystemRescue) {
    next = appendRuntimeEvent(next, {
      type: 'system-rescue',
      generationId: rack.generationId,
      reason,
    });
  }
  return next;
}

function fixedHeroSnapshot(id) {
  return {
    id,
    role: 'hero',
    weaponFamily: 'hero',
    weaponLevel: 1,
    isSuper: false,
    cells: [],
    fixedBody: true,
    source: 'opening-hero',
  };
}

function deployFixedFighter(combat, snapshot, modifiers) {
  const deployed = Combat.deployFighter(combat, snapshot);
  const newest = deployed.fighters.at(-1);
  const maxHp = newest.maxHp * modifiers.armorMultiplier;
  return {
    ...deployed,
    fighters: deployed.fighters.map((fighter) => (
      fighter.id === newest.id
        ? {
          ...fighter,
          hp: fighter.hp * modifiers.armorMultiplier,
          maxHp,
          damage: fighter.damage * modifiers.damageMultiplier,
          attackIntervalMultiplier: (fighter.attackIntervalMultiplier ?? 1)
            * (modifiers.heroAttackIntervalMultiplier ?? 1),
          splashRadius: (fighter.splashRadius ?? 90)
            * (modifiers.heroSplashRadiusMultiplier ?? 1),
          splashTargets: Math.max(1, Math.round(
            (fighter.splashTargets ?? 4) + (modifiers.heroSplashTargetsBonus ?? 0),
          )),
          eliteDamageMultiplier: (fighter.eliteDamageMultiplier ?? 1)
            * (modifiers.heroEliteDamageMultiplier ?? 1),
          fireShell: Boolean(fighter.fireShell || modifiers.heroFireShell),
          fireDamageMultiplier: modifiers.heroFireDamageMultiplier ?? fighter.fireDamageMultiplier ?? 0.35,
          fixedBody: true,
          source: snapshot.source,
        }
        : fighter
    )),
  };
}

function segmentWaves(state) {
  return state.expedition.segment.waves;
}

function segmentDuration(segment) {
  const duration = Number(segment?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_SEGMENT_DURATION;
}

function segmentElapsedAt(state, battleTime = state.battleTime) {
  return Math.max(0, battleTime - (state.segmentStartedAt ?? 0));
}

function syncExpeditionCombat(state) {
  let expedition = state.expedition;
  if (expedition.phase === 'active') {
    expedition = Flow.advanceExpedition(expedition, {
      type: 'capture-combat',
      fighters: state.combat.fighters,
      wallHp: state.combat.wallHp,
    });
  } else {
    expedition = {
      ...expedition,
      fighters: state.combat.fighters,
      wallHp: state.combat.wallHp,
    };
  }
  return { ...state, expedition };
}

function spawnComposition(state, composition, descriptor) {
  let next = state;
  let spawnIndex = 0;
  const speedMultiplier = state.expedition.segment.id === 'S1'
    ? S1_ENEMY_SPEED_MULTIPLIER
    : LATER_ENEMY_SPEED_MULTIPLIER;
  for (const type of SPAWN_ORDER) {
    const count = composition[type] ?? 0;
    const eliteCount = composition.elite?.[type] ?? 0;
    for (let index = 0; index < count; index += 1) {
      const elite = index >= count - eliteCount;
      const id = `${next.expedition.segment.id}-${descriptor}-${type}-${index + 1}`;
      const x = type === 'commander'
        ? 195
        : SPAWN_LANES[spawnIndex % SPAWN_LANES.length];
      const spawned = Combat.spawnEnemy(next.combat, type, {
        id,
        elite,
        x,
        y: ENEMY_SPAWN_Y,
      });
      next = {
        ...next,
        combat: {
          ...spawned,
          enemies: spawned.enemies.map((enemy) => (
            enemy.id === id
              ? { ...enemy, moveSpeed: enemy.moveSpeed * speedMultiplier }
              : enemy
          )),
        },
      };
      spawnIndex += 1;
    }
  }
  return appendRuntimeEvent(next, {
    type: 'wave-spawned',
    segmentId: next.expedition.segment.id,
    descriptor,
    composition,
  });
}

function spawnDueTimeWaves(state, battleTime) {
  let next = state;
  const segmentElapsed = segmentElapsedAt(next, battleTime);
  segmentWaves(next).forEach((wave, index) => {
    const key = waveKey(next.expedition.segmentIndex, index);
    if (
      wave.trigger !== 'time'
      || wave.at > segmentElapsed + EPSILON
      || next.spawnedWaveKeys.includes(key)
    ) return;
    next = spawnComposition(next, wave.composition, `time-${wave.at}`);
    next = appendRuntimeEvent({
      ...next,
      spawnedWaveKeys: [...next.spawnedWaveKeys, key],
    }, {
      type: 'time-wave-spawned',
      segmentId: next.expedition.segment.id,
      waveIndex: index,
      at: wave.at,
      absoluteAt: (next.segmentStartedAt ?? 0) + wave.at,
      key,
    });
  });
  return next;
}

function nextPendingTimeWaveAt(state, targetBattleTime) {
  return segmentWaves(state)
    .map((wave, index) => ({ wave, index }))
    .map(({ wave, index }) => ({
      wave,
      index,
      absoluteAt: (state.segmentStartedAt ?? 0) + wave.at,
    }))
    .filter(({ wave, index, absoluteAt }) => (
      wave.trigger === 'time'
      && absoluteAt > state.battleTime + EPSILON
      && absoluteAt <= targetBattleTime + EPSILON
      && !state.spawnedWaveKeys.includes(waveKey(state.expedition.segmentIndex, index))
    ))
    .sort((left, right) => left.absoluteAt - right.absoluteAt)[0]?.absoluteAt ?? null;
}

function nextSegmentBoundaryAt(state, targetBattleTime) {
  if (state.expedition.segmentIndex >= state.expedition.level.segments.length - 1) return null;
  const boundaryAt = (state.segmentStartedAt ?? 0) + segmentDuration(state.expedition.segment);
  return boundaryAt > state.battleTime + EPSILON && boundaryAt <= targetBattleTime + EPSILON
    ? boundaryAt
    : null;
}

function nextTimelineBoundaryAt(state, targetBattleTime) {
  return [nextPendingTimeWaveAt(state, targetBattleTime), nextSegmentBoundaryAt(state, targetBattleTime)]
    .filter((value) => value !== null)
    .sort((left, right) => left - right)[0] ?? null;
}

function spawnDueBossThresholds(state, ratio) {
  let next = state;
  segmentWaves(next).forEach((wave, index) => {
    const key = waveKey(next.expedition.segmentIndex, index);
    if (
      wave.trigger !== 'boss-hp'
      || ratio > wave.at + EPSILON
      || next.spawnedWaveKeys.includes(key)
    ) return;
    next = spawnComposition(next, wave.composition, `boss-hp-${wave.at}`);
    next = {
      ...next,
      spawnedWaveKeys: [...next.spawnedWaveKeys, key],
      triggeredBossThresholds: [...next.triggeredBossThresholds, wave.at],
    };
  });
  return next;
}

function newCombatEvents(before, after) {
  if (!after.length) return [];
  if (!before.length) return after;
  const tailIndex = after.lastIndexOf(before.at(-1));
  return tailIndex >= 0 ? after.slice(tailIndex + 1) : after;
}

function applyCommanderSlam(state, event) {
  const commander = state.combat.enemies.find((enemy) => enemy.id === event.enemyId)
    ?? state.combat.enemies.find((enemy) => enemy.type === 'commander');
  const damage = Math.max(1, (commander?.damage ?? 18) * 2);
  const fighters = state.combat.fighters.filter(alive);
  if (fighters.length) {
    const front = fighters.reduce((best, fighter) => (
      fighter.y > best.y ? fighter : best
    ));
    return appendRuntimeEvent({
      ...state,
      combat: {
        ...state.combat,
        fighters: state.combat.fighters.map((fighter) => (
          fighter.id === front.id
            ? { ...fighter, hp: Math.max(0, fighter.hp - damage) }
            : fighter
        )),
      },
    }, {
      type: 'commander-slam-damage',
      target: 'fighter',
      targetId: front.id,
      damage,
    });
  }
  return appendRuntimeEvent({
    ...state,
    combat: {
      ...state.combat,
      wallHp: Math.max(0, state.combat.wallHp - damage),
    },
  }, {
    type: 'commander-slam-damage',
    target: 'wall',
    damage,
  });
}

function applyCombatEvents(state, events) {
  let next = state;
  for (const event of events) {
    if (event.type === 'commander-slam') next = applyCommanderSlam(next, event);
  }
  return next;
}

function requiredTimeWavesHaveSpawned(state) {
  return segmentWaves(state).every((wave, index) => (
    wave.trigger !== 'time'
    || state.spawnedWaveKeys.includes(waveKey(state.expedition.segmentIndex, index))
  ));
}

function enterDefeat(state) {
  if (state.phase === 'defeat') return state;
  const synced = syncExpeditionCombat(state);
  return appendRuntimeEvent({
    ...synced,
    phase: 'defeat',
    expedition: {
      ...synced.expedition,
      phase: 'defeat',
      draft: null,
    },
    combat: {
      ...synced.combat,
      phase: 'defeat',
      wallHp: 0,
    },
  }, {
    type: 'defeat',
    segmentId: state.expedition.segment.id,
    reason: 'wall-destroyed',
  });
}

function advanceSegmentsDue(state, battleTime = state.battleTime) {
  let next = state;
  while (
    next.expedition.segmentIndex < next.expedition.level.segments.length - 1
    && battleTime - (next.segmentStartedAt ?? 0) >= segmentDuration(next.expedition.segment) - EPSILON
  ) {
    const previousSegment = next.expedition.segment;
    const previousStartedAt = next.segmentStartedAt ?? 0;
    const segmentStartedAt = previousStartedAt + segmentDuration(previousSegment);
    const segmentIndex = next.expedition.segmentIndex + 1;
    const segment = next.expedition.level.segments[segmentIndex];
    next = syncExpeditionCombat(next);
    next = appendRuntimeEvent({
      ...next,
      phase: 'active',
      segmentStartedAt,
      expedition: {
        ...next.expedition,
        phase: 'active',
        segmentIndex,
        segment,
        draft: null,
        events: [
          ...next.expedition.events,
          { type: 'segment-start', segmentId: segment.id, reason: 'time-axis', at: segmentStartedAt },
        ],
      },
      combat: { ...next.combat, phase: 'active' },
      triggeredBossThresholds: [],
      emergencySinglesRemaining: next.expedition.modifiers.emergencySinglesPerSegment,
    }, {
      type: 'segment-time-advanced',
      fromSegmentId: previousSegment.id,
      toSegmentId: segment.id,
      at: segmentStartedAt,
    });
    next = spawnDueTimeWaves(next, battleTime);
  }
  return next;
}

function resolveVictoryIfComplete(state) {
  if (state.combat.wallHp <= 0) return enterDefeat(state);
  const finalSegmentIndex = state.expedition.level.segments.length - 1;
  if (
    state.expedition.segmentIndex !== finalSegmentIndex
    || !requiredTimeWavesHaveSpawned(state)
    || state.combat.enemies.some(alive)
  ) return state;
  let next = syncExpeditionCombat(state);
  const expedition = Flow.advanceExpedition(next.expedition, { type: 'segment-cleared' });
  next = {
    ...next,
    phase: expedition.phase,
    expedition,
    combat: { ...next.combat, phase: expedition.phase },
  };
  return appendRuntimeEvent(next, {
    type: 'victory',
    segmentId: state.expedition.segment.id,
  });
}

function enterActive(state) {
  const expedition = Flow.advanceExpedition(state.expedition, { type: 'go' });
  let next = {
    ...state,
    phase: 'active',
    prepRemaining: 0,
    battleTime: 0,
    segmentStartedAt: 0,
    expedition,
    combat: { ...state.combat, phase: 'active' },
  };
  next = appendRuntimeEvent(next, { type: 'go', segmentId: expedition.segment.id });
  return spawnDueTimeWaves(next, 0);
}

function openPendingUpgradeDraft(state) {
  if (!state.pendingUpgradeDraft) return state;
  const expedition = Flow.openEnergyDraft(
    state.expedition,
    state.pendingUpgradeDraft.sequence,
  );
  return appendRuntimeEvent({
    ...state,
    phase: 'draft',
    expedition,
    combat: { ...state.combat, phase: 'draft' },
    pendingUpgradeDraft: {
      ...state.pendingUpgradeDraft,
      revealRemaining: 0,
    },
  }, {
    type: 'upgrade-draft-opened',
    sequence: state.pendingUpgradeDraft.sequence,
  });
}

function replaceWithEmergencySingle(state) {
  const rack = state.rack.rack.slice();
  const slot = rack.findIndex(Boolean);
  const emergencySingleSequence = (state.emergencySingleSequence ?? 0) + 1;
  rack[slot < 0 ? 0 : slot] = {
    id: `emergency-single-${state.expedition.segmentIndex}-${emergencySingleSequence}`,
    cells: [{ row: 0, col: 0 }],
  };
  return appendRuntimeEvent({
    ...state,
    rack: { ...state.rack, rack, usedSystemRescue: false },
    emergencySinglesRemaining: state.emergencySinglesRemaining - 1,
    emergencySingleSequence,
  }, {
    type: 'emergency-single-used',
    segmentId: state.expedition.segment.id,
    sequence: emergencySingleSequence,
  });
}

function rackIsDeadlocked(board, rackState) {
  const pieces = rackState.rack.filter(Boolean);
  return pieces.length > 0
    && pieces.every((piece) => !Board.hasLegalPlacement(board, piece));
}

function applyPlayerDeadlockPenalty(state) {
  const board = Board.createBoardState({
    rows: state.board.rows,
    cols: state.board.cols,
  });
  const energy = Math.floor(state.production.energy / 2);
  return appendRuntimeEvent({
    ...state,
    board,
    rack: { ...state.rack, rack: [null, null, null] },
    production: { ...state.production, energy },
    productionLockRemaining: 3,
    pendingRackRefill: true,
  }, {
    type: 'production-deadlock',
    segmentId: state.expedition.segment.id,
    energy,
    lockSeconds: 3,
  });
}

function resolvePostPlacementDeadlock(state) {
  if (!rackIsDeadlocked(state.board, state.rack)) return state;
  if (state.rack.usedSystemRescue) {
    const rack = createNextRack(state.board, state.rack);
    return appendRackRefillEvents({
      ...state,
      rack,
    }, rack, 'system-rescue-continuation');
  }
  if (state.emergencySinglesRemaining > 0) return replaceWithEmergencySingle(state);
  return applyPlayerDeadlockPenalty(state);
}

function createNextRack(board, rackState) {
  const rack = PiecePool.createRack({
    board,
    seed: rackState.seed,
  });
  return {
    ...rack,
    generationId: rackState.generationId + 1,
  };
}

function createDemoOpeningBoard() {
  const board = Board.createBoardState();
  const cells = board.cells.slice();
  for (let col = 0; col < board.cols - 1; col += 1) {
    cells[(board.rows - 1) * board.cols + col] = `demo-row-${col}`;
  }
  for (let row = 0; row < board.rows - 1; row += 1) {
    cells[row * board.cols + (board.cols - 1)] = `demo-col-${row}`;
  }
  return { ...board, cells };
}

function updateProductionLock(state, dt) {
  if (state.productionLockRemaining <= 0 && !state.pendingRackRefill) return state;
  const productionLockRemaining = Math.max(0, state.productionLockRemaining - dt);
  let next = { ...state, productionLockRemaining };
  if (productionLockRemaining <= EPSILON && state.pendingRackRefill) {
    const rack = createNextRack(next.board, next.rack);
    next = {
      ...next,
      productionLockRemaining: 0,
      pendingRackRefill: false,
      rack,
    };
    next = appendRackRefillEvents(next, rack, 'production-unlock');
    next = appendRuntimeEvent(next, {
      type: 'production-unlocked',
      segmentId: next.expedition.segment.id,
    });
  }
  return next;
}

export function getRuntimeWaveProgress(state) {
  const total = segmentWaves(state).length;
  const current = segmentWaves(state).reduce((count, wave, index) => (
    state.spawnedWaveKeys.includes(waveKey(state.expedition.segmentIndex, index))
      ? count + 1
      : count
  ), 0);
  return { current: Math.min(current, total), total };
}

export function createRuntimeState({
  level = LEVEL_1_1,
  seed = 1,
  tutorial = false,
  demoOpening = false,
  timeScale = 1,
  fighters = [],
  wallHp = level.wallHp,
} = {}) {
  const modifiers = Flow.createExpeditionState({ level, seed }).modifiers;
  let combat = Combat.createCombatState({ phase: 'prep', fighters, wallHp });
  combat = deployFixedFighter(combat, fixedHeroSnapshot('opening-hero'), modifiers);
  const expedition = Flow.createExpeditionState({
    level,
    seed,
    fighters: combat.fighters,
    wallHp,
  });
  const board = demoOpening ? createDemoOpeningBoard() : Board.createBoardState();
  const rack = PiecePool.createRack({
    board,
    seed,
    forcedTemplateIds: demoOpening ? ['I1', 'I3-h', 'I3-v'] : [],
  });
  const production = Production.createProductionState();
  return {
    phase: tutorial ? 'tutorial' : 'prep',
    tutorial: tutorial
      ? { active: true, slot: 0, anchor: { row: 0, col: 0 } }
      : { active: false },
    prepRemaining: PREP_SECONDS,
    battleTime: 0,
    segmentStartedAt: 0,
    timeScale: Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1,
    expedition,
    combat,
    board,
    rack,
    production,
    selectedRole: 'hero',
    productionLockRemaining: 0,
    pendingRackRefill: false,
    emergencySinglesRemaining: expedition.modifiers.emergencySinglesPerSegment,
    emergencySingleSequence: 0,
    openingFightersGranted: true,
    pendingUpgradeDraft: null,
    spawnedWaveKeys: [],
    triggeredBossThresholds: [],
    events: [{ type: 'runtime-created', segmentId: expedition.segment.id }],
    diagnostics: { combatStepCalls: 0 },
  };
}

export function setRuntimeTimeScale(state, timeScale = 1) {
  if (!Number.isFinite(timeScale) || timeScale <= 0) return state;
  return { ...state, timeScale };
}

export function selectRuntimeRole(state, role) {
  if (!['tutorial', 'prep', 'active'].includes(state.phase)) {
    return { ok: false, reason: 'input-locked', state };
  }
  return { ok: false, reason: 'role-system-removed', state };
}

export function placeRuntimePiece(state, { slot, anchor } = {}) {
  if (!['tutorial', 'prep', 'active'].includes(state.phase)) {
    return { ok: false, reason: 'input-locked', state };
  }
  if (state.productionLockRemaining > EPSILON) {
    return { ok: false, reason: 'production-locked', state };
  }
  if (
    !anchor
    || !Number.isInteger(anchor.row)
    || !Number.isInteger(anchor.col)
  ) return { ok: false, reason: 'invalid-anchor', state };
  if (!Number.isInteger(slot) || slot < 0 || slot >= state.rack.rack.length) {
    return { ok: false, reason: 'invalid-slot', state };
  }
  const piece = state.rack.rack[slot];
  if (!piece) return { ok: false, reason: 'empty-slot', state };

  const placed = Board.tryPlacePiece(state.board, piece, anchor);
  if (!placed.ok) return { ...placed, state };

  const baseEnergy = Production.baseEnergyForPlacement(
    placed,
    state.expedition.modifiers,
  );
  const clearMultiplier = Production.clearMultiplierForPlacement(placed);
  const gain = baseEnergy * clearMultiplier;
  const productionResult = gain > 0
    ? Production.applyProductionGain(state.production, gain)
    : { state: state.production, upgradeRequests: [] };
  let combat = state.combat;
  const rack = PiecePool.consumeRackSlot(state.rack, slot, placed.state);
  let next = {
    ...state,
    board: placed.state,
    rack,
    production: productionResult.state,
    combat,
    expedition: {
      ...state.expedition,
      fighters: combat.fighters,
      wallHp: combat.wallHp,
    },
  };
  if (state.tutorial.active) {
    next = {
      ...next,
      phase: 'prep',
      tutorial: { active: false },
      prepRemaining: PREP_SECONDS,
    };
  }
  next = appendRuntimeEvent(next, {
    type: 'piece-placed',
    pieceId: piece.id,
    slot,
    anchor,
    placedCells: placed.placedCells,
  });
  if (placed.clearedRows.length || placed.clearedCols.length) {
    next = appendRuntimeEvent(next, {
      type: 'lines-cleared',
      rows: placed.clearedRows,
      cols: placed.clearedCols,
      cells: placed.clearedCells,
    });
  }
  if (gain > 0) {
    next = appendRuntimeEvent(next, {
      type: 'production-energy-gained',
      beforeEnergy: state.production.energy,
      baseEnergy,
      clearMultiplier,
      gain,
      energy: productionResult.state.energy,
      thresholdCrossings: productionResult.upgradeRequests.length,
      remainder: productionResult.state.energy,
      placedCellCount: placed.placedCells.length,
      clearedLineCount: placed.clearedRows.length + placed.clearedCols.length,
      boardPoints: placed.clearedCells,
    });
    next = appendUpgradeReadyEvents(next, productionResult.upgradeRequests);
  }
  if (rack.generationId > state.rack.generationId) {
    next = appendRackRefillEvents(next, rack, 'rack-consumed');
  }
  next = resolvePostPlacementDeadlock(next);
  if (productionResult.upgradeRequests.length && !['victory', 'defeat'].includes(next.phase)) {
    const resumePhase = next.phase === 'tutorial' ? 'prep' : next.phase;
    const resumeCombatPhase = next.combat.phase;
    next = {
      ...next,
      phase: 'upgrade-ready',
      combat: { ...next.combat, phase: 'draft' },
      pendingUpgradeDraft: {
        sequence: productionResult.upgradeRequests[0].sequence,
        resumePhase,
        resumeCombatPhase,
        resumeExpeditionPhase: next.expedition.phase,
        revealRemaining: UPGRADE_REVEAL_SECONDS,
      },
    };
  }
  return {
    ok: true,
    state: next,
    placement: {
      piece,
      anchor,
      placedCells: placed.placedCells,
      clearedRows: placed.clearedRows,
      clearedCols: placed.clearedCols,
      clearedCells: placed.clearedCells,
    },
    gain,
    upgradeRequests: productionResult.upgradeRequests,
    spawnRequests: [],
  };
}

export function selectRuntimeCard(state, cardId) {
  if (['victory', 'defeat'].includes(state.phase)) {
    return { ok: false, reason: 'input-locked', state };
  }
  if (state.expedition.phase !== 'draft' || state.phase !== 'draft') {
    return { ok: false, reason: 'not-drafting', state };
  }
  if (state.pendingUpgradeDraft) {
    const captured = {
      ...state.expedition,
      fighters: state.combat.fighters,
      wallHp: state.combat.wallHp,
    };
    const upgraded = Flow.selectEnergyDraftCard(
      captured,
      cardId,
      state.pendingUpgradeDraft.resumeExpeditionPhase,
    );
    if (upgraded === captured) return { ok: false, reason: 'invalid-card', state };
    const combat = {
      ...state.combat,
      phase: state.pendingUpgradeDraft.resumeCombatPhase,
      fighters: upgraded.fighters,
      wallHp: upgraded.wallHp,
    };
    let next = appendRuntimeEvent({
      ...state,
      phase: state.pendingUpgradeDraft.resumePhase,
      expedition: upgraded,
      combat,
      pendingUpgradeDraft: null,
    }, {
      type: 'card-selected',
      cardId,
      reason: 'energy-full',
    });
    next = appendRuntimeEvent(next, {
      type: 'draft-closed',
      reason: 'energy-full',
      cardId,
    });
    next = appendRuntimeEvent(next, {
      type: 'upgrade-card-selected',
      cardId,
    });
    return { ok: true, state: next, spawnRequests: [] };
  }
  return { ok: false, reason: 'invalid-card', state };
}

export function stepRuntime(state, realDt, {
  combatStep = Combat.stepCombat,
  timeScale = state.timeScale,
} = {}) {
  if (!Number.isFinite(realDt) || realDt <= 0) return state;
  if (!Number.isFinite(timeScale) || timeScale <= 0) return state;
  if (state.phase === 'upgrade-ready') {
    const revealRemaining = Math.max(0, (state.pendingUpgradeDraft?.revealRemaining ?? 0) - realDt);
    const next = {
      ...state,
      pendingUpgradeDraft: state.pendingUpgradeDraft
        ? { ...state.pendingUpgradeDraft, revealRemaining }
        : null,
    };
    return revealRemaining > EPSILON ? next : openPendingUpgradeDraft(next);
  }
  if (['tutorial', 'draft', 'victory', 'defeat'].includes(state.phase)) return state;
  if (state.combat.wallHp <= 0) return enterDefeat(state);

  const dt = realDt * timeScale;
  let next = state;
  let remaining = dt;
  if (next.phase === 'prep') {
    const prepDt = Math.min(remaining, next.prepRemaining);
    next = updateProductionLock(next, prepDt);
    remaining = Math.max(0, remaining - prepDt);
    const prepRemaining = Math.max(0, next.prepRemaining - prepDt);
    next = { ...next, prepRemaining };
    if (prepRemaining > EPSILON) return next;
    next = enterActive(next);
  }
  if (next.phase !== 'active') return next;
  if (next.combat.wallHp <= 0) return enterDefeat(next);

  while (remaining > EPSILON && next.phase === 'active') {
    if (next.combat.wallHp <= 0) return enterDefeat(next);
    const targetBattleTime = next.battleTime + remaining;
    const nextBoundaryAt = nextTimelineBoundaryAt(next, targetBattleTime);
    const battleTime = nextBoundaryAt ?? targetBattleTime;
    const combatDt = Math.max(0, battleTime - next.battleTime);
    next = updateProductionLock(next, combatDt);
    next = { ...next, battleTime };
    remaining = Math.max(0, remaining - combatDt);
    if (combatDt > EPSILON) {
      const beforeEvents = next.combat.events;
      const commanderBefore = next.combat.enemies.find((enemy) => (
        enemy.type === 'commander'
      ));
      const combat = combatStep(next.combat, combatDt);
      next = {
        ...next,
        combat,
        diagnostics: {
          ...next.diagnostics,
          combatStepCalls: next.diagnostics.combatStepCalls + 1,
        },
      };
      next = applyCombatEvents(next, newCombatEvents(beforeEvents, combat.events));
      if (next.combat.wallHp <= 0) return enterDefeat(next);
      const commanderAfter = next.combat.enemies.find((enemy) => (
        enemy.type === 'commander'
      ));
      if (commanderAfter || commanderBefore) {
        const ratio = commanderAfter ? commanderAfter.hp / commanderAfter.maxHp : 0;
        next = spawnDueBossThresholds(next, ratio);
      }
    }
    next = spawnDueTimeWaves(next, battleTime);
    next = advanceSegmentsDue(next, battleTime);
    next = syncExpeditionCombat(next);
    next = resolveVictoryIfComplete(next);
  }
  if (next.phase !== 'active') return next;
  next = syncExpeditionCombat(next);
  return resolveVictoryIfComplete(next);
}

export function fastForwardRuntime(state, realSeconds, {
  frameDt = 1 / 30,
  combatStep = Combat.stepCombat,
  timeScale = state.timeScale,
  maxFrames = 100000,
} = {}) {
  if (!Number.isFinite(realSeconds) || realSeconds <= 0) return state;
  let next = state;
  let elapsed = 0;
  let frames = 0;
  while (elapsed < realSeconds - EPSILON && frames < maxFrames) {
    if (['draft', 'victory', 'defeat'].includes(next.phase)) break;
    const dt = Math.min(frameDt, realSeconds - elapsed);
    next = stepRuntime(next, dt, { combatStep, timeScale });
    elapsed += dt;
    frames += 1;
  }
  return next;
}
