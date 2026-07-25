import { createInputController } from './input-controller.js';
import { createFeedback } from './feedback.js';
import { createRenderer } from './render.js';
import {
  createRuntimeState,
  fastForwardRuntime,
  placeRuntimePiece,
  selectRuntimeCard,
  setRuntimeTimeScale,
  stepRuntime,
} from './runtime-controller.js';

const INPUT_FAILURE_MESSAGES = Object.freeze({
  'empty-slot': '这个候选位已经用掉了。',
  'input-locked': '当前阶段不能操作生产台。',
  'invalid-anchor': '请把积木完整放进棋盘。',
  'invalid-card': '这张强化当前不可选择。',
  'invalid-slot': '没有找到这个候选积木。',
  'not-drafting': '当前没有待选择的强化。',
  'out-of-bounds': '积木超出棋盘边界。',
  overlap: '这里已经有积木了。',
  'production-locked': '生产台维修中，请稍候。',
  'role-system-removed': 'V1.0 已改为单主角自动开火。',
});

function createRuntimeView(state, events = state.events, combatEvents = []) {
  const { expedition } = state;
  const segmentId = expedition.segment?.id || '';
  const draft = expedition.draft;
  let countdown = '战斗中';
  if (state.phase === 'tutorial') countdown = '教学';
  else if (state.phase === 'prep') countdown = `备战 ${Math.ceil(state.prepRemaining)}`;
  else if (state.phase === 'upgrade-ready') countdown = '能量满格';
  else if (state.phase === 'draft') countdown = '选择强化';
  else if (state.phase === 'victory') countdown = '胜利';
  else if (state.phase === 'defeat') countdown = '防线失守';

  return {
    phase: state.phase,
    board: state.board,
    rack: state.rack,
    production: state.production,
    combat: state.combat,
    level: expedition.level,
    modifiers: expedition.modifiers,
    chosenCards: expedition.modifiers.chosenCards,
    wallHp: state.combat.wallHp,
    wallMaxHp: expedition.level.wallHp,
    countdown,
    segmentLabel: `${expedition.level.id} · ${segmentId}`,
    draft: {
      active: state.phase === 'draft',
      cards: draft?.cards || [],
      locked: Boolean(draft?.selectedCardId),
    },
    victory: state.phase === 'victory',
    defeat: state.phase === 'defeat',
    events,
    combatEvents,
  };
}

export function createApp({
  root,
  windowObject = globalThis.window,
  runtimeOptions = {},
  initialRuntime = null,
  createFeedback: makeFeedback = createFeedback,
  createInputController: makeInputController = createInputController,
  createRenderer: makeRenderer = createRenderer,
  createRuntimeState: makeRuntime = createRuntimeState,
  fastForwardRuntime: fastForward = fastForwardRuntime,
  now = () => globalThis.performance.now(),
  placeRuntimePiece: placePiece = placeRuntimePiece,
  requestAnimationFrame: scheduleFrame = windowObject.requestAnimationFrame.bind(windowObject),
  selectRuntimeCard: selectCard = selectRuntimeCard,
  setRuntimeTimeScale: setTimeScale = setRuntimeTimeScale,
  stepRuntime: step = stepRuntime,
} = {}) {
  const renderer = makeRenderer(root);
  const feedback = makeFeedback(root);
  let runtime = initialRuntime ?? makeRuntime(runtimeOptions);
  let lastFrameTime = now();
  let seenRuntimeEvents = new WeakSet();
  let seenCombatEvents = new WeakSet();

  function takeFreshEvents(events, seen) {
    const fresh = [];
    for (const event of events || []) {
      if (!event || typeof event !== 'object' || seen.has(event)) continue;
      seen.add(event);
      fresh.push(event);
    }
    return fresh;
  }

  function render() {
    const runtimeEvents = takeFreshEvents(runtime.events, seenRuntimeEvents);
    const combatEvents = takeFreshEvents(runtime.combat.events, seenCombatEvents);
    renderer.render(createRuntimeView(runtime, runtimeEvents, combatEvents));
    for (const event of combatEvents) {
      feedback.playEvent(event);
    }
  }

  function advance(realDt) {
    runtime = step(runtime, realDt);
    render();
    return runtime;
  }

  function acceptResult(result, successMessage = '') {
    if (!result.ok) {
      renderer.setStatus(INPUT_FAILURE_MESSAGES[result.reason] || '当前操作未生效。');
      return false;
    }
    runtime = result.state;
    render();
    if (successMessage) renderer.setStatus(successMessage);
    return true;
  }

  function restart() {
    runtime = makeRuntime(runtimeOptions);
    lastFrameTime = now();
    seenRuntimeEvents = new WeakSet();
    seenCombatEvents = new WeakSet();
    renderer.clearGhost();
    render();
    renderer.setStatus('消除整行或整列，为主角强化充能。');
    return runtime;
  }

  makeInputController({
    root,
    getPiece: (slot) => runtime.rack.rack[slot],
    getBoardState: () => runtime.board,
    tryPreview: (piece, anchor) => placePiece(runtime, {
      slot: runtime.rack.rack.indexOf(piece),
      anchor,
    }),
    onDrop: ({ slot, anchor }) => {
      const result = placePiece(runtime, { slot, anchor });
      acceptResult(result);
      return result;
    },
    renderer,
    feedback,
  });

  root.addEventListener('click', (event) => {
    const draftButton = event.target.closest('[data-draft-card]');
    if (draftButton) {
      acceptResult(
        selectCard(runtime, draftButton.dataset.draftCard),
        '强化已装配，准备下一战段。',
      );
      return;
    }

    if (event.target.closest('[data-restart]')) restart();
  });

  root.querySelector('[data-reduced-motion]')?.addEventListener('click', () => {
    feedback.setReducedMotion(root.classList.contains('reduced-motion'));
  });

  function frame(timestamp) {
    const dt = Math.min(0.1, Math.max(0, (timestamp - lastFrameTime) / 1000));
    lastFrameTime = timestamp;
    advance(dt);
    scheduleFrame(frame);
  }

  const bridge = Object.freeze({
    getState: () => runtime,
    step: (realDt = 1 / 30) => advance(realDt),
    fastForward: (realSeconds, options = {}) => {
      runtime = fastForward(runtime, realSeconds, options);
      render();
      return runtime;
    },
    setTimeScale: (timeScale) => {
      runtime = setTimeScale(runtime, timeScale);
      render();
      return runtime;
    },
  });

  windowObject.__ROBLOCK_RUNTIME__ = bridge;
  render();
  renderer.setStatus('消除整行或整列，为主角强化充能。');
  scheduleFrame(frame);
  return { bridge };
}

export function runtimeOptionsForWindow(windowObject = {}) {
  const params = new URLSearchParams(windowObject.location?.search || '');
  return {
    demoOpening: params.get('qa') !== 'normal-opening',
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  // Preload all PNG assets before showing the main view.
  const ASSET_PATTERNS = [
    './assets/enemies/png/chr_enm_grunt_body.png',
    './assets/enemies/png/chr_enm_runner_body.png',
    './assets/enemies/png/chr_enm_heavy_body.png',
    './assets/enemies/png/chr_enm_swarm_body.png',
    './assets/generated/commander.png',
    './assets/static/level-1-1-broken-street.png',
  ];

  function preloadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => resolve(src); // resolve anyway, don't block startup
      img.src = src;
    });
  }

  function hideLoading() {
    const overlay = document.querySelector('[data-loading]');
    if (!overlay) return;
    overlay.classList.add('is-ready');
    setTimeout(() => overlay.remove(), 500);
  }

  Promise.all(ASSET_PATTERNS.map(preloadImage))
    .then(() => {
      const browserApp = createApp({
        root: document.querySelector('[data-game-shell]'),
        windowObject: window,
        runtimeOptions: runtimeOptionsForWindow(window),
      });
      window.__ROBLOCK_RUNTIME__ = browserApp.bridge;
      hideLoading();
    })
    .catch(() => {
      // If preload fails entirely, still start the app
      const browserApp = createApp({
        root: document.querySelector('[data-game-shell]'),
        windowObject: window,
        runtimeOptions: runtimeOptionsForWindow(window),
      });
      window.__ROBLOCK_RUNTIME__ = browserApp.bridge;
      hideLoading();
    });
}
