import { LEVEL_1_1 } from './level-1-1.js';

export const DRAFT_CARDS = Object.freeze([
  Object.freeze({
    id: 'split-shot',
    name: '分裂弹',
    description: '每次爆炸最多额外波及2个目标。',
    repeatable: true,
  }),
  Object.freeze({
    id: 'rapid-loader',
    name: '速射齿轮',
    description: '主角开火间隔缩短15%。',
    repeatable: true,
  }),
  Object.freeze({
    id: 'heavy-shell',
    name: '重弹头',
    description: '主角炮弹伤害提高20%。',
    repeatable: true,
  }),
  Object.freeze({
    id: 'blast-radius',
    name: '广域爆破',
    description: '主角炮弹爆炸范围扩大25%。',
    repeatable: true,
  }),
  Object.freeze({
    id: 'pierce-round',
    name: '穿甲弹',
    description: '主角炮弹对精英和首领伤害提高30%。',
    repeatable: true,
  }),
  Object.freeze({
    id: 'fire-shell',
    name: '火爆弹',
    description: '解锁火属性爆炸，炮弹命中后追加一次燃烧范围伤害。',
    repeatable: false,
  }),
]);

const INITIAL_MODIFIERS = Object.freeze({
  armorMultiplier: 1,
  damageMultiplier: 1,
  lineEnergyBonus: 0,
  heroAttackIntervalMultiplier: 1,
  heroSplashRadiusMultiplier: 1,
  heroSplashTargetsBonus: 0,
  heroEliteDamageMultiplier: 1,
  heroFireShell: false,
  heroFireDamageMultiplier: 0.35,
  emergencySinglesPerSegment: 0,
  chosenCards: [],
});

function deterministicDraft(seed, draftIndex, segmentIndex = 0, chosenCards = []) {
  const rootFireUnlocked = segmentIndex >= 3;
  const fireAlreadyOwned = chosenCards.includes('fire-shell');
  const pool = DRAFT_CARDS.filter((card) => (
    card.id !== 'fire-shell' || (rootFireUnlocked && !fireAlreadyOwned)
  ));
  const start = ((seed >>> 0) + draftIndex * 3) % pool.length;
  const cards = Array.from({ length: 3 }, (_, offset) => (
    pool[(start + offset) % pool.length]
  ));
  if (
    rootFireUnlocked
    && !fireAlreadyOwned
    && !cards.some((card) => card.id === 'fire-shell')
  ) {
    cards[2] = DRAFT_CARDS.find((card) => card.id === 'fire-shell');
  }
  return cards;
}

function applyCard(state, cardId) {
  const modifiers = {
    ...state.modifiers,
    chosenCards: [...state.modifiers.chosenCards, cardId],
  };
  let fighters = state.fighters.map((fighter) => ({ ...fighter }));
  if (cardId === 'split-shot') {
    modifiers.heroSplashTargetsBonus += 2;
    fighters = fighters.map((fighter) => ({
      ...fighter,
      splashTargets: (fighter.splashTargets ?? 4) + 2,
    }));
  } else if (cardId === 'rapid-loader') {
    modifiers.heroAttackIntervalMultiplier *= 0.85;
    fighters = fighters.map((fighter) => ({
      ...fighter,
      attackIntervalMultiplier: (fighter.attackIntervalMultiplier ?? 1) * 0.85,
    }));
  } else if (cardId === 'heavy-shell') {
    modifiers.damageMultiplier *= 1.2;
    fighters = fighters.map((fighter) => ({
      ...fighter,
      damage: fighter.damage * 1.2,
    }));
  } else if (cardId === 'blast-radius') {
    modifiers.heroSplashRadiusMultiplier *= 1.25;
    fighters = fighters.map((fighter) => {
      const splashRadius = fighter.splashRadius ?? 90;
      return { ...fighter, splashRadius: splashRadius * 1.25 };
    });
  } else if (cardId === 'pierce-round') {
    modifiers.heroEliteDamageMultiplier *= 1.3;
    fighters = fighters.map((fighter) => ({
      ...fighter,
      eliteDamageMultiplier: (fighter.eliteDamageMultiplier ?? 1) * 1.3,
    }));
  } else if (cardId === 'fire-shell') {
    modifiers.heroFireShell = true;
    fighters = fighters.map((fighter) => ({
      ...fighter,
      fireShell: true,
      fireDamageMultiplier: modifiers.heroFireDamageMultiplier,
    }));
  } else return state;
  return {
    ...state,
    modifiers,
    fighters,
    events: [...state.events, { type: 'card-selected', cardId }],
  };
}

export function openEnergyDraft(state, sequence = 1) {
  if (state.phase === 'victory' || state.phase === 'defeat') return state;
  const draftIndex = state.segmentIndex + state.modifiers.chosenCards.length + sequence;
  return {
    ...state,
    phase: 'draft',
    draft: {
      segmentIndex: state.segmentIndex,
      cards: deterministicDraft(
        state.seed,
        draftIndex,
        state.segmentIndex,
        state.modifiers.chosenCards,
      ),
      selectedCardId: null,
      reason: 'energy-full',
      sequence,
    },
    events: [
      ...state.events,
      { type: 'draft-opened', segmentIndex: state.segmentIndex, reason: 'energy-full', sequence },
    ],
  };
}

export function selectEnergyDraftCard(state, cardId, resumePhase = 'active') {
  if (state.phase !== 'draft' || state.draft?.reason !== 'energy-full' || state.draft.selectedCardId) {
    return state;
  }
  const offered = state.draft.cards.some((card) => card.id === cardId);
  if (!offered) return state;
  const selected = applyCard(state, cardId);
  return {
    ...selected,
    phase: resumePhase,
    draft: null,
    events: [
      ...selected.events,
      { type: 'draft-closed', reason: 'energy-full', cardId },
    ],
  };
}

export function createExpeditionState({
  level = LEVEL_1_1,
  seed = 1,
  fighters = [],
  wallHp = level.wallHp,
} = {}) {
  const segment = level.segments[0];
  return {
    level,
    seed,
    phase: 'prep',
    segmentIndex: 0,
    segment,
    fighters,
    wallHp,
    modifiers: { ...INITIAL_MODIFIERS, chosenCards: [] },
    draft: null,
    events: [{ type: 'segment-start', segmentId: segment.id }],
  };
}

export function advanceExpedition(state, event) {
  if (!event?.type) return state;
  if (event.type === 'go' && state.phase === 'prep') {
    return {
      ...state,
      phase: 'active',
      events: [...state.events, { type: 'go', segmentId: state.segment.id }],
    };
  }
  if (event.type === 'capture-combat' && state.phase === 'active') {
    return {
      ...state,
      fighters: event.fighters ?? state.fighters,
      wallHp: event.wallHp ?? state.wallHp,
    };
  }
  if (
    event.type === 'segment-cleared'
    && (state.phase === 'active' || state.phase === 'prep')
  ) {
    if (state.segmentIndex === state.level.segments.length - 1) {
      return {
        ...state,
        phase: 'victory',
        draft: null,
        events: [...state.events, { type: 'level-victory' }],
      };
    }
    return state;
  }
  if (event.type === 'select-card' && state.phase === 'draft' && !state.draft.selectedCardId) {
    const offered = state.draft.cards.some((card) => card.id === event.cardId);
    if (!offered) return state;
    const selected = applyCard(state, event.cardId);
    const segmentIndex = selected.segmentIndex + 1;
    const segment = selected.level.segments[segmentIndex];
    return {
      ...selected,
      phase: 'prep',
      segmentIndex,
      segment,
      draft: { ...selected.draft, selectedCardId: event.cardId },
      events: [
        ...selected.events,
        { type: 'segment-start', segmentId: segment.id },
      ],
    };
  }
  return state;
}
