import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFeedback } from '../src/feedback.js';
import { createRenderer } from '../src/render.js';

const BASE = new URL('../', import.meta.url);

class FakeClassList {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  add(...names) { names.filter(Boolean).forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    enabled ? this.values.add(name) : this.values.delete(name);
    return enabled;
  }
  toString() { return [...this.values].join(' '); }
}

const dataKey = (attribute) => attribute.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function matches(element, selector) {
  if (selector.startsWith('.')) {
    const className = selector.slice(1).split('[')[0];
    if (!element.classList.contains(className)) return false;
  }
  for (const match of selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
    const [, attribute, expected] = match;
    const actual = attribute.startsWith('data-')
      ? element.dataset[dataKey(attribute)]
      : element.getAttribute(attribute);
    if (actual === undefined || actual === null) return false;
    if (expected !== undefined && String(actual) !== expected) return false;
  }
  return true;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.style = {
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, String(value)),
      removeProperty: (name) => this.style.values.delete(name),
    };
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.textContent = '';
    this.listeners = new Map();
  }
  set className(value) {
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  get className() { return this.classList.toString(); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (matches(child, selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
  }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }
  click() { this.dispatchEvent({ type: 'click', target: this }); }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() {
    return this.rect || { left: 0, top: 0, width: 0, height: 0 };
  }
}

class FakeDocument {
  constructor() { this.activeElement = null; }
  createElement(tagName) { return new FakeElement(tagName, this); }
}

function appendSelector(root, selector, tagName = 'div') {
  const element = root.ownerDocument.createElement(tagName);
  for (const match of selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
    const [, attribute, value = ''] = match;
    if (attribute.startsWith('data-')) element.dataset[dataKey(attribute)] = value;
    else element.setAttribute(attribute, value);
  }
  root.append(element);
  return element;
}

function renderRoot() {
  const document = new FakeDocument();
  const root = new FakeElement('main', document);
  ['header', 'battle', 'production', 'board'].forEach((name) => {
    const background = appendSelector(root, '[data-ui-background]');
    background.dataset.backgroundName = name;
  });
  appendSelector(root, '[data-battlefield]');
  const board = appendSelector(root, '[data-board]');
  board.dataset.rows = '7';
  board.dataset.cols = '8';
  appendSelector(root, '[data-combat-layer]');
  appendSelector(root, '[data-hero-perch]');
  const rack = appendSelector(root, '[data-rack]');
  for (let slot = 0; slot < 3; slot += 1) {
    const button = appendSelector(rack, `[data-rack-slot="${slot}"]`, 'button');
    button.dataset.draggable = '';
  }
  const energyMeter = appendSelector(root, '[data-energy-meter]');
  energyMeter.setAttribute('role', 'progressbar');
  appendSelector(energyMeter, '[data-energy-grid]');
  appendSelector(root, '[data-reduced-motion]', 'button');
  const segmentOverlay = appendSelector(root, '[data-segment-overlay]');
  segmentOverlay.hidden = true;
  const draftCards = appendSelector(segmentOverlay, '[data-draft-cards]');
  const victoryOverlay = appendSelector(root, '[data-victory-overlay]');
  victoryOverlay.hidden = true;
  appendSelector(victoryOverlay, '[data-restart]', 'button');
  const defeatOverlay = appendSelector(root, '[data-defeat-overlay]');
  defeatOverlay.hidden = true;
  appendSelector(defeatOverlay, '[data-restart]', 'button');
  [
    '[data-feedback-layer]',
    '[data-status-live]',
    '[data-countdown]',
    '[data-wall-meter]',
    '[data-wall-meter-fill]',
    '[data-wall-hp]',
    '[data-segment-label]',
    '[data-buff-bar]',
    '[data-drag-ghost]',
  ].forEach((selector) => appendSelector(root, selector));
  draftCards.dataset.owner = 'draft';
  return root;
}

test('page and CSS expose the approved v1 7x9 hero-cannon hierarchy', async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL('index.html', BASE), 'utf8'),
    readFile(new URL('styles.css', BASE), 'utf8'),
    readFile(new URL('src/app.js', BASE), 'utf8').catch(() => ''),
  ]);
  assert.match(html, /data-energy-grid/);
  assert.match(html, /data-energy-dock/);
  assert.match(html, /data-hero-perch/);
  assert.doesNotMatch(html, /data-role="shield"|data-role="sword"|data-role="cannon"/);
  assert.doesNotMatch(html, /data-wall-meter|data-wall-hp/);
  assert.equal((html.match(/data-rack-slot=/g) || []).length, 3);
  assert.doesNotMatch(html, /data-super-deploy|data-refresh|data-undo/);
  assert.match(css, /grid-template-columns:\s*repeat\(9,\s*1fr\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(7,\s*1fr\)/);
  assert.ok(
    html.indexOf('data-energy-dock') < html.indexOf('data-board'),
    'energy dock must sit above the board in the block blast panel',
  );
  assert.doesNotMatch(css, /\.board-shell[^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*294px\)\s+40px/s);
  assert.match(css, /\.production-command[^{]*\{[^}]*block-size:\s*44px/s);
  assert.match(css, /\.board-wrap[^{]*\{[^}]*block-size:\s*326px/s);
  assert.match(css, /\.rack[^{]*\{[^}]*block-size:\s*68px/s);
  assert.match(css, /\.board[^{]*\{[^}]*inline-size:\s*358px/s);
  assert.match(css, /\[data-energy-dock\][^{]*\{[^}]*inline-size:\s*358px/s);
  assert.match(css, /\[data-energy-dock\][^{]*\{[^}]*block-size:\s*38px/s);
  assert.match(css, /\[data-energy-dock\][^{]*\{[^}]*position:\s*relative/s);
  assert.match(css, /\[data-energy-meter\]::after/);
  assert.match(css, /\[data-energy-grid\][^{]*\{[^}]*grid-template-columns:\s*repeat\(24,\s*1fr\)/s);
  assert.match(css, /\.energy-cell\.energy-filled::before/);
  assert.match(css, /@keyframes\s+energy-core-pulse/);
  assert.match(css, /\.clear-combo-pop/);
  assert.match(css, /@keyframes\s+clear-combo-pop/);
  assert.match(css, /\.fighter-hero \.mecha-hero-cannon/);
  assert.match(css, /\[data-status-live\][^{]*\{[^}]*clip-path:\s*inset\(50%\)/s);
  assert.match(css, /\.hero-perch \.actor\.fighter[^{]*\{[^}]*inline-size:\s*58px/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /min-block-size:\s*44px/);
  assert.ok(
    html.indexOf('data-feedback-layer') > html.indexOf('class="block-blast-panel'),
    'feedback portal must be outside the clipping battlefield and after the board panel',
  );
  assert.match(css, /\[data-reduced-motion\][^{]*\{[^}]*min-block-size:\s*44px/s);
  assert.match(css, /\.topbar[^{]*\{[^}]*min-block-size:\s*calc\([^)]*safe-area-inset-top/s);
  assert.match(css, /\.game-shell\.reduced-motion \.actor\.actor-enter[^{]*\{[^}]*actor-fade-in/s);
  assert.match(app, /placeRuntimePiece/);
  assert.doesNotMatch(app, /selectRuntimeRole/);
  assert.match(app, /selectRuntimeCard/);
  assert.match(app, /createInputController/);
  assert.match(app, /window\.__ROBLOCK_RUNTIME__/);
  assert.doesNotMatch(app, /deployRuntimeFighter|refreshRuntimeRack|undoRuntimePlacement/);
  assert.match(html, /<script\s+type="module"\s+src="\.\/src\/app\.js"><\/script>/);
});

test('every mecha locomotion posture preserves horizontal centering', async () => {
  const css = await readFile(new URL('styles.css', BASE), 'utf8');
  const expectedTranslations = {
    'shield-stomp': ['-50% 0', '-50% 3px'],
    'sword-hop': ['-50% 0', '-50% -4px'],
    'cannon-roll': ['-50% 0', '-50% 0'],
  };
  for (const [name, expected] of Object.entries(expectedTranslations)) {
    const body = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(body, `${name} keyframes must exist`);
    const translations = [...body.matchAll(/translate:\s*([^;}]+)/g)]
      .map((match) => match[1].trim());
    assert.deepEqual(translations, expected, `${name} must keep every posture centered`);
  }
});

test('renderer builds 63 board cells and a role-free 24-cell energy meter', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const view = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [
      { id: 'I2-h', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      null,
      { id: 'O', cells: [{ row: 0, col: 0 }, { row: 1, col: 1 }] },
    ] },
    production: { energy: 18, max: 24 },
    combat: { fighters: [], enemies: [], wallHp: 1000 },
    wallHp: 1000,
    wallMaxHp: 1000,
    countdown: '备战 5',
  };
  renderer.render(view);
  assert.equal(root.querySelectorAll('.board-cell').length, 63);
  assert.equal(root.querySelectorAll('[data-energy-cell]').length, 24);
  assert.equal(root.querySelectorAll('.energy-filled').length, 18);
  const energyCells = root.querySelectorAll('[data-energy-cell]');
  assert.equal(energyCells[0].dataset.energyCell, '1');
  assert.equal(energyCells.at(-1).dataset.energyCell, '24');
  assert.equal(energyCells[0].classList.contains('energy-filled'), true);
  assert.equal(energyCells.at(-1).classList.contains('energy-filled'), false);
  assert.equal(root.querySelectorAll('[data-latest]').length, 1);
  assert.equal(root.querySelector('[data-latest]').dataset.energyCell, '18');
  assert.equal(root.querySelector('[data-energy-meter]').getAttribute('aria-valuenow'), '18');
  assert.equal(root.querySelector('[data-role="sword"]'), null);

  renderer.render({ ...view, production: { ...view.production, energy: 19 } });
  assert.equal(root.querySelector('[data-energy-meter]').getAttribute('aria-valuenow'), '19');
});

test('hero role metadata has no production role button to shadow', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const view = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 5, max: 24 },
    combat: {
      fighters: [{ id: 'opening-hero', role: 'hero', hp: 220, maxHp: 220, cells: [] }],
      enemies: [],
      wallHp: 1000,
    },
    wallHp: 1000,
    wallMaxHp: 1000,
  };

  renderer.render(view);
  renderer.render({ ...view, production: { ...view.production, energy: 6 } });

  const actor = root.querySelector('[data-hero-perch]').querySelector('[data-role="hero"]');
  assert.equal(actor.getAttribute('aria-pressed'), null);
  assert.match(actor.getAttribute('aria-label'), /蓝甲炮手，自动开火，生命 220/);
  assert.equal(root.querySelector('[data-role-selector]'), null);
});

test('hero renders as a blue brick cannon in the command perch', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const base = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 0, max: 24 },
    wallHp: 1000,
  };
  renderer.render({
    ...base,
    combat: {
      fighters: [
        { id: 'hero-1', role: 'hero', hp: 220, maxHp: 220, x: 195, y: 60 },
      ],
      enemies: [],
    },
  });
  assert.equal(root.querySelectorAll('.mecha-rig').length, 1);
  assert.equal(root.querySelectorAll('.mecha-head').length, 1);
  assert.equal(root.querySelectorAll('.mecha-hero-cannon').length, 1);
  assert.equal(root.querySelectorAll('.actor-label').length, 0);
  assert.equal(root.querySelectorAll('.fighter-fixed-body').length, 0);
  assert.equal(root.querySelectorAll('.brick-quadrant').length, 0);
  assert.ok(root.querySelector('[data-hero-perch]').querySelector('.fighter-hero'));
});

test('enemy rendering exposes size silhouette and walking animation hooks', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const base = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 0, max: 24 },
    wallHp: 1000,
    combat: {
      fighters: [],
      enemies: [
        { id: 'tiny', type: 'fragment', hp: 14, maxHp: 14, x: 150, y: 700, scale: 0.55, silhouette: 'tiny-fragment' },
        { id: 'boss', type: 'commander', hp: 900, maxHp: 900, x: 220, y: 780, scale: 1.75, silhouette: 'wide-slam-commander', elite: true },
      ],
    },
  };
  renderer.render(base);
  renderer.render({
    ...base,
    combat: {
      ...base.combat,
      enemies: [
        { ...base.combat.enemies[0], y: 680 },
        { ...base.combat.enemies[1], y: 760 },
      ],
    },
  });

  const fragment = root.querySelector('.enemy-fragment');
  const commander = root.querySelector('.enemy-commander');
  assert.equal(fragment.style.values.get('--enemy-scale'), '0.55');
  assert.equal(fragment.dataset.silhouette, 'tiny-fragment');
  assert.equal(fragment.classList.contains('is-moving'), true);
  assert.equal(commander.style.values.get('--enemy-scale'), '1.75');
  assert.equal(commander.dataset.silhouette, 'wide-slam-commander');
  assert.equal(commander.classList.contains('elite'), true);
});

test('combat events animate actors, emit hit feedback and retain brick deaths for 260ms', async () => {
  const root = renderRoot();
  root.rect = { left: 0, top: 0, width: 390, height: 844 };
  root.querySelector('[data-battlefield]').rect = { left: 0, top: 44, width: 390, height: 360 };
  const renderer = createRenderer(root);
  const base = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 0, max: 24 },
    wallHp: 1000,
    combat: {
      fighters: [
        { id: 'fighter-hero', role: 'hero', hp: 220, maxHp: 220, x: 195, y: 60 },
      ],
      enemies: [
        { id: 'enemy-1', type: 'grunt', hp: 40, maxHp: 40, x: 160, y: 700 },
      ],
    },
  };
  renderer.render(base);
  renderer.render({
    ...base,
    combatEvents: [
      { type: 'fighter-windup', fighterId: 'fighter-hero', role: 'hero' },
      {
        type: 'fighter-attack',
        fighterId: 'fighter-hero',
        enemyId: 'enemy-1',
        role: 'hero',
        damage: 20,
      },
      {
        type: 'projectile-fired',
        fighterId: 'fighter-hero',
        enemyId: 'enemy-1',
        role: 'hero',
      },
      {
        type: 'unit-hurt',
        unitKind: 'enemy',
        unitId: 'enemy-1',
        targetX: 160,
        targetY: 700,
        damage: 20,
      },
    ],
  });

  assert.ok(root.querySelector('.fighter-hero').classList.contains('state-recoil'));
  assert.ok(root.querySelector('.enemy-grunt').classList.contains('state-hurt'));
  const damagePop = root.querySelector('[data-feedback-kind="damage-pop"]');
  assert.ok(damagePop);
  assert.equal(damagePop.style.values.get('left'), '160px');
  assert.equal(damagePop.style.values.get('top'), '152px');

  renderer.render({
    ...base,
    combat: { ...base.combat, enemies: [] },
    combatEvents: [{
      type: 'unit-death',
      unitKind: 'enemy',
      unitId: 'enemy-1',
    }],
  });
  const dyingEnemy = root.querySelector('.enemy-grunt');
  assert.ok(dyingEnemy);
  assert.ok(dyingEnemy.classList.contains('state-death'));
  assert.equal(root.querySelectorAll('[data-feedback-kind="brick-debris"]').length, 4);

  await new Promise((resolve) => setTimeout(resolve, 120));
  renderer.render({
    ...base,
    combat: { ...base.combat, enemies: [] },
    combatEvents: [],
  });
  assert.equal(root.querySelector('.enemy-grunt'), dyingEnemy);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(root.querySelector('.enemy-grunt'), null);
});

test('combat feedback uses target coordinates and event-specific oscillator presets', () => {
  const root = renderRoot();
  root.rect = { left: 0, top: 0, width: 390, height: 844 };
  root.querySelector('[data-battlefield]').rect = { left: 0, top: 44, width: 390, height: 360 };
  const oscillators = [];
  class FakeAudioContext {
    constructor() {
      this.currentTime = 10;
      this.destination = {};
    }
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        type: 'sine',
        connect: () => oscillator,
        start() {},
        stop(time) { oscillator.stopTime = time; },
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      const gain = {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect: () => gain,
      };
      return gain;
    }
  }
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const feedback = createFeedback(root);
    feedback.playEvent({
      type: 'fighter-attack',
      role: 'sword',
      x: 39,
      y: 900,
      targetX: 195,
      targetY: 500,
    });
    feedback.playEvent({ type: 'shield-bash', targetX: 160, targetY: 700 });
    feedback.playEvent({ type: 'projectile-impact', targetX: 180, targetY: 600 });
    feedback.playEvent({ type: 'projectile-impact', targetX: 220, targetY: 580, element: 'fire' });
    feedback.playEvent({ type: 'unit-hurt', targetX: 180, targetY: 600 });
    feedback.playEvent({ type: 'unit-death', targetX: 180, targetY: 600 });

    const spark = root.querySelector('.hit-spark');
    assert.equal(spark.style.values.get('left'), '195px');
    assert.equal(spark.style.values.get('top'), '224px');
    const blast = root.querySelector('.cannon-blast');
    assert.equal(blast.style.values.get('left'), '180px');
    assert.equal(blast.style.values.get('top'), '188px');
    assert.ok(root.querySelector('.fire-blast'));
    assert.ok(root.querySelector('.fire-burst'));
    assert.deepEqual(
      oscillators.map(({ frequency, type }) => [frequency.value, type]),
      [
        [220, 'sawtooth'],
        [74, 'square'],
        [46, 'sawtooth'],
        [46, 'sawtooth'],
        [130, 'square'],
        [62, 'triangle'],
      ],
    );
  } finally {
    globalThis.window = previousWindow;
  }
});

test('reduced motion keeps essential hit sounds but omits long projectile travel', () => {
  const root = renderRoot();
  root.classList.add('reduced-motion');
  let oscillatorCount = 0;
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
    }
    createOscillator() {
      oscillatorCount += 1;
      return {
        frequency: { value: 0 },
        connect() { return this; },
        start() {},
        stop() {},
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() { return this; },
      };
    }
  }
  const previousWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const feedback = createFeedback(root);
    feedback.playEvent({ type: 'projectile-fired', targetX: 195, targetY: 500 });
    assert.equal(root.querySelector('.cannon-projectile'), null);
    feedback.playEvent({
      type: 'fighter-attack',
      role: 'sword',
      targetX: 195,
      targetY: 500,
    });
    assert.ok(root.querySelector('.hit-spark').classList.contains('reduced'));
    assert.equal(oscillatorCount, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('CSS exposes the complete actor impact set and static reduced-motion states', async () => {
  const css = await readFile(new URL('styles.css', BASE), 'utf8');
  for (const selector of [
    '.fighter-sword.state-windup .mecha-rig',
    '.fighter-sword.state-strike .mecha-rig',
    '.fighter-shield.state-bash .mecha-rig',
    '.fighter-cannon.state-recoil .mecha-rig',
    '.actor.state-hurt .enemy-art',
    '.actor.state-death',
    '.damage-pop',
    '.brick-debris',
    '.hit-spark',
    '.fire-blast',
    '.enemy-commander .enemy-art',
    '.enemy-fragment .enemy-art',
    '.enemy.is-moving .enemy-art',
    '.skill-button',
    '.impact-shake',
  ]) {
    assert.match(css, new RegExp(selector.replaceAll('.', '\\.').replaceAll(' ', '\\s+')));
  }
  for (const keyframes of [
    'sword-windup',
    'sword-strike',
    'shield-bash',
    'cannon-recoil',
    'actor-hurt',
    'brick-death',
    'enemy-walk',
    'fire-burst',
  ]) {
    assert.match(css, new RegExp(`@keyframes\\s+${keyframes}`));
  }
  assert.match(css, /\.reduced-motion[^{]*state-strike[\s\S]*outline:/);
  assert.match(css, /\.reduced-motion\.impact-shake[^{]*\{[^}]*transform:\s*none/s);
});

test('semantic production events create energy and spawn feedback without recomputing energy', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  renderer.render({
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 2, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    events: [
      {
        type: 'production-energy-gained',
        beforeEnergy: 20,
        gain: 6,
        energy: 2,
        thresholdCrossings: 1,
        remainder: 2,
        placedCellCount: 5,
        clearedLineCount: 0,
        boardPoints: [{ row: 1, col: 2 }],
      },
      { type: 'upgrade-ready', sequence: 9 },
    ],
  });
  assert.equal(root.querySelector('[data-energy-meter]').getAttribute('aria-valuenow'), '2');
  assert.equal(
    root.querySelectorAll('.energy-threshold').length,
    24,
    'a threshold crossing must visibly flash all 24 pips before returning to overflow',
  );
  assert.ok(root.querySelector('[data-feedback-kind="energy-travel"]'));
  assert.ok(root.querySelector('[data-feedback-kind="fighter-spawn"]'));
  assert.match(root.querySelector('[data-status-live]').textContent, /充能|强化/);
});

test('skill bar renders a circular fire button when the root fire card is owned', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const view = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 0, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    modifiers: { chosenCards: ['split-shot', 'fire-shell'] },
  };
  renderer.render(view);

  const skill = root.querySelector('[data-skill-button="fire-shell"]');
  assert.ok(skill);
  assert.equal(skill.classList.contains('skill-button'), true);
  assert.match(skill.getAttribute('aria-label'), /火爆弹/);
  assert.equal(skill.textContent.includes('火'), true);
});

test('cross clear energy feedback calls out the block blast x2 multiplier', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  renderer.render({
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 2, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    events: [{
      type: 'production-energy-gained',
      beforeEnergy: 0,
      baseEnergy: 13,
      clearMultiplier: 2,
      gain: 26,
      energy: 2,
      thresholdCrossings: 1,
      remainder: 2,
      placedCellCount: 1,
      clearedLineCount: 2,
      boardPoints: [{ row: 6, col: 6 }],
    }],
  });

  assert.match(root.querySelector('[data-status-live]').textContent, /横竖同消.*x2.*\+26/);
  const combo = root.querySelector('[data-feedback-kind="clear-combo"]');
  assert.ok(combo);
  assert.match(combo.textContent, /横竖同消.*x2/);
});

test('player deadlock recovery replaces stale energy feedback with a clear recovery message', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  renderer.render({
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 3, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    events: [
      {
        type: 'production-energy-gained',
        gain: 4,
        placedCellCount: 4,
        clearedLineCount: 0,
        boardPoints: [{ row: 0, col: 5 }],
      },
      {
        type: 'production-deadlock',
        energy: 3,
        lockSeconds: 3,
      },
    ],
  });

  assert.match(
    root.querySelector('[data-status-live]').textContent,
    /死局.*清盘.*能量减半.*3 秒/,
  );
});

test('drag ghost is positioned in the game-shell coordinate space', () => {
  const root = renderRoot();
  root.rect = { left: 100, top: 50, width: 390, height: 844 };
  const renderer = createRenderer(root);
  renderer.render({
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 0, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
  });
  root.querySelectorAll('.board-cell').forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    cell.rect = {
      left: 110 + col * 38,
      top: 100 + row * 38,
      width: 35,
      height: 35,
    };
  });

  renderer.renderGhost({
    piece: { id: 'I2', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
    anchor: { row: 2, col: 3 },
    valid: true,
  });

  const ghost = root.querySelector('[data-drag-ghost]');
  assert.equal(ghost.style.values.get('left'), '124px');
  assert.equal(ghost.style.values.get('top'), '126px');
  assert.ok(ghost.classList.contains('active'));
});

test('energy particles map logical board points to the top-level meter portal', () => {
  const root = renderRoot();
  root.rect = { left: 100, top: 50, width: 390, height: 844 };
  const renderer = createRenderer(root);
  const base = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 2, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    events: [],
  };
  renderer.render(base);
  root.querySelector('[data-board]').rect = {
    left: 110,
    top: 540,
    width: 358,
    height: 280,
  };
  root.querySelector('[data-energy-meter]').rect = {
    left: 110,
    top: 490,
    width: 358,
    height: 38,
  };
  root.querySelectorAll('.board-cell').forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    cell.rect = {
      left: 110 + col * 40,
      top: 540 + row * 40,
      width: 37,
      height: 37,
    };
  });
  renderer.render({
    ...base,
    production: { ...base.production, energy: 4 },
    events: [{
      type: 'production-energy-gained',
      gain: 2,
      boardPoints: [{ row: 6, col: 6 }, { row: 4, col: 3 }],
    }],
  });

  const particles = root.querySelectorAll('[data-feedback-kind="energy-travel"]');
  assert.equal(particles.length, 2);
  assert.equal(root.querySelector('[data-feedback-layer]').parentElement, root);
  assert.equal(particles[0].dataset.sourceRow, '6');
  assert.equal(particles[0].dataset.sourceCol, '6');
  assert.ok(
    Number.parseFloat(particles[0].style.values.get('--travel-from-y'))
      > Number.parseFloat(particles[0].style.values.get('--travel-to-y')),
    'particle must travel upward from the board to the top energy meter',
  );
  assert.equal(particles[0].style.values.get('--travel-duration'), '240ms');
  assert.equal(particles[1].style.values.get('--travel-duration'), '260ms');
});

test('energy particle coordinates have a deterministic board-area fallback without DOM rects', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  renderer.render({
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 1, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    events: [{
      type: 'production-energy-gained',
      gain: 1,
      boardPoints: [{ row: 5, col: 4 }],
    }],
  });
  const particle = root.querySelector('[data-feedback-kind="energy-travel"]');
  for (const property of [
    '--travel-from-x',
    '--travel-from-y',
    '--travel-to-x',
    '--travel-to-y',
  ]) {
    assert.match(particle.style.values.get(property), /^-?\d+(?:\.\d+)?px$/);
  }
});

test('pip fill stagger uses the relative order of only newly added pips', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const view = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 18, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
  };
  renderer.render(view);
  renderer.render({ ...view, production: { ...view.production, energy: 21 } });
  const cells = root.querySelectorAll('[data-energy-cell]');
  const cell = (value) => cells.find(({ dataset }) => dataset.energyCell === String(value));
  assert.equal(cell(18).classList.contains('energy-new'), false);
  assert.equal(cell(19).style.values.get('--pip-delay'), '0ms');
  assert.equal(cell(20).style.values.get('--pip-delay'), '25ms');
  assert.equal(cell(21).style.values.get('--pip-delay'), '50ms');
  renderer.render({ ...view, production: { ...view.production, energy: 21 } });
  assert.equal(cell(19).classList.contains('energy-new'), true);
  assert.equal(cell(19).style.values.get('--pip-delay'), '0ms');
  assert.equal(cell(21).classList.contains('energy-new'), true);
  assert.equal(cell(21).style.values.get('--pip-delay'), '50ms');

  renderer.render({ ...view, production: { ...view.production, energy: 22 } });
  renderer.render({ ...view, production: { ...view.production, energy: 3 } });
  assert.equal(cell(19).classList.contains('energy-new'), false);
  assert.equal(cell(21).classList.contains('energy-new'), false);
  assert.equal(cell(1).style.values.get('--pip-delay'), '0ms');
  assert.equal(cell(2).style.values.get('--pip-delay'), '25ms');
  assert.equal(cell(3).style.values.get('--pip-delay'), '50ms');
  renderer.render({ ...view, production: { ...view.production, energy: 0 } });
  assert.equal(cells.every((cell) => !cell.classList.contains('energy-new')), true);
});

test('modal makes all gameplay regions inert, focuses its first action and restores focus', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const base = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 0, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    phase: 'prep',
  };
  renderer.render(base);
  const priorFocus = root.querySelector('[data-reduced-motion]');
  priorFocus.focus();
  const draftView = {
    ...base,
    phase: 'draft',
    draft: {
      active: true,
      cards: [
        { id: 'split-shot', name: '分裂弹', description: '更多目标' },
        { id: 'heavy-shell', name: '重弹头', description: '更强攻击' },
      ],
    },
  };
  renderer.render(draftView);
  const backgrounds = root.querySelectorAll('[data-ui-background]');
  assert.equal(backgrounds.length, 4);
  assert.equal(backgrounds.every((region) => region.inert), true);
  assert.equal(backgrounds.every((region) => region.getAttribute('aria-hidden') === 'true'), true);
  assert.equal(root.ownerDocument.activeElement.dataset.draftCard, 'split-shot');
  renderer.render(draftView);
  assert.equal(root.ownerDocument.activeElement.parentElement !== null, true);
  assert.equal(root.ownerDocument.activeElement.dataset.draftCard, 'split-shot');

  renderer.render(base);
  assert.equal(backgrounds.every((region) => !region.inert), true);
  assert.equal(backgrounds.every((region) => region.getAttribute('aria-hidden') === null), true);
  assert.equal(root.ownerDocument.activeElement, priorFocus);
});

test('victory modal focuses restart and manual reduced motion keeps fade but removes travel', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const reduced = root.querySelector('[data-reduced-motion]');
  reduced.click();
  assert.equal(root.classList.contains('reduced-motion'), true);
  assert.equal(reduced.getAttribute('aria-pressed'), 'true');
  renderer.render({
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 1, max: 24 },
    combat: {
      fighters: [{ id: 'fighter-rm', role: 'hero', hp: 220, maxHp: 220 }],
      enemies: [],
    },
    wallHp: 1000,
    phase: 'victory',
    events: [{
      type: 'production-energy-gained',
      gain: 1,
      boardPoints: [{ row: 1, col: 1 }],
    }],
  });
  assert.equal(root.querySelectorAll('[data-feedback-kind="energy-travel"]').length, 0);
  assert.ok(root.querySelector('[data-feedback-kind="energy-outline"]'));
  assert.ok(root.querySelector('.actor').classList.contains('actor-enter'));
  assert.ok(root.ownerDocument.activeElement.dataset.restart !== undefined);
});

test('modal focus trap loops draft actions and replaces its handler across terminal dialogs', () => {
  const root = renderRoot();
  const renderer = createRenderer(root);
  const base = {
    board: { rows: 7, cols: 9, cells: Array(63).fill(null) },
    rack: { rack: [null, null, null] },
    production: { energy: 0, max: 24 },
    combat: { fighters: [], enemies: [] },
    wallHp: 1000,
    phase: 'prep',
  };
  renderer.render(base);
  const priorFocus = root.querySelector('[data-reduced-motion]');
  priorFocus.focus();
  renderer.render({
    ...base,
    phase: 'draft',
    draft: {
      active: true,
      cards: [
        { id: 'split-shot', name: '分裂弹' },
        { id: 'rapid-loader', name: '速射' },
        { id: 'heavy-shell', name: '重弹' },
      ],
    },
  });
  const draftOverlay = root.querySelector('[data-segment-overlay]');
  const draftButtons = draftOverlay.querySelectorAll('[data-draft-card]');
  let prevented = 0;
  draftButtons.at(-1).focus();
  draftOverlay.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    shiftKey: false,
    preventDefault: () => { prevented += 1; },
  });
  assert.equal(root.ownerDocument.activeElement, draftButtons[0]);
  draftButtons[0].focus();
  draftOverlay.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    shiftKey: true,
    preventDefault: () => { prevented += 1; },
  });
  assert.equal(root.ownerDocument.activeElement, draftButtons.at(-1));
  assert.equal(prevented, 2);
  assert.equal(draftOverlay.listeners.get('keydown')?.size, 1);

  renderer.render({ ...base, phase: 'victory' });
  const victoryOverlay = root.querySelector('[data-victory-overlay]');
  const victoryButton = victoryOverlay.querySelector('[data-restart]');
  assert.equal(draftOverlay.listeners.has('keydown'), false);
  assert.equal(victoryOverlay.listeners.get('keydown')?.size, 1);
  assert.equal(root.ownerDocument.activeElement, victoryButton);
  victoryOverlay.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    shiftKey: false,
    preventDefault: () => { prevented += 1; },
  });
  assert.equal(root.ownerDocument.activeElement, victoryButton);

  renderer.render({ ...base, phase: 'defeat' });
  const defeatOverlay = root.querySelector('[data-defeat-overlay]');
  const defeatButton = defeatOverlay.querySelector('[data-restart]');
  assert.equal(victoryOverlay.listeners.has('keydown'), false);
  assert.equal(defeatOverlay.listeners.get('keydown')?.size, 1);
  defeatOverlay.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    shiftKey: true,
    preventDefault: () => { prevented += 1; },
  });
  assert.equal(root.ownerDocument.activeElement, defeatButton);

  renderer.render(base);
  assert.equal(defeatOverlay.listeners.has('keydown'), false);
  assert.equal(root.ownerDocument.activeElement, priorFocus);
});
