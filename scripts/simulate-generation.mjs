import assert from 'node:assert/strict';
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads';
import {
  createBoardState,
  listLegalAnchors,
  tryPlacePiece,
} from '../src/block-blast-board.js';
import {
  consumeRackSlot,
  createRack,
  PIECE_TEMPLATES,
  SIZE_WEIGHTS,
} from '../src/piece-pool.js';
import {
  applyProductionGain,
  createProductionState,
  energyForPlacement,
} from '../src/production-model.js';

const RUNS = 100_000;
const PLACEMENTS_PER_RUN = 60;
const PLAYER_POLICY = 'uniform random legal candidate and legal anchor';
const SEED = 0x08_07_2026;
const PRNG_INCREMENT = 0x6D2B79F5;
const PRNG_DRAWS_PER_RUN = PLACEMENTS_PER_RUN + 1;
const SIMULATION_WORKERS = 4;

function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return { low: 0, high: 0 };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)) / denominator;
  return {
    low: successes === 0 ? 0 : Math.max(0, center - margin),
    high: successes === total ? 1 : Math.min(1, center + margin),
  };
}

function createPrng(seed) {
  let state = seed >>> 0;
  return {
    nextUint32() {
      state = (state + PRNG_INCREMENT) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    },
    nextIndex(length) {
      if (!Number.isInteger(length) || length <= 0) throw new RangeError('Cannot draw from an empty candidate list');
      return Math.floor((this.nextUint32() / 0x100000000) * length);
    },
  };
}

const TEMPLATES_BY_SIZE = new Map(SIZE_WEIGHTS.map(({ size }) => [
  size,
  PIECE_TEMPLATES.filter((template) => template.cells.length === size),
]));
const TOTAL_TEMPLATE_WEIGHT = SIZE_WEIGHTS.reduce((total, { weight }) => total + weight, 0);
const SYSTEM_RESCUE_TEMPLATE = { id: 'system-rescue-1', cells: [{ row: 0, col: 0 }] };

function isAnchorLegalFast(board, piece, row, col) {
  for (const cell of piece.cells) {
    const targetRow = row + cell.row;
    const targetCol = col + cell.col;
    if (
      targetRow < 0
      || targetRow >= board.rows
      || targetCol < 0
      || targetCol >= board.cols
      || board.cells[targetRow * board.cols + targetCol] !== null
    ) return false;
  }
  return true;
}

function listLegalAnchorsFast(board, piece) {
  const anchors = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (isAnchorLegalFast(board, piece, row, col)) anchors.push({ row, col });
    }
  }
  return anchors;
}

function hasLegalPlacementFast(board, piece) {
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (isAnchorLegalFast(board, piece, row, col)) return true;
    }
  }
  return false;
}

function listLegalPairs(board, rack) {
  const pairs = [];
  rack.rack.forEach((piece, slot) => {
    if (!piece) return;
    const anchors = listLegalAnchorsFast(board, piece);
    for (const anchor of anchors) pairs.push({ slot, piece, anchor });
  });
  return pairs;
}

function nextRackRandom(seed) {
  return ((seed * 1664525 + 1013904223) >>> 0);
}

function drawRackTemplate(seed) {
  const sizeSeed = nextRackRandom(seed);
  let weightedRoll = (sizeSeed / 0x100000000) * TOTAL_TEMPLATE_WEIGHT;
  let size = SIZE_WEIGHTS.at(-1).size;
  for (const entry of SIZE_WEIGHTS) {
    if (weightedRoll < entry.weight) {
      size = entry.size;
      break;
    }
    weightedRoll -= entry.weight;
  }
  const templateSeed = nextRackRandom(sizeSeed);
  const templates = TEMPLATES_BY_SIZE.get(size);
  return {
    template: templates[Math.floor((templateSeed / 0x100000000) * templates.length)],
    seed: templateSeed,
  };
}

function drawGeneratedRack(seed) {
  let nextSeed = seed >>> 0;
  const rack = [];
  for (let slot = 0; slot < 3; slot += 1) {
    const draw = drawRackTemplate(nextSeed);
    rack.push(draw.template);
    nextSeed = draw.seed;
  }
  return { rack, seed: nextSeed };
}

function createRackFast(board, seed, generationId = 0) {
  const generated = drawGeneratedRack(seed);
  const ordinaryTemplate = generated.rack.some((template) => hasLegalPlacementFast(board, template))
    ? null
    : PIECE_TEMPLATES.find((template) => hasLegalPlacementFast(board, template));
  return ordinaryTemplate === null
    ? { rack: generated.rack, seed: generated.seed, generationId, usedSystemRescue: false }
    : ordinaryTemplate
      ? {
        rack: [ordinaryTemplate, generated.rack[1], generated.rack[2]],
        seed: generated.seed,
        generationId,
        usedSystemRescue: false,
      }
      : {
        rack: [SYSTEM_RESCUE_TEMPLATE, generated.rack[1], generated.rack[2]],
        seed: generated.seed,
        generationId,
        usedSystemRescue: true,
      };
}

function consumeRackSlotFast(rackState, slot, board) {
  const rack = rackState.rack.slice();
  rack[slot] = null;
  const result = rack.some(Boolean)
    ? { ...rackState, rack }
    : createRackFast(board, rackState.seed, rackState.generationId + 1);
  return result;
}

function createNamedBoard(name, occupied) {
  const board = createBoardState({ rows: 7, cols: 8 });
  return {
    name,
    board: {
      ...board,
      cells: board.cells.map((_, index) => {
        const row = Math.floor(index / board.cols);
        const col = index % board.cols;
        return occupied(row, col, index) ? `preflight-${name}` : null;
      }),
    },
  };
}

function createFullMinusBoard(name, emptyCells) {
  const emptyKeys = new Set(emptyCells.map(([row, col]) => `${row}:${col}`));
  return createNamedBoard(name, (row, col) => !emptyKeys.has(`${row}:${col}`));
}

function createBoardCorpus() {
  const corpus = [
    createNamedBoard('empty', () => false),
    createNamedBoard('full', () => true),
  ];

  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      corpus.push(createFullMinusBoard(`full-minus-${row}-${col}`, [[row, col]]));
    }
  }

  corpus.push(
    createNamedBoard('checker-even', (row, col) => (row + col) % 2 === 0),
    createNamedBoard('checker-odd', (row, col) => (row + col) % 2 === 1),
    createNamedBoard('row-stripes-even', (row) => row % 2 === 0),
    createNamedBoard('row-stripes-odd', (row) => row % 2 === 1),
    createNamedBoard('col-stripes-even', (_, col) => col % 2 === 0),
    createNamedBoard('col-stripes-odd', (_, col) => col % 2 === 1),
    createNamedBoard('border-dense', (row, col) => row === 0 || row === 6 || col === 0 || col === 7),
    createNamedBoard('center-dense', (row, col) => row >= 1 && row <= 5 && col >= 2 && col <= 5),
    createNamedBoard('diagonal-dense', (row, col) => row === col || row + col === 7),
    createFullMinusBoard('ordinary-repair-horizontal', [[0, 0], [0, 1]]),
    createFullMinusBoard('ordinary-repair-vertical', [[0, 0], [1, 0]]),
    createFullMinusBoard('system-rescue-isolated', [
      [0, 0], [0, 2], [2, 0], [2, 2], [4, 4], [6, 6],
    ]),
    createFullMinusBoard('edge-pocket', [
      [0, 0], [0, 1], [1, 0], [5, 6], [5, 7], [6, 7],
    ]),
  );

  const randomSeeds = [1, 7, 13, 37, 91, 0x12345678, 0x9E3779B9, 0xFFFFFFFF];
  for (const seed of randomSeeds) {
    for (const density of [0.2, 0.5, 0.8]) {
      const prng = createPrng(seed ^ Math.floor(density * 100));
      corpus.push(createNamedBoard(
        `random-${seed.toString(16)}-${Math.round(density * 100)}`,
        () => (prng.nextUint32() / 0x100000000) < density,
      ));
    }
  }
  return corpus;
}

function rackSnapshot(rackState) {
  return {
    seed: rackState.seed,
    generationId: rackState.generationId,
    usedSystemRescue: rackState.usedSystemRescue,
    rack: rackState.rack.map((piece) => (
      piece
        ? { id: piece.id, cells: piece.cells.map(({ row, col }) => ({ row, col })) }
        : null
    )),
  };
}

function assertRackEquivalent(actual, expected, message) {
  assert.deepEqual(rackSnapshot(actual), rackSnapshot(expected), message);
}

function findOrdinaryRepairSeed(board) {
  for (let seed = 0; seed < 100_000; seed += 1) {
    const generated = drawGeneratedRack(seed);
    if (generated.rack.every((piece) => !hasLegalPlacementFast(board, piece))) return seed;
  }
  throw new Error('Preflight could not find an ordinary-repair rack seed');
}

function runDifferentialPreflight() {
  const corpus = createBoardCorpus();
  assert.equal(PIECE_TEMPLATES.length, 37, 'Preflight must cover all 37 ordinary templates');

  for (const { name, board } of corpus) {
    for (const piece of PIECE_TEMPLATES) {
      assert.deepEqual(
        listLegalAnchorsFast(board, piece),
        listLegalAnchors(board, piece),
        `Legal-anchor differential failed for ${name}/${piece.id}`,
      );
    }
  }

  const rackBoardNames = new Set([
    'empty',
    'full',
    'checker-even',
    'checker-odd',
    'row-stripes-even',
    'col-stripes-odd',
    'border-dense',
    'center-dense',
    'diagonal-dense',
    'ordinary-repair-horizontal',
    'ordinary-repair-vertical',
    'system-rescue-isolated',
    'edge-pocket',
  ]);
  const rackBoards = corpus.filter(({ name }) => (
    rackBoardNames.has(name) || name.startsWith('random-') && name.endsWith('-50')
  ));
  const rackSeeds = [
    0, 1, 2, 3, 7, 11, 13, 37, 91, 255, 1024,
    0x12345678, 0x80000000, 0xFFFFFFFE, 0xFFFFFFFF, SEED,
  ];
  for (const { name, board } of rackBoards) {
    for (const seed of rackSeeds) {
      let fastRack = createRackFast(board, seed, 9);
      let modelRack = { ...createRack({ board, seed }), generationId: 9 };
      assertRackEquivalent(fastRack, modelRack, `Rack-create differential failed for ${name}/${seed}`);
      for (const slot of [0, 1, 2]) {
        fastRack = consumeRackSlotFast(fastRack, slot, board);
        modelRack = consumeRackSlot(modelRack, slot, board);
        assertRackEquivalent(
          fastRack,
          modelRack,
          `Rack-consume differential failed for ${name}/${seed}/slot-${slot}`,
        );
      }
    }
  }

  const ordinaryRepairBoard = corpus.find(({ name }) => name === 'ordinary-repair-horizontal').board;
  const repairSeed = findOrdinaryRepairSeed(ordinaryRepairBoard);
  const rawRepairRack = drawGeneratedRack(repairSeed);
  assert.equal(
    rawRepairRack.rack.every((piece) => !hasLegalPlacementFast(ordinaryRepairBoard, piece)),
    true,
    'Ordinary-repair boundary must start with an unplayable generated rack',
  );
  const fastRepairRack = createRackFast(ordinaryRepairBoard, repairSeed);
  const modelRepairRack = createRack({ board: ordinaryRepairBoard, seed: repairSeed });
  assertRackEquivalent(fastRepairRack, modelRepairRack, 'Ordinary-repair boundary diverged');
  assert.equal(fastRepairRack.usedSystemRescue, false, 'Ordinary repair must not count as system rescue');
  assert.equal(fastRepairRack.rack[0].id, 'I2-h', 'Ordinary repair must install the first legal template');

  const rescueBoard = corpus.find(({ name }) => name === 'system-rescue-isolated').board;
  assert.equal(
    PIECE_TEMPLATES.every((piece) => !hasLegalPlacementFast(rescueBoard, piece)),
    true,
    'System-rescue boundary must reject every ordinary template',
  );
  const fastRescueRack = createRackFast(rescueBoard, 7);
  const modelRescueRack = createRack({ board: rescueBoard, seed: 7 });
  assertRackEquivalent(fastRescueRack, modelRescueRack, 'System-rescue boundary diverged');
  assert.equal(fastRescueRack.usedSystemRescue, true, 'System-rescue boundary must mark rescue use');
  assert.equal(fastRescueRack.rack[0].id, 'system-rescue-1', 'System rescue must install one cell');
}

function createCountedRack(board, seed, generationId, totals) {
  const rack = createRackFast(board, seed, generationId);
  totals.racksGenerated += 1;
  if (rack.usedSystemRescue) totals.systemRescues += 1;
  return rack;
}

function resolveDeadlock({ board, rack, production, totals, run, knownDeadlocked = false }) {
  const legalPairs = knownDeadlocked ? [] : listLegalPairs(board, rack);
  if (legalPairs.length > 0) return { board, rack, production };

  if (rack.usedSystemRescue) {
    const nextRack = createCountedRack(board, rack.seed, rack.generationId + 1, totals);
    return resolveDeadlock({ board, rack: nextRack, production, totals, run });
  }

  totals.playerDeadlocks += 1;
  run.hadPlayerDeadlock = true;
  const resetBoard = createBoardState({ rows: board.rows, cols: board.cols });
  const resetProduction = { ...production, energy: Math.floor(production.energy / 2) };
  const resetRack = createCountedRack(resetBoard, rack.seed, rack.generationId + 1, totals);
  return { board: resetBoard, rack: resetRack, production: resetProduction };
}

function createTotals() {
  return {
    placements: 0,
    linesCleared: 0,
    energyGained: 0,
    soldiersProduced: 0,
    systemRescues: 0,
    playerDeadlocks: 0,
    runsWithPlayerDeadlock: 0,
    racksGenerated: 0,
  };
}

function seedAtRun(startRun) {
  const drawOffset = startRun * PRNG_DRAWS_PER_RUN;
  return (SEED + Math.imul(drawOffset, PRNG_INCREMENT)) >>> 0;
}

function simulateRange(startRun, runCount) {
  const prng = createPrng(seedAtRun(startRun));
  const totals = createTotals();

  for (let run = 0; run < runCount; run += 1) {
    let board = createBoardState({ rows: 7, cols: 8 });
    let rack = createCountedRack(board, prng.nextUint32(), 0, totals);
    let production = createProductionState();
    const runStats = { hadPlayerDeadlock: false };
    let pairs = listLegalPairs(board, rack);

    for (let placementIndex = 0; placementIndex < PLACEMENTS_PER_RUN; placementIndex += 1) {
      if (pairs.length === 0) {
        ({ board, rack, production } = resolveDeadlock({
          board, rack, production, totals, run: runStats, knownDeadlocked: true,
        }));
        pairs = listLegalPairs(board, rack);
      }

      const selected = pairs[prng.nextIndex(pairs.length)];
      const placed = tryPlacePiece(board, selected.piece, selected.anchor);
      if (!placed.ok) throw new Error('A listed legal candidate was not placeable');

      const gain = energyForPlacement(placed);
      const productionResult = applyProductionGain(production, gain);
      const previousRack = rack;
      rack = consumeRackSlotFast(rack, selected.slot, placed.state);
      if (rack.generationId > previousRack.generationId) {
        totals.racksGenerated += 1;
        if (rack.usedSystemRescue) totals.systemRescues += 1;
      }

      board = placed.state;
      production = productionResult.state;
      totals.placements += 1;
      totals.linesCleared += placed.clearedRows.length + placed.clearedCols.length;
      totals.energyGained += gain;
      totals.soldiersProduced += productionResult.spawnRequests.length;
      pairs = listLegalPairs(board, rack);
      if (pairs.length === 0) {
        ({ board, rack, production } = resolveDeadlock({
          board, rack, production, totals, run: runStats, knownDeadlocked: true,
        }));
        pairs = listLegalPairs(board, rack);
      }
    }
    if (runStats.hadPlayerDeadlock) totals.runsWithPlayerDeadlock += 1;
  }
  return totals;
}

function mergeTotals(partials) {
  const totals = createTotals();
  for (const partial of partials) {
    for (const key of Object.keys(totals)) totals[key] += partial[key];
  }
  return totals;
}

async function simulate() {
  const workers = Array.from({ length: SIMULATION_WORKERS }, (_, index) => {
    const startRun = Math.floor((RUNS * index) / SIMULATION_WORKERS);
    const endRun = Math.floor((RUNS * (index + 1)) / SIMULATION_WORKERS);
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { startRun, runCount: endRun - startRun },
      });
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`Simulation worker exited with code ${code}`));
      });
    });
  });
  return mergeTotals(await Promise.all(workers));
}

function createReport(totals) {
  return {
    assumptions: {
      runs: RUNS,
      placementsPerRun: PLACEMENTS_PER_RUN,
      playerPolicy: PLAYER_POLICY,
    },
    totals,
    means: {
      energyPerPlacement: totals.energyGained / totals.placements,
      placementsPerSoldier: totals.soldiersProduced ? totals.placements / totals.soldiersProduced : 0,
    },
    denominators: {
      systemRescueRacks: totals.racksGenerated,
      playerDeadlockRuns: RUNS,
    },
    rates: {
      systemRescuePerRack: totals.systemRescues / totals.racksGenerated,
      systemRescuePerRack95CI: wilson(totals.systemRescues, totals.racksGenerated),
      playerDeadlockPerRun: totals.runsWithPlayerDeadlock / RUNS,
      playerDeadlockPerRun95CI: wilson(totals.runsWithPlayerDeadlock, RUNS),
      clearPerPlacement: totals.linesCleared / totals.placements,
    },
    evidenceBoundary: 'theoretical deterministic simulation; not browser Play or real-player Play',
  };
}

if (isMainThread) {
  runDifferentialPreflight();
  const report = createReport(await simulate());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  parentPort.postMessage(simulateRange(workerData.startRun, workerData.runCount));
}
