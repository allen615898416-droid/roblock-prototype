const STEP = 1 / 30;
export const FIGHTER_FRONT_LIMIT = 900;

export const ROLE_PROFILES = Object.freeze({
  hero: { attackType: 'hero-cannon', hpMultiplier: 2.2, damageMultiplier: 0.35, attackInterval: 0.75, moveSpeed: 0, attackRange: 900, blockChance: 0, holdRear: true },
  bare: { attackType: 'dash-punch', hpMultiplier: 1, damageMultiplier: 0.8, attackInterval: 0.8, moveSpeed: 38, attackRange: 40, blockChance: 0, holdRear: false },
  sword: { attackType: 'cleave', hpMultiplier: 1.1, damageMultiplier: 1.45, attackInterval: 1, moveSpeed: 34, attackRange: 48, blockChance: 0, holdRear: false },
  shield: { attackType: 'bash-block', hpMultiplier: 1.6, damageMultiplier: 0.55, attackInterval: 1.25, moveSpeed: 28, attackRange: 48, blockChance: 0.25, holdRear: false },
  cannon: { attackType: 'projectile-splash', hpMultiplier: 0.65, damageMultiplier: 0.9, attackInterval: 1 / 1.1, moveSpeed: 0, attackRange: 900, blockChance: 0, holdRear: true },
});

export const ENEMY_PROFILES = Object.freeze({
  grunt: { hp: 40, damage: 6, attackCadence: 1.15, moveSpeed: 72, attackRange: 36, scale: 1, silhouette: 'square-grunt', radius: 22 },
  runner: { hp: 36, damage: 4, attackCadence: 0.95, moveSpeed: 104, attackRange: 32, scale: 0.86, silhouette: 'lean-runner', radius: 18 },
  heavy: { hp: 90, damage: 10, attackCadence: 1.35, moveSpeed: 52, attackRange: 44, scale: 1.3, silhouette: 'wide-heavy', radius: 32 },
  fragment: { hp: 14, damage: 3, attackCadence: 0.8, moveSpeed: 90, attackRange: 28, scale: 0.55, silhouette: 'tiny-fragment', radius: 12 },
  shooter: { hp: 36, damage: 7, attackCadence: 1.55, moveSpeed: 63, attackRange: 350, scale: 1.05, silhouette: 'crystal-shooter', radius: 20 },
  commander: { hp: 920, damage: 10, attackCadence: 3.6, moveSpeed: 43, attackRange: 56, scale: 1.75, silhouette: 'wide-slam-commander', radius: 42, telegraphSeconds: 1.3 },
});

const weaponMultiplier = { 1: 1, 2: 1.2, 3: 1.45, 4: 1.75 };
const cannonMultiplier = { 1: 1, 2: 1.15, 3: 1.32, 4: 1.5 };
const superSkillMultiplier = { hero: 1, bare: 1, sword: 1.25, shield: 0.65, cannon: 1 };
const BARE_DASH_RANGE = 120;
const BARE_DASH_MAX_DISTANCE = 60;
const SHIELD_BASH_STAGGER = 0.35;
const SHIELD_BASH_KNOCKBACK = 18;
const CANNON_SPLASH_RADIUS = 90;
const TARGETABLE_Y = 950;
const ENEMY_SPAWN_Y = 1000;
const WINDUP_SECONDS = Object.freeze({
  hero: 0.28, bare: 0.12, sword: 0.22, shield: 0.28, cannon: 0.35,
  grunt: 0.24, runner: 0.14, heavy: 0.38, fragment: 0.12, shooter: 0.4, commander: 1.3,
});
const copyEvent = (state, event) => ({ ...state, events: [...state.events, event].slice(-100) });
const roleFor = (fighter) => fighter.weaponFamily ?? fighter.weapon ?? 'bare';
const alive = (unit) => unit.hp > 0;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createCombatState({ phase = 'active', wallHp = 1000, fighters = [], enemies = [] } = {}) {
  const withAttackState = (unit) => ({
    ...unit,
    engagedTargetId: unit.engagedTargetId ?? null,
    windupRemaining: unit.windupRemaining ?? 0,
    pendingAttack: unit.pendingAttack ?? null,
  });
  return {
    phase, wallHp, fighters: fighters.map(withAttackState), enemies: enemies.map(withAttackState),
    time: 0, ticks: 0, accumulator: 0, fixedStep: STEP, events: [], nextId: fighters.length + enemies.length + 1,
  };
}

export function spawnEnemy(state, type, options = {}) {
  const profile = ENEMY_PROFILES[type];
  if (!profile) throw new Error(`Unknown enemy profile: ${type}`);
  const elite = options.elite ?? false;
  const enemy = {
    id: options.id ?? `enemy-${state.nextId}`, type, elite, hp: options.hp ?? profile.hp * (elite ? 1.35 : 1), maxHp: options.maxHp ?? profile.hp * (elite ? 1.35 : 1),
    damage: profile.damage, moveSpeed: profile.moveSpeed, attackCadence: profile.attackCadence, attackRange: profile.attackRange, scale: profile.scale * (elite ? 1.15 : 1),
    silhouette: profile.silhouette, x: options.x ?? 195, y: options.y ?? ENEMY_SPAWN_Y, cooldown: options.cooldown ?? 0, telegraphRemaining: 0,
    staggerRemaining: options.staggerRemaining ?? 0, targetable: options.targetable ?? ((options.y ?? ENEMY_SPAWN_Y) <= TARGETABLE_Y),
    engagedTargetId: options.engagedTargetId ?? null, windupRemaining: options.windupRemaining ?? 0, pendingAttack: options.pendingAttack ?? null,
  };
  return { ...state, enemies: [...state.enemies, enemy], nextId: state.nextId + 1 };
}

export function deployFighter(state, snapshot) {
  const role = roleFor(snapshot);
  const profile = ROLE_PROFILES[role];
  if (!profile) throw new Error(`Unknown fighter role: ${role}`);
  const weaponLevel = Math.min(4, Math.max(1, snapshot.weaponLevel ?? 1));
  const weaponBonus = role === 'sword' ? weaponMultiplier[weaponLevel] : role === 'cannon' ? cannonMultiplier[weaponLevel] : 1;
  const superMultiplier = snapshot.isSuper ? 1.5 : 1;
  const maxHp = snapshot.maxHp ?? 100 * profile.hpMultiplier * superMultiplier;
  const fighter = {
    id: snapshot.id ?? `fighter-${state.nextId}`, role, weaponFamily: role, weaponLevel, isSuper: Boolean(snapshot.isSuper), cells: snapshot.cells ?? [],
    hp: snapshot.hp ?? maxHp, maxHp, damage: (snapshot.damage ?? 40 * profile.damageMultiplier * weaponBonus) * (snapshot.isSuper ? 1.25 : 1),
    x: snapshot.x ?? 195, y: snapshot.y ?? (profile.holdRear ? 60 : 0), cooldown: snapshot.cooldown ?? 0, superCooldownRemaining: snapshot.isSuper ? (snapshot.superCooldownRemaining ?? 8) : null,
    attackType: profile.attackType, holdRear: profile.holdRear, blockChance: profile.blockChance,
    attackIntervalMultiplier: snapshot.attackIntervalMultiplier ?? 1,
    splashRadius: snapshot.splashRadius ?? CANNON_SPLASH_RADIUS,
    splashTargets: snapshot.splashTargets ?? 4,
    eliteDamageMultiplier: snapshot.eliteDamageMultiplier ?? 1,
    fireShell: Boolean(snapshot.fireShell),
    fireDamageMultiplier: snapshot.fireDamageMultiplier ?? 0.35,
    engagedTargetId: snapshot.engagedTargetId ?? null, windupRemaining: snapshot.windupRemaining ?? 0, pendingAttack: snapshot.pendingAttack ?? null,
  };
  let next = { ...state, fighters: [...state.fighters, fighter], nextId: state.nextId + 1 };
  if (fighter.isSuper) {
    const enemies = next.enemies.map((enemy) => ({ ...enemy, hp: Math.max(0, enemy.hp - fighter.damage * 0.5) }));
    next = copyEvent({ ...next, enemies }, { type: 'super-land', fighterId: fighter.id, role, damage: fighter.damage * 0.5, shockwave: true });
  }
  return next;
}

export function sourceTargetMeta(source, target) {
  return {
    sourceId: source.id,
    targetId: target?.id ?? 'wall',
    sourceX: source.x,
    sourceY: source.y,
    targetX: target?.x ?? 195,
    targetY: target?.y ?? 0,
  };
}

function canIntercept(enemy, fighter) {
  return alive(fighter) && fighter.y <= enemy.y + enemy.attackRange;
}

function chooseEnemyTarget(enemy, fighters) {
  const engaged = fighters.find((fighter) => fighter.id === enemy.engagedTargetId);
  if (engaged && canIntercept(enemy, engaged)) return engaged;
  return fighters
    .filter((fighter) => canIntercept(enemy, fighter))
    .sort((a, b) => distance(enemy, a) - distance(enemy, b) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

function moveToward(unit, target, speed) {
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  return {
    x: unit.x + (dx / magnitude) * speed * STEP,
    y: Math.max(0, unit.y + (dy / magnitude) * speed * STEP),
  };
}

function setFighter(state, fighterId, update) {
  return { ...state, fighters: state.fighters.map((fighter) => fighter.id === fighterId ? { ...fighter, ...update } : fighter) };
}

function setEnemy(state, enemyId, update) {
  return { ...state, enemies: state.enemies.map((enemy) => enemy.id === enemyId ? { ...enemy, ...update } : enemy) };
}

function damageEnemy(state, source, target, amount, event) {
  if (!target || !alive(target)) return state;
  const meta = sourceTargetMeta(source, target);
  const hp = Math.max(0, target.hp - amount);
  let next = copyEvent({
    ...state,
    enemies: state.enemies.map((enemy) => enemy.id === target.id ? { ...enemy, hp } : enemy),
  }, { ...event, ...meta });
  next = copyEvent(next, { type: 'unit-hurt', unitKind: 'enemy', unitId: target.id, ...meta, damage: amount });
  if (hp <= 0) next = copyEvent(next, {
    type: 'unit-death', unitKind: 'enemy', unitId: target.id, x: target.x, y: target.y, sourceId: source.id,
  });
  return next;
}

function damageFighter(state, source, target, amount, event) {
  if (!target || !alive(target)) return state;
  const meta = sourceTargetMeta(source, target);
  const hp = Math.max(0, target.hp - amount);
  let next = copyEvent({
    ...state,
    fighters: state.fighters.map((fighter) => fighter.id === target.id ? { ...fighter, hp } : fighter),
  }, { ...event, ...meta });
  next = copyEvent(next, { type: 'unit-hurt', unitKind: 'fighter', unitId: target.id, ...meta, damage: amount });
  if (hp <= 0) next = copyEvent(next, {
    type: 'unit-death', unitKind: 'fighter', unitId: target.id, x: target.x, y: target.y, sourceId: source.id,
  });
  return next;
}

function beginFighterWindup(state, fighter, target) {
  const next = setFighter(state, fighter.id, {
    windupRemaining: WINDUP_SECONDS[fighter.role],
    pendingAttack: { targetId: target.id, targetKind: 'enemy' },
  });
  return copyEvent(next, {
    type: 'fighter-windup', fighterId: fighter.id, enemyId: target.id, role: fighter.role,
    attackType: fighter.attackType, seconds: WINDUP_SECONDS[fighter.role], ...sourceTargetMeta(fighter, target),
  });
}

function resolveFighterAttack(state, fighter, target) {
  const profile = ROLE_PROFILES[fighter.role];
  const activeEnemies = state.enemies.filter(alive).filter((enemy) => enemy.targetable);
  let next = state;
  if (fighter.role === 'shield') {
    next = copyEvent(setEnemy(next, target.id, {
      y: Math.min(ENEMY_SPAWN_Y, target.y + SHIELD_BASH_KNOCKBACK), staggerRemaining: SHIELD_BASH_STAGGER,
    }), {
      type: 'shield-bash', fighterId: fighter.id, enemyId: target.id,
      staggerSeconds: SHIELD_BASH_STAGGER, knockback: SHIELD_BASH_KNOCKBACK, ...sourceTargetMeta(fighter, target),
    });
  }
  if (fighter.attackType === 'projectile-splash' || fighter.attackType === 'hero-cannon') {
    const projectileId = `projectile-${next.ticks}-${fighter.id}`;
    const splashRadius = Math.max(1, fighter.splashRadius ?? CANNON_SPLASH_RADIUS);
    const splashTargets = Math.max(1, Math.round(fighter.splashTargets ?? 4));
    const victims = activeEnemies.filter((enemy) => distance(enemy, target) <= splashRadius).slice(0, splashTargets);
    next = copyEvent(next, { type: 'projectile-fired', projectileId, fighterId: fighter.id, targetId: target.id, role: fighter.role, ...sourceTargetMeta(fighter, target) });
    for (const victim of victims) {
      const armorPierce = (victim.elite || victim.type === 'commander') ? (fighter.eliteDamageMultiplier ?? 1) : 1;
      const amount = fighter.damage * (victim.id === target.id ? 1 : 0.6) * armorPierce;
      next = damageEnemy(next, fighter, victim, amount, {
        type: 'fighter-attack', role: fighter.role, attackType: fighter.attackType,
        fighterId: fighter.id, enemyId: victim.id, amount, projectileId,
      });
    }
    let fireEnemyIds = [];
    if (fighter.fireShell) {
      const fireRadius = splashRadius * 1.25;
      const fireTargets = Math.max(splashTargets + 2, splashTargets);
      const fireVictims = activeEnemies
        .filter((enemy) => distance(enemy, target) <= fireRadius)
        .slice(0, fireTargets);
      fireEnemyIds = fireVictims.map((victim) => victim.id);
      for (const victim of fireVictims) {
        const currentVictim = next.enemies.find((enemy) => enemy.id === victim.id);
        if (!currentVictim || !alive(currentVictim)) continue;
        const armorPierce = (currentVictim.elite || currentVictim.type === 'commander')
          ? (fighter.eliteDamageMultiplier ?? 1)
          : 1;
        const amount = fighter.damage * (fighter.fireDamageMultiplier ?? 0.35) * armorPierce;
        next = damageEnemy(next, fighter, currentVictim, amount, {
          type: 'fighter-attack', role: fighter.role, attackType: 'fire-shell',
          fighterId: fighter.id, enemyId: currentVictim.id, amount, projectileId, element: 'fire',
        });
      }
      next = copyEvent(next, {
        type: 'fire-explosion',
        projectileId,
        fighterId: fighter.id,
        enemyIds: fireEnemyIds,
        element: 'fire',
        damageMultiplier: fighter.fireDamageMultiplier ?? 0.35,
        splashRadius: fireRadius,
        ...sourceTargetMeta(fighter, target),
      });
    }
    next = copyEvent(next, {
      type: 'projectile-impact', projectileId, fighterId: fighter.id,
      enemyIds: victims.map((victim) => victim.id), fireEnemyIds,
      splashRadius, element: fighter.fireShell ? 'fire' : 'normal', ...sourceTargetMeta(fighter, target),
    });
  } else {
    const range = profile.attackRange + ENEMY_PROFILES[target.type].radius;
    const victims = fighter.role === 'sword'
      ? activeEnemies.filter((enemy) => distance(fighter, enemy) <= range + 25).slice(0, 3)
      : [target];
    for (const victim of victims) next = damageEnemy(next, fighter, victim, fighter.damage, {
      type: 'fighter-attack', role: fighter.role, attackType: fighter.attackType,
      fighterId: fighter.id, enemyId: victim.id, amount: fighter.damage,
    });
  }
  return setFighter(next, fighter.id, {
    cooldown: profile.attackInterval * (fighter.attackIntervalMultiplier ?? 1),
    windupRemaining: 0,
    pendingAttack: null,
  });
}

function fighterTick(state, fighter) {
  if (!alive(fighter)) return state;
  const profile = ROLE_PROFILES[fighter.role];
  if (!profile) return state;
  let next = setFighter(state, fighter.id, { cooldown: Math.max(0, fighter.cooldown - STEP) });
  let current = next.fighters.find((other) => other.id === fighter.id);
  if (current.windupRemaining > 0) {
    const remaining = Math.max(0, current.windupRemaining - STEP);
    next = setFighter(next, current.id, { windupRemaining: remaining });
    if (remaining > 1e-9) return next;
    const target = next.enemies.find((enemy) => enemy.id === current.pendingAttack?.targetId && alive(enemy));
    const resolved = next.fighters.find((other) => other.id === current.id);
    return target ? resolveFighterAttack(next, resolved, target) : setFighter(next, current.id, { pendingAttack: null });
  }
  const activeEnemies = next.enemies.filter(alive).filter((enemy) => enemy.targetable);
  if (!activeEnemies.length || current.cooldown > 0) return next;
  const target = current.holdRear
    ? activeEnemies.reduce((best, enemy) => enemy.y < best.y ? enemy : best)
    : activeEnemies.reduce((best, enemy) => distance(current, enemy) < distance(current, best) ? enemy : best);
  const range = profile.attackRange + ENEMY_PROFILES[target.type].radius;
  const targetDistance = distance(current, target);
  if (!current.holdRear && targetDistance > range) {
    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const magnitude = Math.hypot(dx, dy) || 1;
    if (current.role === 'bare' && targetDistance <= BARE_DASH_RANGE) {
      const requestedDashDistance = Math.min(targetDistance - range, BARE_DASH_MAX_DISTANCE);
      const from = { x: current.x, y: current.y };
      const to = {
        x: current.x + (dx / magnitude) * requestedDashDistance,
        y: Math.min(FIGHTER_FRONT_LIMIT, current.y + (dy / magnitude) * requestedDashDistance),
      };
      if (to.x === current.x && to.y === current.y) return next;
      next = copyEvent(setFighter(next, current.id, to), {
        type: 'fighter-dash', fighterId: current.id, enemyId: target.id, from, to, distance: distance(from, to),
      });
      current = next.fighters.find((other) => other.id === current.id);
      if (distance(current, target) > range) return next;
    } else {
      return setFighter(next, current.id, {
        x: current.x + (dx / magnitude) * profile.moveSpeed * STEP,
        y: Math.min(FIGHTER_FRONT_LIMIT, current.y + (dy / magnitude) * profile.moveSpeed * STEP),
      });
    }
  }
  return beginFighterWindup(next, current, target);
}

function beginEnemyWindup(state, enemy, target) {
  const targetKind = target ? 'fighter' : 'wall';
  let next = setEnemy(state, enemy.id, {
    windupRemaining: WINDUP_SECONDS[enemy.type],
    pendingAttack: { targetId: target?.id ?? 'wall', targetKind },
  });
  if (enemy.type === 'commander') next = copyEvent(next, {
    type: 'commander-telegraph', enemyId: enemy.id, seconds: WINDUP_SECONDS.commander, ...sourceTargetMeta(enemy, target),
  });
  return copyEvent(next, {
    type: 'enemy-windup', enemyId: enemy.id, targetKind, seconds: WINDUP_SECONDS[enemy.type], ...sourceTargetMeta(enemy, target),
  });
}

function resolveEnemyAttack(state, enemy, target) {
  let next = state;
  if (target) {
    const blocked = target.role === 'shield' && target.blockChance > 0;
    const damage = blocked ? enemy.damage * (1 - target.blockChance) : enemy.damage;
    next = damageFighter(next, enemy, target, damage, { type: 'enemy-attack', enemyId: enemy.id, targetId: target.id, damage, blocked });
    if (blocked) next = copyEvent(next, {
      type: 'shield-block', fighterId: target.id, enemyId: enemy.id,
      receivedDamage: damage, preventedDamage: enemy.damage - damage, ...sourceTargetMeta(enemy, target),
    });
  } else {
    const meta = sourceTargetMeta(enemy, null);
    next = copyEvent({ ...next, wallHp: Math.max(0, next.wallHp - enemy.damage) }, { type: 'wall-hit', enemyId: enemy.id, damage: enemy.damage, ...meta });
    next = copyEvent(next, { type: 'unit-hurt', unitKind: 'wall', unitId: 'wall', ...meta, damage: enemy.damage });
  }
  if (enemy.type === 'commander') next = copyEvent(next, { type: 'commander-slam', enemyId: enemy.id, ...sourceTargetMeta(enemy, target) });
  return setEnemy(next, enemy.id, { cooldown: enemy.attackCadence, windupRemaining: 0, pendingAttack: null });
}

function enemyTick(state, enemy) {
  if (!alive(enemy)) return state;
  let next = setEnemy(state, enemy.id, { cooldown: Math.max(0, enemy.cooldown - STEP) });
  const current = next.enemies.find((other) => other.id === enemy.id);
  if (current.staggerRemaining > 0) return setEnemy(next, current.id, { staggerRemaining: Math.max(0, current.staggerRemaining - STEP) });
  if (current.windupRemaining > 0) {
    const remaining = Math.max(0, current.windupRemaining - STEP);
    next = setEnemy(next, current.id, { windupRemaining: remaining });
    if (remaining > 1e-9) return next;
    const pending = current.pendingAttack;
    const target = pending?.targetKind === 'fighter'
      ? next.fighters.find((fighter) => fighter.id === pending.targetId && alive(fighter))
      : null;
    const resolved = next.enemies.find((other) => other.id === current.id);
    return pending?.targetKind === 'wall' || target
      ? resolveEnemyAttack(next, resolved, target)
      : setEnemy(next, current.id, { pendingAttack: null });
  }
  if (!current.targetable) {
    const position = { x: current.x, y: Math.max(0, current.y - current.moveSpeed * STEP) };
    return setEnemy(next, current.id, {
      ...position,
      engagedTargetId: null,
      targetable: position.y <= TARGETABLE_Y,
    });
  }
  if (current.cooldown > 0) return next;
  const fighters = next.fighters.filter(alive);
  const target = chooseEnemyTarget(current, fighters);
  if (target) {
    if (distance(target, current) <= current.attackRange + 24) return beginEnemyWindup(next, current, target);
    const position = moveToward(current, target, current.moveSpeed);
    return setEnemy(next, current.id, {
      ...position, engagedTargetId: target.id, targetable: current.targetable || position.y <= TARGETABLE_Y,
    });
  }
  if (current.y <= current.attackRange) return beginEnemyWindup(next, current, null);
  const position = { x: current.x, y: Math.max(0, current.y - current.moveSpeed * STEP) };
  return setEnemy(next, current.id, {
    ...position, engagedTargetId: null, targetable: current.targetable || position.y <= TARGETABLE_Y,
  });
}

function superTick(state, fighter) {
  if (!fighter.isSuper || !alive(fighter)) return state;
  const current = state.fighters.find((other) => other.id === fighter.id);
  const remaining = Math.max(0, current.superCooldownRemaining - STEP);
  if (remaining > 1e-6) return { ...state, fighters: state.fighters.map((other) => other.id === current.id ? { ...other, superCooldownRemaining: remaining } : other) };
  const enemies = state.enemies.filter(alive).filter((enemy) => enemy.targetable);
  if (!enemies.length) return { ...state, fighters: state.fighters.map((other) => other.id === current.id ? { ...other, superCooldownRemaining: 0 } : other) };
  const multiplier = superSkillMultiplier[current.role];
  const nextEnemies = state.enemies.map((enemy) => enemies.some((active) => active.id === enemy.id) ? { ...enemy, hp: Math.max(0, enemy.hp - current.damage * multiplier) } : enemy);
  return copyEvent({ ...state, enemies: nextEnemies, fighters: state.fighters.map((other) => other.id === current.id ? { ...other, superCooldownRemaining: 8 } : other) }, { type: 'super-skill', fighterId: current.id, role: current.role, damage: current.damage * multiplier, global: true });
}

function fixedTick(state) {
  const ticks = state.ticks + 1;
  let next = { ...state, ticks, time: Number((ticks * STEP).toFixed(6)), accumulator: state.accumulator - STEP };
  for (const fighter of next.fighters.slice()) next = fighterTick(next, fighter);
  for (const enemy of next.enemies.slice()) next = enemyTick(next, enemy);
  for (const fighter of next.fighters.slice()) next = superTick(next, fighter);
  return { ...next, fighters: next.fighters.filter(alive), enemies: next.enemies.filter(alive) };
}

export function stepCombat(state, dt) {
  if (state.phase !== 'active' || dt <= 0) return state;
  let next = { ...state, accumulator: state.accumulator + dt };
  while (next.accumulator + 1e-9 >= STEP) next = fixedTick(next);
  return next;
}
