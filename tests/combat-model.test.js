import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENEMY_PROFILES,
  FIGHTER_FRONT_LIMIT,
  ROLE_PROFILES,
  createCombatState,
  deployFighter,
  spawnEnemy,
  stepCombat,
} from '../src/combat-model.js';

test('four roles expose different tactical behavior', () => {
  assert.equal(ROLE_PROFILES.bare.attackType, 'dash-punch');
  assert.equal(ROLE_PROFILES.sword.attackType, 'cleave');
  assert.equal(ROLE_PROFILES.shield.attackType, 'bash-block');
  assert.equal(ROLE_PROFILES.cannon.attackType, 'projectile-splash');
  assert.equal(ROLE_PROFILES.cannon.holdRear, true);
  assert.ok(ROLE_PROFILES.shield.blockChance > 0);
});

test('base hero cannon needs three to four pre-rogue hits to kill a grunt', () => {
  let state = createCombatState();
  state = deployFighter(state, { id: 'opening-hero', weaponFamily: 'hero' });
  const hero = state.fighters[0];
  const hitsToKillGrunt = Math.ceil(ENEMY_PROFILES.grunt.hp / hero.damage);

  assert.equal(hero.damage, 14);
  assert.ok(hero.damage < ENEMY_PROFILES.grunt.hp);
  assert.ok(hitsToKillGrunt >= 3 && hitsToKillGrunt <= 4);
});

test('standard fast enemies also need at least three base hero cannon hits', () => {
  let state = createCombatState();
  state = deployFighter(state, { id: 'opening-hero', weaponFamily: 'hero' });
  const hero = state.fighters[0];

  assert.ok(Math.ceil(ENEMY_PROFILES.runner.hp / hero.damage) >= 3);
  assert.ok(Math.ceil(ENEMY_PROFILES.shooter.hp / hero.damage) >= 3);
});

test('bare fighter dashes into range and exposes a dash-punch event pair', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'heavy', { id: 'dash-target', x: 195, y: 100, hp: 500 });
  state = deployFighter(state, { id: 'bare', weaponFamily: 'bare', x: 195, y: 0 });
  state = stepCombat(state, 1 / 30);
  const dash = state.events.find((event) => event.type === 'fighter-dash');
  assert.equal(dash.enemyId, 'dash-target');
  assert.ok(dash.distance > ROLE_PROFILES.bare.moveSpeed / 30);
  assert.equal(state.events.some((event) => event.type === 'fighter-windup'), true);
  state = stepCombat(state, 0.2);
  const punch = state.events.find((event) => event.type === 'fighter-attack' && event.attackType === 'dash-punch');
  assert.equal(punch.enemyId, 'dash-target');
});

test('walking fighters advance slowly and hold the readable front at y 900', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'grunt', { id: 'front-target', x: 195, y: 1000, hp: 40 });
  state = deployFighter(state, { id: 'front-sword', weaponFamily: 'sword', x: 195, y: 899 });
  state = stepCombat(state, 1 / 30);
  assert.equal(FIGHTER_FRONT_LIMIT, 900);
  assert.equal(state.fighters[0].y, 899);
  assert.equal(state.events.some((event) => event.type === 'fighter-attack'), false);

  state = stepCombat(state, 4);
  assert.ok(state.fighters[0].y <= FIGHTER_FRONT_LIMIT);
  assert.equal(state.enemies.length, 0);
  assert.equal(state.events.some((event) => (
    event.type === 'fighter-attack' && event.fighterId === 'front-sword'
  )), true);
});

test('bare dash clamps to the same front limit and remains fixed-step stable while waiting to attack', () => {
  let frameState = createCombatState();
  frameState = spawnEnemy(frameState, 'heavy', { id: 'limited-dash-target', x: 195, y: 980, hp: 500, targetable: true });
  frameState = deployFighter(frameState, { id: 'limited-bare', weaponFamily: 'bare', x: 195, y: 880 });
  let batchedState = structuredClone(frameState);

  frameState = stepCombat(frameState, 1 / 30);
  const dash = frameState.events.find((event) => event.type === 'fighter-dash');
  assert.equal(frameState.fighters[0].y, FIGHTER_FRONT_LIMIT);
  assert.equal(dash.to.y, FIGHTER_FRONT_LIMIT);
  assert.equal(frameState.events.some((event) => event.type === 'fighter-attack'), false);

  for (let index = 1; index < 60; index += 1) frameState = stepCombat(frameState, 1 / 30);
  batchedState = stepCombat(batchedState, 2);
  assert.deepEqual(frameState.fighters, batchedState.fighters);
  assert.deepEqual(frameState.enemies, batchedState.enemies);
  assert.deepEqual(frameState.events, batchedState.events);
  assert.ok(frameState.fighters[0].y <= FIGHTER_FRONT_LIMIT);
  assert.equal(frameState.events.some((event) => (
    event.type === 'fighter-attack' && event.fighterId === 'limited-bare'
  )), true);
});

test('fighter walking speeds stay readable and a bare dash covers at most sixty world units', () => {
  assert.ok(ROLE_PROFILES.bare.moveSpeed <= 40);
  assert.ok(ROLE_PROFILES.sword.moveSpeed <= 35);
  assert.ok(ROLE_PROFILES.shield.moveSpeed <= 30);

  let state = createCombatState();
  state = spawnEnemy(state, 'fragment', { id: 'dash-cap-target', x: 195, y: 710, hp: 500 });
  state = deployFighter(state, { id: 'dash-cap-bare', weaponFamily: 'bare', x: 195, y: 590 });
  state = stepCombat(state, 1 / 30);
  const dash = state.events.find((event) => event.type === 'fighter-dash');
  assert.equal(dash.distance, 60);
  assert.equal(dash.to.y, 650);
  assert.equal(state.events.some((event) => event.type === 'fighter-attack'), false);
});

test('sword cleave damages no more than three nearby enemies', () => {
  let state = createCombatState();
  for (let index = 0; index < 4; index += 1) {
    state = spawnEnemy(state, 'heavy', { id: `cleave-${index}`, x: 180 + index * 10, y: 40, hp: 500 });
  }
  state = deployFighter(state, { id: 'sword', weaponFamily: 'sword', x: 195, y: 0 });
  state = stepCombat(state, 0.3);
  const hits = state.events.filter((event) => event.type === 'fighter-attack' && event.attackType === 'cleave');
  assert.equal(hits.length, 3);
  assert.equal(new Set(hits.map((event) => event.enemyId)).size, 3);
  assert.equal(state.enemies.filter((enemy) => enemy.hp < 500).length, 3);
});

test('shield bash staggers and knocks back its target', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'heavy', { id: 'bash-target', x: 195, y: 50, hp: 500 });
  state = deployFighter(state, { id: 'shield', weaponFamily: 'shield', x: 195, y: 0 });
  state = stepCombat(state, 0.4);
  const enemy = state.enemies.find((unit) => unit.id === 'bash-target');
  assert.equal(state.events.some((event) => event.type === 'shield-bash' && event.enemyId === enemy.id), true);
  assert.ok(enemy.y > 50);
  assert.ok(enemy.staggerRemaining > 0);
});

test('shield block reduces incoming damage and emits readable feedback', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'heavy', { id: 'block-attacker', x: 195, y: 40, hp: 500 });
  state = deployFighter(state, { id: 'shield-blocker', weaponFamily: 'shield', x: 195, y: 0, cooldown: 1 });
  const hpBefore = state.fighters[0].hp;
  state = stepCombat(state, 0.5);
  const block = state.events.find((event) => event.type === 'shield-block');
  assert.equal(block.enemyId, 'block-attacker');
  assert.equal(block.fighterId, 'shield-blocker');
  assert.ok(state.fighters[0].hp > hpBefore - ENEMY_PROFILES.heavy.damage);
});

test('cannon fires a projectile event and its impact splashes multiple nearby enemies', () => {
  let state = createCombatState();
  for (let index = 0; index < 3; index += 1) {
    state = spawnEnemy(state, 'heavy', { id: `splash-${index}`, x: 180 + index * 15, y: 600, hp: 500 });
  }
  state = deployFighter(state, { id: 'cannon', weaponFamily: 'cannon', x: 195, y: 60 });
  state = stepCombat(state, 0.4);
  const fired = state.events.find((event) => event.type === 'projectile-fired');
  const impact = state.events.find((event) => event.type === 'projectile-impact');
  assert.equal(fired.fighterId, 'cannon');
  assert.equal(impact.projectileId, fired.projectileId);
  assert.equal(impact.enemyIds.length, 3);
  assert.equal(state.enemies.filter((enemy) => enemy.hp < 500).length, 3);
});

test('runner reaches the wall before the grunt and commander telegraphs', () => {
  assert.ok(ENEMY_PROFILES.runner.moveSpeed > ENEMY_PROFILES.grunt.moveSpeed);
  assert.ok(ENEMY_PROFILES.commander.telegraphSeconds >= 1);
  assert.ok(ENEMY_PROFILES.commander.scale >= 1.65);
  assert.notEqual(ENEMY_PROFILES.runner.silhouette, ENEMY_PROFILES.grunt.silhouette);
});

test('v1 boss is large but no longer a six-thousand-hp damage sponge', () => {
  assert.ok(ENEMY_PROFILES.commander.scale > ENEMY_PROFILES.heavy.scale);
  assert.ok(ENEMY_PROFILES.commander.radius > ENEMY_PROFILES.heavy.radius);
  assert.ok(ENEMY_PROFILES.commander.hp <= ENEMY_PROFILES.grunt.hp * 28);
  assert.ok(ENEMY_PROFILES.commander.attackCadence >= 3);
});

test('fire shell adds a fire explosion layer to hero cannon impacts', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'heavy', { id: 'main', x: 195, y: 600, hp: 500 });
  state = spawnEnemy(state, 'grunt', { id: 'nearby', x: 235, y: 600, hp: 500 });
  state = deployFighter(state, {
    id: 'fire-hero',
    weaponFamily: 'hero',
    x: 195,
    y: 60,
    fireShell: true,
    fireDamageMultiplier: 0.35,
  });
  state = stepCombat(state, 0.4);
  const fire = state.events.find((event) => event.type === 'fire-explosion');
  const impact = state.events.find((event) => event.type === 'projectile-impact');
  assert.equal(fire.projectileId, impact.projectileId);
  assert.equal(impact.element, 'fire');
  assert.equal(fire.element, 'fire');
  assert.equal(fire.enemyIds.includes('nearby'), true);
  assert.ok(state.enemies.find((enemy) => enemy.id === 'nearby').hp < 500);
});

test('fixed-step combat produces the same state for frame-sized and batched dt', () => {
  let frameState = createCombatState();
  frameState = spawnEnemy(frameState, 'grunt', { y: 120 });
  let batchedState = structuredClone(frameState);
  for (let i = 0; i < 30; i += 1) frameState = stepCombat(frameState, 1 / 30);
  batchedState = stepCombat(batchedState, 1);
  assert.equal(frameState.enemies[0].y, batchedState.enemies[0].y);
  assert.equal(frameState.time, batchedState.time);
});

test('role-specific damage and events are fixed-step stable for frame-sized and batched dt', () => {
  let frameState = createCombatState();
  for (let index = 0; index < 3; index += 1) {
    frameState = spawnEnemy(frameState, 'heavy', { id: `stable-${index}`, x: 180 + index * 15, y: 600, hp: 900 });
  }
  frameState = deployFighter(frameState, { id: 'stable-cannon', weaponFamily: 'cannon', x: 195, y: 60 });
  let batchedState = structuredClone(frameState);
  for (let index = 0; index < 30; index += 1) frameState = stepCombat(frameState, 1 / 30);
  batchedState = stepCombat(batchedState, 1);
  assert.deepEqual(frameState.enemies, batchedState.enemies);
  assert.deepEqual(frameState.events, batchedState.events);
});

test('elite keeps its class behavior while gaining the specified hp and readable size', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'runner', { elite: true });
  const elite = state.enemies[0];
  assert.equal(elite.hp, ENEMY_PROFILES.runner.hp * 1.35);
  assert.equal(elite.moveSpeed, ENEMY_PROFILES.runner.moveSpeed);
  assert.equal(elite.scale, ENEMY_PROFILES.runner.scale * 1.15);
});

test('super deployment lands with a global impact and emits its recurring skill every eight active seconds', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'commander', { y: 500 });
  state = deployFighter(state, { id: 'super-sword', weaponFamily: 'sword', weaponLevel: 1, isSuper: true, cells: Array(16).fill({ row: 0, col: 0 }) });
  assert.equal(state.events.some((event) => event.type === 'super-land'), true);
  const hpAfterLanding = state.enemies[0].hp;
  state = stepCombat(state, 8);
  assert.equal(state.events.some((event) => event.type === 'super-skill' && event.role === 'sword'), true);
  assert.ok(state.enemies[0].hp < hpAfterLanding);
});

test('preparation freezes combat and super cooldown until GO', () => {
  let state = createCombatState({ phase: 'prep' });
  state = deployFighter(state, { id: 'super', weaponFamily: 'bare', isSuper: true });
  const before = state.fighters[0].superCooldownRemaining;
  state = stepCombat(state, 10);
  assert.equal(state.fighters[0].superCooldownRemaining, before);
  assert.equal(state.time, 0);
});

test('a side-lane grunt steers toward an interceptable fighter instead of bypassing it', () => {
  const fighter = {
    id: 'guard', role: 'shield', weaponFamily: 'shield',
    hp: 160, maxHp: 160, damage: 22, blockChance: 0.25,
    x: 195, y: 400, cooldown: 0, cells: [],
  };
  let state = createCombatState({ fighters: [fighter] });
  state = spawnEnemy(state, 'grunt', { id: 'side', x: 280, y: 520 });
  state = stepCombat(state, 1);
  const grunt = state.enemies.find((unit) => unit.id === 'side');
  assert.ok(grunt.x < 280);
  assert.ok(grunt.y < 520);
  assert.equal(state.events.some((event) => event.type === 'wall-hit'), false);
});

test('a spawn at the protected edge becomes targetable only after crossing the protection line', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'grunt');
  assert.equal(state.enemies[0].targetable, false);
  state = stepCombat(state, 1);
  assert.equal(state.enemies[0].targetable, true);
});

test('a protected spawn cannot wind up against a nearby front fighter', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'grunt', { x: 195, y: 1000 });
  state = deployFighter(state, { id: 'front', weaponFamily: 'sword', x: 195, y: 899, cooldown: 1 });
  state = stepCombat(state, 0.7);
  assert.equal(state.events.some((event) => event.type === 'enemy-windup'), false);
});

test('combat emits windup then positioned impact, hurt, and death', () => {
  let state = createCombatState();
  state = spawnEnemy(state, 'grunt', { id: 'victim', x: 195, y: 40, hp: 1, maxHp: 40 });
  state = deployFighter(state, { id: 'sword', weaponFamily: 'sword', x: 195, y: 0 });
  state = stepCombat(state, 1);
  const types = state.events.map((event) => event.type);
  assert.ok(types.indexOf('fighter-windup') < types.indexOf('fighter-attack'));
  assert.ok(types.indexOf('fighter-attack') < types.indexOf('unit-hurt'));
  assert.ok(types.indexOf('unit-hurt') < types.indexOf('unit-death'));
  for (const event of state.events.filter((item) => ['fighter-attack', 'unit-hurt'].includes(item.type))) {
    assert.equal(Number.isFinite(event.sourceX), true);
    assert.equal(Number.isFinite(event.targetX), true);
    assert.equal(Number.isFinite(event.sourceY), true);
    assert.equal(Number.isFinite(event.targetY), true);
  }
});
