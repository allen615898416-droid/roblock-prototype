const ROLE_LABELS = Object.freeze({
  hero: '蓝甲炮手',
});
const ROLE_SHORT_LABELS = Object.freeze({
  hero: '炮',
});
const PIECE_COLORS = Object.freeze(['green', 'amber', 'cyan', 'violet']);
const EVENT_CLASS = Object.freeze({
  'fighter-windup': 'state-windup',
  'fighter-attack': 'state-strike',
  'shield-bash': 'state-bash',
  'projectile-fired': 'state-recoil',
  'unit-hurt': 'state-hurt',
});
const EVENT_DURATION = Object.freeze({
  'state-windup': 220,
  'state-strike': 280,
  'state-bash': 320,
  'state-recoil': 360,
  'state-hurt': 180,
});
const TRANSIENT_ACTOR_CLASSES = Object.freeze(Object.values(EVENT_CLASS));
const COMBAT_WORLD_WIDTH = 390;
const COMBAT_WORLD_HEIGHT = 1000;
const DEFAULT_BATTLEFIELD_RECT = Object.freeze({ left: 0, top: 0, width: 390, height: 360 });

const $ = (root, selector) => root.querySelector(selector);
const $$ = (root, selector) => [...root.querySelectorAll(selector)];
const cellsFor = (piece = {}) => piece.cells || piece.shape || [];

function scheduleRemoval(node, milliseconds) {
  const timer = setTimeout(() => node.remove(), milliseconds);
  timer.unref?.();
}

function eventActorId(event = {}) {
  if (event.type === 'unit-hurt' || event.type === 'unit-death') return event.unitId;
  return event.fighterId || event.enemyId || event.sourceId;
}

function normalizedWall(current = 0, maximum = 1000) {
  const max = Math.max(1, Math.round(Number(maximum) || 1000));
  const value = Math.max(0, Math.min(max, Math.round(Number(current) || 0)));
  return {
    current: value,
    maximum: max,
    ratio: value / max,
    text: `街垒 ${value}/${max}`,
  };
}

function pieceColor(piece = {}, index = 0) {
  if (PIECE_COLORS.includes(piece.color)) return piece.color;
  const id = String(piece.id || piece.templateId || index);
  const hash = [...id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return PIECE_COLORS[hash % PIECE_COLORS.length];
}

export function measureBoardGeometry(board, relativeTo = null) {
  const firstCell = board.querySelector('.board-cell[data-row="0"][data-col="0"]');
  const rightCell = board.querySelector('.board-cell[data-row="0"][data-col="1"]');
  const downCell = board.querySelector('.board-cell[data-row="1"][data-col="0"]');
  if (!firstCell) return null;
  const firstRect = firstCell.getBoundingClientRect();
  const rightRect = rightCell?.getBoundingClientRect();
  const downRect = downCell?.getBoundingClientRect();
  const reference = relativeTo?.getBoundingClientRect() || { left: 0, top: 0 };
  return {
    left: firstRect.left - reference.left,
    top: firstRect.top - reference.top,
    stepX: rightRect ? rightRect.left - firstRect.left : firstRect.width,
    stepY: downRect ? downRect.top - firstRect.top : firstRect.height,
    cellWidth: firstRect.width,
    cellHeight: firstRect.height,
  };
}

export function createRenderer(root) {
  const doc = root.ownerDocument ?? globalThis.document;
  const board = $(root, '[data-board]');
  const rack = $(root, '[data-rack]');
  const energyMeter = $(root, '[data-energy-meter]');
  const energyGrid = $(root, '[data-energy-grid]');
  const roleSelector = $(root, '[data-role-selector]');
  const heroPerch = $(root, '[data-hero-perch]');
  const battlefield = $(root, '[data-battlefield]');
  const combatLayer = $(root, '[data-combat-layer]');
  const feedbackLayer = $(root, '[data-feedback-layer]');
  const status = $(root, '[data-status-live]');
  const ghost = $(root, '[data-drag-ghost]');
  const draftCards = $(root, '[data-draft-cards]');
  const backgroundRegions = $$(root, '[data-ui-background]');
  const actors = new Map();
  const actorClassTimers = new Map();
  const deathTimers = new Map();
  const dyingActors = new Set();
  const seenEvents = new WeakSet();
  const pendingPipAnimations = new Map();
  let selectedRole = 'hero';
  let previousEnergy = null;
  let activeModal = null;
  let focusBeforeModal = null;
  let trappedModal = null;
  let lastDraftSignature = null;
  let draftButtons = [];
  let thresholdFlashTimer = null;
  let impactShakeTimer = null;

  function motionReduced() {
    if (root.classList.contains('reduced-motion')) return true;
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  function buildBoard(rows = 7, cols = 9) {
    if (
      board.childElementCount === rows * cols
      || board.children?.length === rows * cols
    ) return;
    board.replaceChildren(...Array.from({ length: rows * cols }, (_, index) => {
      const cell = doc.createElement('i');
      cell.className = 'board-cell';
      cell.dataset.row = String(Math.floor(index / cols));
      cell.dataset.col = String(index % cols);
      cell.setAttribute('aria-hidden', 'true');
      return cell;
    }));
  }

  function renderBoard(snapshot = {}) {
    const rows = snapshot.rows || 7;
    const cols = snapshot.cols || 9;
    buildBoard(rows, cols);
    board.dataset.rows = String(rows);
    board.dataset.cols = String(cols);
    const values = snapshot.cells || Array(rows * cols).fill(null);
    $$(board, '.board-cell').forEach((cell, index) => {
      const value = values[index];
      cell.className = 'board-cell';
      cell.replaceChildren();
      if (value === null || value === undefined || value === false) return;
      const color = pieceColor({ id: value }, index);
      cell.classList.add('occupied', `block-${color}`);
      cell.dataset.pieceId = String(value.id || value);
      const mark = doc.createElement('span');
      mark.className = 'block-stud';
      mark.setAttribute('aria-hidden', 'true');
      cell.append(mark);
    });
  }

  function renderRackPiece(button, piece, index) {
    button.replaceChildren();
    button.disabled = !piece;
    button.classList.toggle('empty', !piece);
    button.setAttribute('aria-grabbed', 'false');
    if (!piece) {
      button.removeAttribute?.('data-piece-id');
      button.setAttribute('aria-label', `候选位 ${index + 1}，已使用`);
      return;
    }
    button.dataset.pieceId = piece.id || piece.templateId || String(index);
    button.setAttribute('aria-label', `候选积木 ${index + 1}，${cellsFor(piece).length} 格，拖到棋盘`);
    const cells = cellsFor(piece);
    const maxRow = Math.max(0, ...cells.map((cell) => cell.row));
    const maxCol = Math.max(0, ...cells.map((cell) => cell.col));
    const size = 15;
    const shape = doc.createElement('span');
    const color = pieceColor(piece, index);
    shape.className = 'candidate-shape';
    shape.style.setProperty('inline-size', `${(maxCol + 1) * size}px`);
    shape.style.setProperty('block-size', `${(maxRow + 1) * size}px`);
    cells.forEach((cell) => {
      const block = doc.createElement('i');
      block.className = `candidate-cell block-${color}`;
      block.dataset.pieceCell = 'true';
      block.dataset.row = String(cell.row);
      block.dataset.col = String(cell.col);
      block.style.setProperty('left', `${cell.col * size}px`);
      block.style.setProperty('top', `${cell.row * size}px`);
      shape.append(block);
    });
    button.append(shape);
  }

  function buildEnergyCells(maximum = 24) {
    if (
      energyGrid.childElementCount === maximum
      || energyGrid.children?.length === maximum
    ) return;
    energyGrid.replaceChildren(...Array.from({ length: maximum }, (_, index) => {
      const cell = doc.createElement('i');
      cell.className = 'energy-cell';
      cell.dataset.energyCell = String(index + 1);
      cell.setAttribute('aria-hidden', 'true');
      return cell;
    }));
  }

  function cancelPendingPips() {
    for (const pending of pendingPipAnimations.values()) clearTimeout(pending.timer);
    pendingPipAnimations.clear();
  }

  function beginPipAnimation(chargeValue, order) {
    const previous = pendingPipAnimations.get(chargeValue);
    if (previous) clearTimeout(previous.timer);
    const delay = order * 25;
    const token = Symbol(`pip-${chargeValue}`);
    const timer = setTimeout(() => {
      if (pendingPipAnimations.get(chargeValue)?.token !== token) return;
      pendingPipAnimations.delete(chargeValue);
      $$(energyGrid, '[data-energy-cell]')
        .find((cell) => Number(cell.dataset.energyCell) === chargeValue)
        ?.classList.remove('energy-new');
    }, 180 + delay);
    timer.unref?.();
    pendingPipAnimations.set(chargeValue, { delay, timer, token });
  }

  function renderProduction(production = {}) {
    const maximum = Math.max(1, Number(production.max) || 24);
    const energy = Math.max(0, Math.min(maximum, Number(production.energy) || 0));
    buildEnergyCells(maximum);
    energyMeter.setAttribute('aria-valuemin', '0');
    energyMeter.setAttribute('aria-valuemax', String(maximum));
    energyMeter.setAttribute('aria-valuenow', String(energy));
    energyMeter.setAttribute('aria-valuetext', `${energy}/${maximum}，消除充能，满格选择强化`);
    if (previousEnergy !== null && energy !== previousEnergy) {
      if (energy < previousEnergy) cancelPendingPips();
      const firstNew = energy > previousEnergy ? previousEnergy : 0;
      for (let chargeValue = firstNew + 1; chargeValue <= energy; chargeValue += 1) {
        beginPipAnimation(chargeValue, chargeValue - firstNew - 1);
      }
    }
    $$(energyGrid, '[data-energy-cell]').forEach((cell) => {
      const chargeValue = Number(cell.dataset.energyCell) || 0;
      const filled = chargeValue <= energy;
      const pending = pendingPipAnimations.get(chargeValue);
      cell.classList.toggle('energy-filled', filled);
      cell.classList.toggle('energy-empty', !filled);
      cell.classList.toggle('energy-new', filled && Boolean(pending));
      cell.style.setProperty('--pip-delay', `${pending?.delay ?? 0}ms`);
      cell.textContent = filled ? '◆' : '';
      if (filled && chargeValue === Math.ceil(energy)) cell.dataset.latest = 'true';
      else delete cell.dataset.latest;
    });
    previousEnergy = energy;
    if (!roleSelector) return;
    for (const role of Object.keys(ROLE_LABELS)) {
      const button = $(roleSelector, `[data-role="${role}"]`);
      if (!button) continue;
      const selected = role === selectedRole;
      button.textContent = ROLE_SHORT_LABELS[role];
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', `${ROLE_LABELS[role]}${selected ? '，已选择' : ''}`);
    }
  }

  function mechaPart(className) {
    const part = doc.createElement('i');
    part.className = className;
    part.setAttribute('aria-hidden', 'true');
    return part;
  }

  function createMechaRig(role) {
    const rig = doc.createElement('span');
    rig.className = `mecha-rig role-${role}`;
    rig.setAttribute('aria-hidden', 'true');
    rig.append(
      mechaPart('mecha-pack'),
      mechaPart('mecha-leg leg-left'),
      mechaPart('mecha-leg leg-right'),
      mechaPart('mecha-arm arm-left'),
      mechaPart('mecha-torso'),
      mechaPart('mecha-head'),
      mechaPart('mecha-face'),
      mechaPart('mecha-arm arm-right'),
      mechaPart(
        role === 'hero'
          ? 'mecha-tool mecha-hero-cannon'
          : role === 'shield'
            ? 'mecha-tool mecha-shield'
            : role === 'sword'
              ? 'mecha-tool mecha-blade'
              : 'mecha-tool mecha-cannon',
      ),
    );
    return rig;
  }

  function createActor(id, kind) {
    const actor = doc.createElement('div');
    actor.className = `actor ${kind} actor-enter`;
    actor.dataset.actorId = id;
    actor.dataset.actorKind = kind;
    (kind === 'fighter' && heroPerch ? heroPerch : combatLayer).append(actor);
    const entry = { actor, kind };
    actors.set(id, entry);
    return entry;
  }

  function actorFor(id, kind) {
    const previous = actors.get(id);
    if (previous?.kind === kind) return previous;
    previous?.actor.remove();
    actors.delete(id);
    return createActor(id, kind);
  }

  function actorPosition(unit = {}, fallbackX, fallbackY) {
    const x = Number.isFinite(unit.x) ? Math.max(0, Math.min(100, unit.x / 3.9)) : fallbackX;
    const y = Number.isFinite(unit.y) ? Math.max(0, Math.min(100, 100 - unit.y / 10)) : fallbackY;
    return { x, y };
  }

  function relativeRect(element, fallback = DEFAULT_BATTLEFIELD_RECT) {
    const rect = element?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
    return fallback;
  }

  function px(value) {
    return `${Math.round(value * 100) / 100}px`;
  }

  function preserveActorStates(actor, baseClassName) {
    const states = [...TRANSIENT_ACTOR_CLASSES, 'state-death']
      .filter((className) => actor.classList.contains(className));
    actor.className = baseClassName;
    actor.classList.add(...states);
  }

  function renderFighter(entry, fighter = {}) {
    const role = ROLE_LABELS[fighter.role] ? fighter.role : 'hero';
    const point = heroPerch ? { x: 50, y: 50 } : actorPosition(fighter, 50, 72);
    const moving = Boolean(entry.lastPoint) && (
      Math.abs(point.x - entry.lastPoint.x) > 0.15
      || Math.abs(point.y - entry.lastPoint.y) > 0.15
    );
    preserveActorStates(
      entry.actor,
      `actor fighter fighter-${role} actor-enter${moving ? ' is-moving' : ''}`,
    );
    entry.actor.dataset.role = role;
    if (heroPerch) {
      entry.actor.style.removeProperty('left');
      entry.actor.style.removeProperty('top');
    } else {
      entry.actor.style.setProperty('left', `${point.x}%`);
      entry.actor.style.setProperty('top', `${point.y}%`);
    }
    entry.actor.setAttribute(
      'aria-label',
      `${ROLE_LABELS[role]}，自动开火，生命 ${Math.max(0, Math.round(Number(fighter.hp) || 0))}`,
    );
    if (!entry.rig || entry.role !== role) {
      entry.rig = createMechaRig(role);
      entry.health = doc.createElement('span');
      entry.health.className = 'actor-health fighter-health';
      entry.health.setAttribute('aria-hidden', 'true');
      entry.actor.replaceChildren(entry.rig, entry.health);
      entry.role = role;
    }
    const maximum = Math.max(1, Number(fighter.maxHp) || Number(fighter.hp) || 1);
    const current = Math.max(0, Number(fighter.hp) || 0);
    entry.health.style.setProperty('--actor-hp', String(current / maximum));
    entry.health.textContent = `${Math.round(current)}/${Math.round(maximum)}`;
    entry.lastPoint = point;
  }

  function renderEnemy(entry, enemy = {}) {
    const type = enemy.type || enemy.kind || 'grunt';
    const point = actorPosition(enemy, 50, 22);
    const moving = Boolean(entry.lastPoint) && (
      Math.abs(point.x - entry.lastPoint.x) > 0.15
      || Math.abs(point.y - entry.lastPoint.y) > 0.15
    );
    preserveActorStates(
      entry.actor,
      `actor enemy enemy-${type}${enemy.elite ? ' elite' : ''}${moving ? ' is-moving' : ''} actor-enter`,
    );
    entry.actor.dataset.silhouette = enemy.silhouette || type;
    entry.actor.style.setProperty('--enemy-scale', String(enemy.scale ?? 1));
    entry.actor.style.setProperty('left', `${point.x}%`);
    entry.actor.style.setProperty('top', `${point.y}%`);
    entry.actor.setAttribute(
      'aria-label',
      `${type === 'commander' ? '指挥官' : '怪物'}，生命 ${Math.max(0, Math.round(Number(enemy.hp) || 0))}`,
    );
    if (!entry.art) {
      entry.art = doc.createElement('i');
      entry.art.className = 'enemy-art';
      entry.health = doc.createElement('span');
      entry.health.className = 'actor-health';
      entry.actor.append(entry.art, entry.health);
    }
    const maximum = Math.max(1, Number(enemy.maxHp) || Number(enemy.hp) || 1);
    const current = Math.max(0, Number(enemy.hp) || 0);
    entry.health.style.setProperty('--actor-hp', String(current / maximum));
    entry.health.textContent = `${Math.round(current)}/${Math.round(maximum)}`;
    entry.type = type;
    entry.lastPoint = point;
  }

  function clearActorTimers(id) {
    for (const [key, timer] of actorClassTimers) {
      if (!key.startsWith(`${id}:`)) continue;
      clearTimeout(timer);
      actorClassTimers.delete(key);
    }
  }

  function removeActor(id, entry) {
    clearActorTimers(id);
    entry.actor.remove();
    actors.delete(id);
    dyingActors.delete(id);
    deathTimers.delete(id);
  }

  function renderCombat(combat = {}, combatEvents = []) {
    for (const event of combatEvents) {
      if (event?.type !== 'unit-death') continue;
      const id = eventActorId(event);
      if (id) dyingActors.add(String(id));
    }
    const aliveIds = new Set();
    (combat.fighters || []).forEach((fighter, index) => {
      const id = String(fighter.id || `fighter-${index}`);
      aliveIds.add(id);
      renderFighter(actorFor(id, 'fighter'), fighter);
    });
    (combat.enemies || []).forEach((enemy, index) => {
      const id = String(enemy.id || `enemy-${index}`);
      aliveIds.add(id);
      renderEnemy(actorFor(id, 'enemy'), enemy);
    });
    for (const [id, entry] of actors) {
      if (aliveIds.has(id) || dyingActors.has(id)) continue;
      removeActor(id, entry);
    }
  }

  function feedbackNode(kind, className) {
    const node = doc.createElement('i');
    node.dataset.feedbackKind = kind;
    node.className = `${className}${motionReduced() ? ' reduced' : ''}`;
    feedbackLayer.append(node);
    return node;
  }

  function eventPosition(event = {}) {
    const worldX = Number.isFinite(event.targetX) ? event.targetX : event.x;
    const worldY = Number.isFinite(event.targetY) ? event.targetY : event.y;
    const xRatio = Number.isFinite(worldX) ? Math.max(0, Math.min(1, worldX / COMBAT_WORLD_WIDTH)) : 0.5;
    const yRatio = Number.isFinite(worldY) ? Math.max(0, Math.min(1, 1 - worldY / COMBAT_WORLD_HEIGHT)) : 0.45;
    const rootRect = relativeRect(root, { left: 0, top: 0, width: 390, height: 844 });
    const battleRect = relativeRect(battlefield ?? root);
    return {
      x: battleRect.left - rootRect.left + battleRect.width * xRatio,
      y: battleRect.top - rootRect.top + battleRect.height * yRatio,
    };
  }

  function damageFeedback(event) {
    const pop = feedbackNode('damage-pop', 'damage-pop');
    const point = eventPosition(event);
    const damage = Math.max(0, Math.round(Number(event.damage ?? event.amount) || 0));
    pop.style.setProperty('left', px(point.x));
    pop.style.setProperty('top', px(point.y));
    pop.textContent = damage > 0 ? `-${damage}` : '命中';
    scheduleRemoval(pop, motionReduced() ? 220 : 520);
  }

  function startImpactShake() {
    if (motionReduced()) return;
    if (impactShakeTimer) clearTimeout(impactShakeTimer);
    root.classList.remove('impact-shake');
    void root.offsetWidth;
    root.classList.add('impact-shake');
    impactShakeTimer = setTimeout(() => {
      root.classList.remove('impact-shake');
      impactShakeTimer = null;
    }, 150);
    impactShakeTimer.unref?.();
  }

  function createBrickDebris(entry) {
    const colorClass = entry.role || (entry.kind === 'enemy' ? 'enemy' : entry.kind);
    for (let index = 0; index < 4; index += 1) {
      const debris = doc.createElement('i');
      debris.dataset.feedbackKind = 'brick-debris';
      debris.className = `brick-debris debris-${colorClass}`;
      debris.style.setProperty('--debris-x', `${index % 2 === 0 ? -18 - index * 3 : 18 + index * 3}px`);
      debris.style.setProperty('--debris-y', `${index < 2 ? -20 : 18}px`);
      debris.style.setProperty('--debris-rotate', `${index % 2 === 0 ? -55 : 55}deg`);
      debris.style.setProperty('--debris-delay', `${index * 12}ms`);
      entry.actor.append(debris);
    }
  }

  function beginActorDeath(id, entry) {
    if (deathTimers.has(id)) return;
    dyingActors.add(id);
    entry.actor.classList.add('state-death');
    createBrickDebris(entry);
    const token = Symbol(`death-${id}`);
    const timer = setTimeout(() => {
      if (deathTimers.get(id)?.token !== token) return;
      removeActor(id, entry);
    }, 260);
    timer.unref?.();
    deathTimers.set(id, { timer, token });
  }

  function restartActorClass(id, entry, className) {
    const key = `${id}:${className}`;
    const previous = actorClassTimers.get(key);
    if (previous) clearTimeout(previous);
    entry.actor.classList.remove(className);
    void entry.actor.offsetWidth;
    entry.actor.classList.add(className);
    const timer = setTimeout(() => {
      entry.actor.classList.remove(className);
      actorClassTimers.delete(key);
    }, EVENT_DURATION[className]);
    timer.unref?.();
    actorClassTimers.set(key, timer);
  }

  function playActorEvents(events = []) {
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const id = eventActorId(event);
      const actorId = id === undefined || id === null ? '' : String(id);
      const entry = actors.get(actorId);
      if (event.type === 'unit-death') {
        if (entry) beginActorDeath(actorId, entry);
        else dyingActors.delete(actorId);
        continue;
      }
      if (event.type === 'unit-hurt') {
        damageFeedback(event);
        startImpactShake();
      }
      const className = EVENT_CLASS[event.type];
      if (className && entry) restartActorClass(actorId, entry, className);
    }
  }

  function energyFeedback(event) {
    const gain = Math.max(0, Math.round(Number(event.gain) || 0));
    if (motionReduced()) {
      const outline = feedbackNode('energy-outline', 'energy-outline-pulse');
      scheduleRemoval(outline, 220);
    } else {
      const points = event.boardPoints || [];
      const count = Math.max(1, Math.min(8, points.length || event.placedCellCount || 1));
      const rootRect = root.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const meterRect = energyMeter.getBoundingClientRect();
      const rootWidth = rootRect.width || 390;
      const rootHeight = rootRect.height || 844;
      const target = meterRect.width > 0 && meterRect.height > 0
        ? {
          x: meterRect.left - rootRect.left + meterRect.width / 2,
          y: meterRect.top - rootRect.top + meterRect.height / 2,
        }
        : { x: rootWidth * 0.38, y: rootHeight * 0.5 };
      for (let index = 0; index < count; index += 1) {
        const point = points[index] || points.at(-1) || null;
        const cell = point
          ? board.querySelector(`[data-row="${point.row}"][data-col="${point.col}"]`)
          : null;
        const cellRect = cell?.getBoundingClientRect();
        let source;
        if (cellRect?.width > 0 && cellRect?.height > 0) {
          source = {
            x: cellRect.left - rootRect.left + cellRect.width / 2,
            y: cellRect.top - rootRect.top + cellRect.height / 2,
          };
        } else if (point && boardRect.width > 0 && boardRect.height > 0) {
          source = {
            x: boardRect.left - rootRect.left + ((point.col + 0.5) / 9) * boardRect.width,
            y: boardRect.top - rootRect.top + ((point.row + 0.5) / 7) * boardRect.height,
          };
        } else {
          source = {
            x: rootWidth * (0.34 + (index % 3) * 0.16),
            y: rootHeight * 0.77,
          };
        }
        const particle = feedbackNode('energy-travel', 'energy-travel-particle');
        if (point) {
          particle.dataset.sourceRow = String(point.row);
          particle.dataset.sourceCol = String(point.col);
        }
        particle.style.setProperty('--travel-from-x', `${source.x}px`);
        particle.style.setProperty('--travel-from-y', `${source.y}px`);
        particle.style.setProperty('--travel-to-x', `${target.x}px`);
        particle.style.setProperty('--travel-to-y', `${target.y}px`);
        particle.style.setProperty('--travel-duration', `${240 + (index % 5) * 20}ms`);
        particle.style.setProperty('--travel-delay', `${index * 18}ms`);
        scheduleRemoval(particle, 360 + index * 18);
      }
    }
    const multiplier = Math.max(1, Math.round(Number(event.clearMultiplier) || 1));
    if (multiplier > 1) {
      const rootRect = root.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const combo = feedbackNode('clear-combo', 'clear-combo-pop');
      combo.textContent = `横竖同消 x${multiplier}`;
      combo.style.setProperty('left', `${(boardRect.left - rootRect.left) + boardRect.width / 2}px`);
      combo.style.setProperty('top', `${(boardRect.top - rootRect.top) + boardRect.height * 0.2}px`);
      scheduleRemoval(combo, motionReduced() ? 320 : 820);
    }
    status.textContent = multiplier > 1
      ? `横竖同消 x${multiplier}：+${gain} 充能。`
      : `消除充能：+${gain}。`;
  }

  function upgradeFeedback(event) {
    const spawn = feedbackNode('fighter-spawn', 'fighter-spawn-wave');
    spawn.dataset.upgradeSequence = String(event.sequence || '');
    scheduleRemoval(spawn, motionReduced() ? 220 : 720);
    if (thresholdFlashTimer) clearTimeout(thresholdFlashTimer);
    const energyCells = $$(energyGrid, '[data-energy-cell]');
    energyCells.forEach((cell) => cell.classList.add('energy-threshold'));
    energyMeter.classList.add('threshold-wave');
    thresholdFlashTimer = setTimeout(() => {
      energyMeter.classList.remove('threshold-wave');
      energyCells.forEach((cell) => cell.classList.remove('energy-threshold'));
      thresholdFlashTimer = null;
    }, motionReduced() ? 420 : 1000);
    thresholdFlashTimer.unref?.();
    status.textContent = '能量满格，选择一项强化。';
  }

  function renderEvents(events = []) {
    for (const event of events) {
      if (!event || typeof event !== 'object' || seenEvents.has(event)) continue;
      seenEvents.add(event);
      if (event.type === 'production-energy-gained') energyFeedback(event);
      if (event.type === 'upgrade-ready') upgradeFeedback(event);
      if (event.type === 'production-deadlock') {
        const seconds = Math.max(0, Number(event.lockSeconds) || 0);
        status.textContent = `死局修复：已清盘，能量减半，生产台重整 ${seconds} 秒。`;
      }
    }
  }

  function renderDraft(draft = {}) {
    const signature = JSON.stringify((draft.cards || []).map((card = {}, index) => ({
      id: card.id || String(index),
      name: card.name || '',
      description: card.description || '',
    })));
    if (signature === lastDraftSignature) {
      draftButtons.forEach((button) => { button.disabled = Boolean(draft.locked); });
      return false;
    }
    draftButtons = (draft.cards || []).map((card, index) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'draft-card';
      button.dataset.draftCard = card.id || String(index);
      button.disabled = Boolean(draft.locked);
      const name = doc.createElement('b');
      name.textContent = card.name || card.id || `强化 ${index + 1}`;
      const description = doc.createElement('span');
      description.textContent = card.description || '';
      button.append(name, description);
      return button;
    });
    draftCards.replaceChildren(...draftButtons);
    lastDraftSignature = signature;
    return true;
  }

  function renderModalState(view = {}, draftChanged = false) {
    const segmentOverlay = $(root, '[data-segment-overlay]');
    const victoryOverlay = $(root, '[data-victory-overlay]');
    const defeatOverlay = $(root, '[data-defeat-overlay]');
    const nextModal = view.draft?.active || view.phase === 'draft'
      ? segmentOverlay
      : view.victory || view.phase === 'victory'
        ? victoryOverlay
        : view.defeat || view.phase === 'defeat'
          ? defeatOverlay
          : null;
    segmentOverlay.hidden = nextModal !== segmentOverlay;
    victoryOverlay.hidden = nextModal !== victoryOverlay;
    defeatOverlay.hidden = nextModal !== defeatOverlay;
    if (trappedModal !== nextModal) {
      trappedModal?.removeEventListener('keydown', trapModalFocus);
      trappedModal = nextModal;
      trappedModal?.addEventListener('keydown', trapModalFocus);
    }

    if (nextModal === activeModal) {
      if (draftChanged && nextModal === segmentOverlay) {
        nextModal.querySelector('[data-draft-card]')?.focus();
      }
      return;
    }
    if (nextModal) {
      if (!activeModal) focusBeforeModal = doc.activeElement;
      backgroundRegions.forEach((region) => {
        region.inert = true;
        region.setAttribute('aria-hidden', 'true');
      });
      root.classList.add('modal-open');
      activeModal = nextModal;
      const firstAction = nextModal === segmentOverlay
        ? nextModal.querySelector('[data-draft-card]')
        : nextModal.querySelector('[data-restart]');
      firstAction?.focus();
      return;
    }
    backgroundRegions.forEach((region) => {
      region.inert = false;
      region.removeAttribute('aria-hidden');
    });
    root.classList.remove('modal-open');
    activeModal = null;
    focusBeforeModal?.focus?.();
    focusBeforeModal = null;
  }

  function modalActions(modal) {
    if (!modal) return [];
    return [
      ...$$(modal, '[data-draft-card]'),
      ...$$(modal, '[data-restart]'),
    ].filter((action) => !action.disabled && !action.hidden);
  }

  function trapModalFocus(event) {
    if (event.key !== 'Tab' || !trappedModal) return;
    const actions = modalActions(trappedModal);
    if (!actions.length) return;
    const first = actions[0];
    const last = actions.at(-1);
    const current = doc.activeElement;
    const outside = !actions.includes(current);
    const wrapsForward = !event.shiftKey && current === last;
    const wrapsBackward = event.shiftKey && current === first;
    if (actions.length === 1 || outside || wrapsForward || wrapsBackward) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  function renderGhost({ candidate, piece, anchor, valid = true } = {}) {
    const source = piece || candidate;
    if (!source || !anchor) {
      clearGhost();
      return;
    }
    const geometry = measureBoardGeometry(board, root);
    if (!geometry) {
      clearGhost();
      return;
    }
    const sourceCells = cellsFor(source);
    ghost.replaceChildren(...sourceCells.map((cell) => {
      const block = doc.createElement('i');
      block.className = `ghost-cell block-${pieceColor(source)}${valid ? '' : ' invalid'}`;
      block.style.setProperty('left', `${cell.col * geometry.stepX}px`);
      block.style.setProperty('top', `${cell.row * geometry.stepY}px`);
      block.style.setProperty('inline-size', `${geometry.cellWidth}px`);
      block.style.setProperty('block-size', `${geometry.cellHeight}px`);
      return block;
    }));
    ghost.style.setProperty('left', `${geometry.left + anchor.col * geometry.stepX}px`);
    ghost.style.setProperty('top', `${geometry.top + anchor.row * geometry.stepY}px`);
    ghost.classList.add('active');
    ghost.classList.toggle('invalid', !valid);
  }

  function clearGhost() {
    ghost.classList.remove('active', 'invalid');
    ghost.replaceChildren();
  }

  function render(view = {}) {
    renderBoard(view.board || {});
    const rackState = view.rack?.rack || view.rack || [];
    $$(rack, '[data-rack-slot]').forEach((button, index) => {
      renderRackPiece(button, rackState[index], index);
    });
    renderProduction(view.production || {});
    renderCombat(view.combat || {}, view.combatEvents || []);
    playActorEvents(view.combatEvents || []);
    const draftChanged = renderDraft(view.draft || {});
    renderEvents(view.events || []);
    renderModalState(view, draftChanged);

    const wall = normalizedWall(
      view.wallHp ?? view.combat?.wallHp,
      view.wallMaxHp ?? view.level?.wallHp ?? 1000,
    );
    const wallMeter = $(root, '[data-wall-meter]');
    const wallFill = $(root, '[data-wall-meter-fill]');
    if (wallMeter && wallFill) {
      wallMeter.setAttribute('aria-valuemin', '0');
      wallMeter.setAttribute('aria-valuemax', String(wall.maximum));
      wallMeter.setAttribute('aria-valuenow', String(wall.current));
      wallMeter.style.setProperty('--wall-ratio', String(wall.ratio));
      wallFill.style.setProperty('inline-size', `${wall.ratio * 100}%`);
    }
    const wallHp = $(root, '[data-wall-hp]');
    if (wallHp) wallHp.textContent = wall.text;
    $(root, '[data-countdown]').textContent = view.countdown ?? (
      view.phase === 'prep' ? '备战' : '战斗中'
    );
    $(root, '[data-segment-label]').textContent = view.segmentLabel || '1-1 · S1';
    renderSkillBar(view);
    if (view.message) status.textContent = view.message;
  }

  function renderSkillBar(view = {}) {
    const buffBar = $(root, '[data-buff-bar]');
    if (!buffBar) return;
    const buffs = view.chosenCards || view.modifiers?.chosenCards || [];
    buffBar.replaceChildren();
    if (!buffs.length) {
      buffBar.textContent = '尚无强化';
      return;
    }
    buffBar.textContent = '';
    const count = doc.createElement('span');
    count.className = 'skill-count';
    count.textContent = `强化 ${buffs.length}`;
    buffBar.append(count);
    if (buffs.includes('fire-shell')) {
      const fire = doc.createElement('button');
      fire.type = 'button';
      fire.className = 'skill-button skill-fire';
      fire.dataset.skillButton = 'fire-shell';
      fire.setAttribute('aria-label', '火爆弹已解锁');
      fire.textContent = '火';
      buffBar.append(fire);
    }
  }

  const reducedMotionButton = $(root, '[data-reduced-motion]');
  reducedMotionButton?.addEventListener('click', () => {
    const reduced = !root.classList.contains('reduced-motion');
    root.classList.toggle('reduced-motion', reduced);
    reducedMotionButton.setAttribute('aria-pressed', String(reduced));
    status.textContent = reduced ? '已减少动态效果。' : '已恢复动态效果。';
  });

  return {
    render,
    renderGhost,
    clearGhost,
    setStatus(message = '') { status.textContent = message; },
  };
}
