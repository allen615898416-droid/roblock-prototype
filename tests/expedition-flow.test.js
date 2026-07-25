import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DRAFT_CARDS,
  advanceExpedition,
  createExpeditionState,
  openEnergyDraft,
} from '../src/expedition-flow.js';

const CARD_IDS = [
  'split-shot',
  'rapid-loader',
  'heavy-shell',
  'blast-radius',
  'pierce-round',
  'fire-shell',
];

function draftFor(cardId, options = {}) {
  const state = createExpeditionState(options);
  return {
    ...state,
    phase: 'draft',
    draft: {
      segmentIndex: state.segmentIndex,
      cards: DRAFT_CARDS,
      selectedCardId: null,
    },
  };
}

test('defines exactly the six explicit hero-shell upgrade cards including the S4 fire root', () => {
  assert.deepEqual(DRAFT_CARDS.map(({ id }) => id), CARD_IDS);
  assert.equal(DRAFT_CARDS.every(({ repeatable }) => typeof repeatable === 'boolean'), true);
  assert.equal(DRAFT_CARDS.every(({ name, description }) => (
    typeof name === 'string' && name.length > 0
    && typeof description === 'string' && description.length > 0
  )), true);
});

test('fire shell is held out of early drafts and forced into S4 to S6 as a root card', () => {
  const early = createExpeditionState({ seed: 1 });
  const earlyDraft = openEnergyDraft({
    ...early,
    phase: 'active',
    segmentIndex: 1,
    segment: early.level.segments[1],
  }, 1);
  assert.equal(earlyDraft.draft.cards.some((card) => card.id === 'fire-shell'), false);

  const s4 = createExpeditionState({ seed: 1 });
  const s4Draft = openEnergyDraft({
    ...s4,
    phase: 'active',
    segmentIndex: 3,
    segment: s4.level.segments[3],
  }, 1);
  assert.equal(s4Draft.draft.cards.some((card) => card.id === 'fire-shell'), true);
});

test('segment clear never opens a draft and only the final segment can win', () => {
  const state = createExpeditionState({ seed: 17 });
  const active = advanceExpedition(state, { type: 'go' });
  const ignored = advanceExpedition(active, { type: 'segment-cleared' });

  assert.equal(ignored, active);
  assert.equal(ignored.draft, null);
  assert.equal(ignored.events.some(({ type }) => type === 'draft-opened'), false);

  const finalSegmentIndex = state.level.segments.length - 1;
  const final = {
    ...active,
    segmentIndex: finalSegmentIndex,
    segment: state.level.segments[finalSegmentIndex],
  };
  const victory = advanceExpedition(final, { type: 'segment-cleared' });
  assert.equal(victory.phase, 'victory');
  assert.equal(victory.draft, null);
  assert.equal(victory.events.at(-1).type, 'level-victory');
});

test('hero projectile cards update only their explicit modifiers', () => {
  const expectations = {
    'split-shot': ['heroSplashTargetsBonus', 2],
    'rapid-loader': ['heroAttackIntervalMultiplier', 0.85],
    'heavy-shell': ['damageMultiplier', 1.2],
    'blast-radius': ['heroSplashRadiusMultiplier', 1.25],
    'pierce-round': ['heroEliteDamageMultiplier', 1.3],
    'fire-shell': ['heroFireShell', true],
  };

  for (const [cardId, [key, value]] of Object.entries(expectations)) {
    const before = draftFor(cardId);
    const after = advanceExpedition(before, { type: 'select-card', cardId });
    assert.equal(after.modifiers[key], value, cardId);
    assert.deepEqual(after.modifiers.chosenCards, [cardId], cardId);
    for (const unchanged of [
      'armorMultiplier',
      'damageMultiplier',
      'lineEnergyBonus',
      'heroAttackIntervalMultiplier',
      'heroSplashRadiusMultiplier',
      'heroSplashTargetsBonus',
      'heroEliteDamageMultiplier',
      'heroFireShell',
      'emergencySinglesPerSegment',
    ].filter((name) => name !== key)) {
      assert.equal(after.modifiers[unchanged], before.modifiers[unchanged], `${cardId}:${unchanged}`);
    }
  }
});

test('projectile cards update existing hero cannon stats immediately', () => {
  const fighter = {
    id: 'veteran',
    role: 'hero',
    weaponFamily: 'hero',
    hp: 55,
    maxHp: 110,
    damage: 40,
    attackIntervalMultiplier: 1,
    splashRadius: 90,
    splashTargets: 4,
    eliteDamageMultiplier: 1,
  };
  const split = advanceExpedition(draftFor('split-shot', { fighters: [fighter] }), {
    type: 'select-card',
    cardId: 'split-shot',
  });
  assert.equal(split.modifiers.heroSplashTargetsBonus, 2);
  assert.equal(split.fighters[0].splashTargets, 6);

  const rapid = advanceExpedition(draftFor('rapid-loader', { fighters: [fighter] }), {
    type: 'select-card',
    cardId: 'rapid-loader',
  });
  assert.equal(rapid.modifiers.heroAttackIntervalMultiplier, 0.85);
  assert.equal(rapid.fighters[0].attackIntervalMultiplier, 0.85);

  const heavy = advanceExpedition(draftFor('heavy-shell', { fighters: [fighter] }), {
    type: 'select-card',
    cardId: 'heavy-shell',
  });
  assert.equal(heavy.modifiers.damageMultiplier, 1.2);
  assert.equal(heavy.fighters[0].damage, 48);

  const fire = advanceExpedition(draftFor('fire-shell', { fighters: [fighter] }), {
    type: 'select-card',
    cardId: 'fire-shell',
  });
  assert.equal(fire.modifiers.heroFireShell, true);
  assert.equal(fire.fighters[0].fireShell, true);
});

test('a card can only be selected from the currently offered draft', () => {
  const state = {
    ...draftFor('blast-radius'),
    draft: {
      segmentIndex: 0,
      cards: DRAFT_CARDS.slice(0, 3),
      selectedCardId: null,
    },
  };
  assert.equal(advanceExpedition(state, { type: 'select-card', cardId: 'blast-radius' }), state);
});
