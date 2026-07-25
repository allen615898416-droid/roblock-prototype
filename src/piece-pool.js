import { hasLegalPlacement } from './block-blast-board.js';

const piece = (id, cells) => Object.freeze({ id, cells: Object.freeze(cells) });

export const SIZE_WEIGHTS = Object.freeze([
  { size: 1, weight: 2 },
  { size: 2, weight: 8 },
  { size: 3, weight: 24 },
  { size: 4, weight: 36 },
  { size: 5, weight: 30 },
  { size: 6, weight: 6 },   // 2x3 rectangle, harder to place
  { size: 9, weight: 2 },   // 3x3 big square, requires open space (Block Blast "Large Square")
]);

export const SMALL_AND_LARGE_TEMPLATES = Object.freeze([
  piece('I1', [[0, 0]]),
  piece('I2-h', [[0, 0], [0, 1]]),
  piece('I2-v', [[0, 0], [1, 0]]),
  piece('I3-h', [[0, 0], [0, 1], [0, 2]]),
  piece('I3-v', [[0, 0], [1, 0], [2, 0]]),
  piece('L3-0', [[0, 0], [1, 0], [1, 1]]),
  piece('L3-1', [[0, 0], [0, 1], [1, 0]]),
  piece('L3-2', [[0, 0], [0, 1], [1, 1]]),
  piece('L3-3', [[0, 1], [1, 0], [1, 1]]),
  piece('I5-h', [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]),
  piece('I5-v', [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]),
  piece('L5-0', [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]]),
  piece('L5-1', [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0]]),
  piece('L5-2', [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1]]),
  piece('L5-3', [[0, 3], [1, 0], [1, 1], [1, 2], [1, 3]]),
  piece('T5-up', [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]]),
  piece('T5-right', [[0, 2], [1, 0], [1, 1], [1, 2], [2, 2]]),
  piece('T5-down', [[0, 1], [1, 1], [2, 0], [2, 1], [2, 2]]),
  piece('T5-left', [[0, 0], [1, 0], [1, 1], [1, 2], [2, 0]]),
  // 6-cell: 2x3 / 3x2 rectangle (Block Blast "Large Rectangle")
  piece('R6-h', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]),
  piece('R6-v', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]),
  // 9-cell: 3x3 big square (Block Blast "Large Square")
  piece('S9', [
    [0, 0], [0, 1], [0, 2],
    [1, 0], [1, 1], [1, 2],
    [2, 0], [2, 1], [2, 2],
  ]),
].map(({ id, cells }) => piece(id, cells.map(([row, col]) => ({ row, col })))));

const TETROMINO_TEMPLATES = Object.freeze([
  piece('I-h', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 }]),
  piece('I-v', [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }]),
  piece('O', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }]),
  piece('T-up', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 1 }]),
  piece('T-right', [{ row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 1 }]),
  piece('T-down', [{ row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }]),
  piece('T-left', [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 0 }]),
  piece('L-0', [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 2, col: 1 }]),
  piece('L-1', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }]),
  piece('L-2', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 1 }, { row: 2, col: 1 }]),
  piece('L-3', [{ row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }]),
  piece('J-0', [{ row: 0, col: 1 }, { row: 1, col: 1 }, { row: 2, col: 0 }, { row: 2, col: 1 }]),
  piece('J-1', [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }]),
  piece('J-2', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 2, col: 0 }]),
  piece('J-3', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 2 }]),
  piece('S-h', [{ row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }, { row: 1, col: 1 }]),
  piece('S-v', [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 1 }]),
  piece('Z-h', [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 1 }, { row: 1, col: 2 }]),
  piece('Z-v', [{ row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 0 }]),
]);

export const PIECE_TEMPLATES = Object.freeze([
  ...SMALL_AND_LARGE_TEMPLATES,
  ...TETROMINO_TEMPLATES,
]);

const SYSTEM_RESCUE_TEMPLATE = piece('system-rescue-1', [{ row: 0, col: 0 }]);
const TEMPLATE_BY_ID = new Map(PIECE_TEMPLATES.map((template) => [template.id, template]));
const TEMPLATES_BY_SIZE = new Map(SIZE_WEIGHTS.map(({ size }) => [
  size,
  PIECE_TEMPLATES.filter((template) => template.cells.length === size),
]));
const TOTAL_WEIGHT = SIZE_WEIGHTS.reduce((total, entry) => total + entry.weight, 0);
const TINY_MAX_SIZE = 2;
const BIG_MIN_SIZE = 4;
const MIN_BIG_PER_OPEN_RACK = 2;
const MAX_TINY_PER_OPEN_RACK = 1;

const nextRandom = (seed) => ((seed * 1664525 + 1013904223) >>> 0);

function drawUnit(seed) {
  const nextSeed = nextRandom(seed);
  return { value: nextSeed / 0x100000000, seed: nextSeed };
}

function drawTemplate(seed) {
  const sizeDraw = drawUnit(seed);
  let weightedRoll = sizeDraw.value * TOTAL_WEIGHT;
  let selectedSize = SIZE_WEIGHTS.at(-1).size;
  for (const entry of SIZE_WEIGHTS) {
    if (weightedRoll < entry.weight) {
      selectedSize = entry.size;
      break;
    }
    weightedRoll -= entry.weight;
  }

  const templateDraw = drawUnit(sizeDraw.seed);
  const templates = TEMPLATES_BY_SIZE.get(selectedSize);
  const templateIndex = Math.floor(templateDraw.value * templates.length);
  return { template: templates[templateIndex], seed: templateDraw.seed };
}

function generatedRack(seed, forcedTemplateIds = []) {
  let nextSeed = seed >>> 0;
  const rack = [];
  for (let slot = 0; slot < 3; slot += 1) {
    const forcedId = forcedTemplateIds[slot];
    if (forcedId !== undefined) {
      const template = TEMPLATE_BY_ID.get(forcedId);
      if (!template) throw new RangeError(`Unknown piece template: ${forcedId}`);
      rack.push(template);
      continue;
    }
    const draw = drawTemplate(nextSeed);
    rack.push(draw.template);
    nextSeed = draw.seed;
  }
  return { rack, seed: nextSeed };
}

function pickLegalBigTemplate(legalBigTemplates, seed, slot, replacementIndex) {
  return legalBigTemplates[(seed + slot + replacementIndex) % legalBigTemplates.length];
}

function preferBigRack(rack, legalTemplates, seed) {
  const legalBigTemplates = legalTemplates.filter((template) => template.cells.length >= BIG_MIN_SIZE);
  if (legalBigTemplates.length <= 0) return rack;

  const nextRack = rack.slice();
  let bigCount = nextRack.filter((template) => template.cells.length >= BIG_MIN_SIZE).length;
  let tinyCount = nextRack.filter((template) => template.cells.length <= TINY_MAX_SIZE).length;
  let replacementIndex = 0;

  for (let slot = 0; slot < nextRack.length; slot += 1) {
    const template = nextRack[slot];
    if (template.cells.length > TINY_MAX_SIZE) continue;
    if (tinyCount <= MAX_TINY_PER_OPEN_RACK && bigCount >= MIN_BIG_PER_OPEN_RACK) continue;

    nextRack[slot] = pickLegalBigTemplate(legalBigTemplates, seed, slot, replacementIndex);
    replacementIndex += 1;
    tinyCount -= 1;
    bigCount += 1;
  }

  for (let slot = 0; slot < nextRack.length; slot += 1) {
    const template = nextRack[slot];
    if (bigCount >= MIN_BIG_PER_OPEN_RACK) break;
    if (template.cells.length >= BIG_MIN_SIZE) continue;

    nextRack[slot] = pickLegalBigTemplate(legalBigTemplates, seed, slot, replacementIndex);
    replacementIndex += 1;
    if (template.cells.length <= TINY_MAX_SIZE) tinyCount -= 1;
    bigCount += 1;
  }

  return nextRack;
}

export function createRack({ board, seed = 1, forcedTemplateIds = [] }) {
  const generated = generatedRack(seed, forcedTemplateIds);
  const legalTemplates = PIECE_TEMPLATES.filter((template) => hasLegalPlacement(board, template));
  if (legalTemplates.length > 0) {
    const legalRack = generated.rack.map((template, index) => (
      hasLegalPlacement(board, template)
        ? template
        : legalTemplates[(seed + index) % legalTemplates.length]
    ));
    const rack = forcedTemplateIds.length > 0
      ? legalRack
      : preferBigRack(legalRack, legalTemplates, seed);
    return {
      rack,
      seed: generated.seed,
      generationId: 0,
      usedSystemRescue: false,
    };
  }

  const rack = generated.rack.slice();
  rack[0] = SYSTEM_RESCUE_TEMPLATE;
  return {
    rack,
    seed: generated.seed,
    generationId: 0,
    usedSystemRescue: true,
  };
}

export function consumeRackSlot(rackState, slot, board) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= rackState.rack.length) return rackState;
  if (rackState.rack[slot] === null) return rackState;

  const rack = rackState.rack.slice();
  rack[slot] = null;
  if (rack.some(Boolean)) return { ...rackState, rack };

  const refill = createRack({ board, seed: rackState.seed });
  return {
    ...refill,
    generationId: rackState.generationId + 1,
  };
}
