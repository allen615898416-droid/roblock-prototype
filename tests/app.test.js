import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp, runtimeOptionsForWindow } from '../src/app.js';
import {
  createRuntimeState,
  placeRuntimePiece,
  stepRuntime,
} from '../src/runtime-controller.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    enabled ? this.values.add(name) : this.values.delete(name);
    return enabled;
  }
}

class FakeTarget {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.attributes = new Map();
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, target: this, currentTarget: this, ...event });
    }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

function clickTarget(kind, value) {
  const target = new FakeTarget();
  if (kind === 'role' || kind === 'actor-role') target.dataset.role = value;
  if (kind === 'card') target.dataset.draftCard = value;
  if (kind === 'restart') target.dataset.restart = '';
  target.closest = (selector) => {
    if (
      (selector === '[data-role]' || selector === '[data-role-selector] [data-role]')
      && kind === 'role'
    ) return target;
    if (selector === '[data-role]' && kind === 'actor-role') return target;
    if (selector === '[data-draft-card]' && kind === 'card') return target;
    if (selector === '[data-restart]' && kind === 'restart') return target;
    return null;
  };
  return target;
}

function createHarness(options = {}) {
  const reducedMotion = new FakeTarget();
  const root = new FakeTarget();
  root.querySelector = (selector) => (
    selector === '[data-reduced-motion]' ? reducedMotion : null
  );
  const renderer = {
    views: [],
    statuses: [],
    clearGhostCalls: 0,
    render(view) { this.views.push(view); },
    setStatus(message) { this.statuses.push(message); },
    clearGhost() { this.clearGhostCalls += 1; },
  };
  const feedback = {
    events: [],
    reducedMotion: [],
    playEvent(event) { this.events.push(event); },
    setReducedMotion(value) { this.reducedMotion.push(value); },
  };
  const inputConfigs = [];
  let inputControllerCalls = 0;
  const frameCallbacks = [];
  const windowObject = {};
  const app = createApp({
    root,
    windowObject,
    runtimeOptions: { tutorial: false },
    createRenderer: () => renderer,
    createFeedback: () => feedback,
    createInputController: (config) => {
      inputControllerCalls += 1;
      inputConfigs.push(config);
      return { destroy() {} };
    },
    requestAnimationFrame: (callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    },
    now: () => 0,
    ...options,
  });
  return {
    app,
    bridge: windowObject.__ROBLOCK_RUNTIME__,
    feedback,
    frameCallbacks,
    inputConfigs,
    inputControllerCalls: () => inputControllerCalls,
    reducedMotion,
    renderer,
    root,
    click(kind, value) {
      root.dispatch('click', { target: clickTarget(kind, value) });
    },
    runFrame(timestamp) {
      const callback = frameCallbacks.shift();
      assert.ok(callback, 'expected one scheduled animation frame');
      callback(timestamp);
    },
  };
}

test('browser runtime keeps the guided opening by default and exposes normal-opening QA for big-block pool checks', () => {
  assert.deepEqual(runtimeOptionsForWindow({
    location: { search: '' },
  }), { demoOpening: true });
  assert.deepEqual(runtimeOptionsForWindow({
    location: { search: '?qa=normal-opening' },
  }), { demoOpening: false });
  assert.deepEqual(runtimeOptionsForWindow({
    location: { search: '?qa=demo-opening' },
  }), { demoOpening: true });
});

function runtimeForPhase(phase) {
  const state = createRuntimeState({ tutorial: false, seed: 7 });
  if (phase === 'active') {
    return {
      ...state,
      phase,
      prepRemaining: 0,
      expedition: { ...state.expedition, phase },
      combat: { ...state.combat, phase },
    };
  }
  if (phase === 'draft') {
    return {
      ...state,
      phase,
      expedition: {
        ...state.expedition,
        phase,
        draft: {
          segmentIndex: 0,
          selectedCardId: null,
          cards: [
            { id: 'split-shot', name: '分裂弹', description: '额外波及' },
            { id: 'rapid-loader', name: '速射齿轮', description: '提升攻速' },
            { id: 'heavy-shell', name: '重弹头', description: '提升伤害' },
          ],
          reason: 'energy-full',
          sequence: 1,
        },
      },
      combat: { ...state.combat, phase },
      pendingUpgradeDraft: {
        sequence: 1,
        resumePhase: 'active',
        resumeCombatPhase: 'active',
        resumeExpeditionPhase: 'active',
      },
    };
  }
  return {
    ...state,
    phase,
    expedition: { ...state.expedition, phase },
    combat: { ...state.combat, phase },
  };
}

test('QA bridge mutates and returns the one live runtime through real runtime semantics', () => {
  const harness = createHarness();
  const initial = harness.bridge.getState();
  assert.equal(initial.phase, 'prep');
  assert.equal(initial.prepRemaining, 5);

  const stepped = harness.bridge.step(1);
  assert.equal(stepped, harness.bridge.getState());
  assert.notEqual(stepped, initial);
  assert.equal(stepped.prepRemaining, 4);

  const scaled = harness.bridge.setTimeScale(2);
  assert.equal(scaled, harness.bridge.getState());
  assert.equal(scaled.timeScale, 2);

  const forwarded = harness.bridge.fastForward(1, { frameDt: 1 });
  assert.equal(forwarded, harness.bridge.getState());
  assert.equal(forwarded.prepRemaining, 2);
});

test('one animation frame performs one step and restart reuses the single loop and bindings', () => {
  let createCalls = 0;
  let stepCalls = 0;
  const harness = createHarness({
    createRuntimeState: (options) => {
      createCalls += 1;
      return createRuntimeState(options);
    },
    stepRuntime: (state, dt, options) => {
      stepCalls += 1;
      return stepRuntime(state, dt, options);
    },
  });

  assert.equal(createCalls, 1);
  assert.equal(harness.inputControllerCalls(), 1);
  assert.equal(harness.root.listenerCount('click'), 1);
  assert.equal(harness.reducedMotion.listenerCount('click'), 1);
  assert.equal(harness.frameCallbacks.length, 1);

  harness.runFrame(100);
  assert.equal(stepCalls, 1);
  assert.equal(harness.frameCallbacks.length, 1);

  const beforeRestart = harness.bridge.getState();
  harness.click('restart');
  assert.notEqual(harness.bridge.getState(), beforeRestart);
  assert.equal(createCalls, 2);
  assert.equal(harness.inputControllerCalls(), 1);
  assert.equal(harness.root.listenerCount('click'), 1);
  assert.equal(harness.reducedMotion.listenerCount('click'), 1);
  assert.equal(harness.frameCallbacks.length, 1);

  harness.runFrame(200);
  assert.equal(stepCalls, 2);
  assert.equal(harness.frameCallbacks.length, 1);
});

test('preview delegates placement without replacing live runtime, consuming events or advancing seed', () => {
  const placementCalls = [];
  const harness = createHarness({
    placeRuntimePiece: (state, command) => {
      placementCalls.push({ state, command });
      return placeRuntimePiece(state, command);
    },
  });
  const before = harness.bridge.getState();
  const events = before.events;
  const seed = before.rack.seed;
  const piece = before.rack.rack[0];

  const preview = harness.inputConfigs[0].tryPreview(piece, { row: 0, col: 0 });

  assert.equal(preview.ok, true);
  assert.equal(placementCalls.length, 1);
  assert.equal(placementCalls[0].state, before);
  assert.deepEqual(placementCalls[0].command, {
    slot: 0,
    anchor: { row: 0, col: 0 },
  });
  assert.equal(harness.bridge.getState(), before);
  assert.equal(harness.bridge.getState().events, events);
  assert.equal(harness.bridge.getState().events.length, events.length);
  assert.equal(harness.bridge.getState().rack.seed, seed);
});

test('active phase accepts drops, has no role switching, and rejects draft-card input', () => {
  const harness = createHarness({ initialRuntime: runtimeForPhase('active') });

  harness.click('role', 'sword');
  assert.equal(harness.bridge.getState().selectedRole, 'hero');

  const beforeDrop = harness.bridge.getState();
  harness.inputConfigs[0].onDrop({ slot: 0, anchor: { row: 0, col: 0 } });
  assert.notEqual(harness.bridge.getState(), beforeDrop);
  assert.equal(harness.bridge.getState().rack.rack[0], null);

  const afterDrop = harness.bridge.getState();
  harness.click('card', 'split-shot');
  assert.equal(harness.bridge.getState(), afterDrop);
});

test('clicking a combat actor with role metadata cannot change the fixed hero role', () => {
  const harness = createHarness({ initialRuntime: runtimeForPhase('active') });

  harness.click('actor-role', 'sword');

  assert.equal(harness.bridge.getState().selectedRole, 'hero');
});

test('energy draft permits only its offered card and terminal modals reject drop role and card', () => {
  const draftHarness = createHarness({ initialRuntime: runtimeForPhase('draft') });
  const draftState = draftHarness.bridge.getState();
  draftHarness.inputConfigs[0].onDrop({ slot: 0, anchor: { row: 0, col: 0 } });
  draftHarness.click('role', 'sword');
  assert.equal(draftHarness.bridge.getState(), draftState);

  draftHarness.click('card', 'split-shot');
  assert.equal(draftHarness.bridge.getState().phase, 'active');
  assert.equal(draftHarness.bridge.getState().expedition.segmentIndex, 0);

  for (const phase of ['victory', 'defeat']) {
    const harness = createHarness({ initialRuntime: runtimeForPhase(phase) });
    const terminal = harness.bridge.getState();
    harness.inputConfigs[0].onDrop({ slot: 0, anchor: { row: 0, col: 0 } });
    harness.click('role', 'sword');
    harness.click('card', 'split-shot');
    assert.equal(harness.bridge.getState(), terminal, `${phase} must keep its runtime identity`);
  }
});

test('production and combat semantic events are each routed to feedback once', () => {
  const productionEvent = {
    type: 'production-energy-gained',
    gain: 3,
    energy: 3,
    boardPoints: [{ row: 0, col: 0 }],
  };
  const combatEvent = {
    type: 'fighter-attack',
    fighterId: 'opening-hero',
    role: 'hero',
  };
  const initial = createRuntimeState();
  const harness = createHarness({
    initialRuntime: {
      ...initial,
      events: [productionEvent],
      combat: {
        ...initial.combat,
        events: [combatEvent],
      },
    },
  });

  harness.bridge.step(1 / 30);
  harness.runFrame(100);

  const productionRoutes = harness.renderer.views
    .flatMap(({ events }) => events)
    .filter((event) => event === productionEvent);
  assert.equal(productionRoutes.length, 1);
  const actorRoutes = harness.renderer.views
    .flatMap(({ combatEvents = [] }) => combatEvents)
    .filter((event) => event === combatEvent);
  assert.deepEqual(actorRoutes, [combatEvent]);
  assert.deepEqual(
    harness.feedback.events.filter((event) => event === combatEvent),
    [combatEvent],
  );
});
