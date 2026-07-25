const SOUND_PRESETS = Object.freeze({
  sword: { frequency: 220, duration: .07, type: 'sawtooth' },
  shield: { frequency: 74, duration: .12, type: 'square' },
  cannon: { frequency: 46, duration: .18, type: 'sawtooth' },
  hurt: { frequency: 130, duration: .05, type: 'square' },
  death: { frequency: 62, duration: .16, type: 'triangle' },
});
const COMBAT_WORLD_WIDTH = 390;
const COMBAT_WORLD_HEIGHT = 1000;
const DEFAULT_BATTLEFIELD_RECT = Object.freeze({ left: 0, top: 0, width: 390, height: 360 });

export function createFeedback(root, { reducedMotion = false } = {}) {
  const doc = root.ownerDocument ?? globalThis.document;
  const layer = root.querySelector('[data-feedback-layer]');
  const battlefield = root.querySelector('[data-battlefield]');
  let audioContext = null;
  let impactTimer = null;
  const motionReduced = () => (
    reducedMotion
    || root.classList.contains('reduced-motion')
    || (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  );

  function sound(preset) {
    const AudioContextConstructor = globalThis.window?.AudioContext
      || globalThis.window?.webkitAudioContext
      || globalThis.AudioContext;
    if (!preset || !AudioContextConstructor) return;
    audioContext ||= new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = preset.frequency;
    oscillator.type = preset.type;
    gain.gain.setValueAtTime(.07, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      .001,
      audioContext.currentTime + preset.duration,
    );
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + preset.duration);
  }

  function removeLater(node, time = 650) {
    const timer = setTimeout(() => node.remove(), time);
    timer.unref?.();
  }

  function relativeRect(element, fallback = DEFAULT_BATTLEFIELD_RECT) {
    const rect = element?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) return rect;
    return fallback;
  }

  function px(value) {
    return `${Math.round(value * 100) / 100}px`;
  }

  function effectPosition(event = {}) {
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

  function combatEffect(className, event = {}, lifetime = 650) {
    while (layer.childElementCount >= 32) layer.firstElementChild?.remove();
    const node = doc.createElement('i');
    node.className = `combat-effect ${className}${motionReduced() ? ' reduced' : ''}`;
    const position = effectPosition(event);
    node.style.setProperty('left', px(position.x));
    node.style.setProperty('top', px(position.y));
    layer.append(node);
    removeLater(node, motionReduced() ? Math.min(lifetime, 180) : lifetime);
    return node;
  }

  function normalHit(event = {}) {
    return combatEffect(`hit-spark attack-${event.role || 'bare'}`, event, 260);
  }

  function impactShake(duration = 150) {
    if (motionReduced()) return;
    if (impactTimer) clearTimeout(impactTimer);
    root.classList.remove('impact-shake');
    void root.offsetWidth;
    root.classList.add('impact-shake');
    impactTimer = setTimeout(() => {
      root.classList.remove('impact-shake');
      impactTimer = null;
    }, duration);
    impactTimer.unref?.();
  }

  function superLand() {
    const landingPosition = { x: 195, y: 360 };
    combatEffect('impact shockwave super-land', landingPosition, 650);
    for (let index = 0; index < 10; index += 1) {
      const particle = combatEffect('particle super-particle', landingPosition, 650);
      particle.style.setProperty('--x', `${(index - 5) * 14}px`);
      particle.style.setProperty('--y', `${-20 - (index % 3) * 18}px`);
    }
    if (!motionReduced()) {
      combatEffect('flash', {}, 300);
      impactShake(280);
    }
    sound({ frequency: 54, duration: .16, type: 'sawtooth' });
  }

  function playEvent(event = {}) {
    if (event.type === 'fighter-dash') {
      if (!motionReduced()) combatEffect('dash-trail', event, 320);
    } else if (event.type === 'fighter-attack' && event.role === 'sword') {
      combatEffect('sword-arc', event, 380);
      normalHit(event);
      sound(SOUND_PRESETS.sword);
    } else if (event.type === 'shield-bash') {
      combatEffect('shield-ring', event, 420);
      sound(SOUND_PRESETS.shield);
    } else if (event.type === 'shield-block') {
      combatEffect('block-flash', event, 300);
    } else if (event.type === 'projectile-fired') {
      if (!motionReduced()) combatEffect('cannon-projectile', event, 520);
    } else if (event.type === 'projectile-impact') {
      const fire = event.element === 'fire';
      combatEffect(`cannon-blast${fire ? ' fire-blast' : ''}`, event, fire ? 680 : 520);
      if (fire && !motionReduced()) combatEffect('fire-burst', event, 680);
      impactShake();
      sound(SOUND_PRESETS.cannon);
    } else if (event.type === 'fire-explosion') {
      if (!motionReduced()) combatEffect('fire-burst', event, 680);
    } else if (event.type === 'unit-hurt') {
      sound(SOUND_PRESETS.hurt);
    } else if (event.type === 'unit-death') {
      sound(SOUND_PRESETS.death);
    } else if (event.type === 'super-skill') {
      combatEffect('super-wave', event, 760);
      sound({ frequency: 72, duration: .16, type: 'triangle' });
    } else if (event.type === 'commander-telegraph') {
      combatEffect('boss-warning', event, 1100);
    } else if (event.type === 'commander-slam') {
      combatEffect('boss-slam', event, 620);
      impactShake(260);
      sound({ frequency: 48, duration: .18, type: 'square' });
    } else if (event.type === 'super-land') {
      superLand();
    } else if (event.type === 'fighter-attack') {
      normalHit(event);
    }
  }

  return {
    normalHit,
    superLand,
    playEvent,
    setReducedMotion: (next) => { reducedMotion = next; },
    playPickup: () => sound({ frequency: 880, duration: 0.04, type: 'square' }),
    playPlace: () => sound({ frequency: 220, duration: 0.08, type: 'sine' }),
    playClear: (lineCount = 1) => {
      const base = 560 + Math.min(lineCount - 1, 3) * 140;
      sound({ frequency: base, duration: 0.1, type: 'triangle' });
      setTimeout(() => sound({ frequency: base * 1.5, duration: 0.08, type: 'triangle' }), 70);
    },
    playInvalid: () => sound({ frequency: 140, duration: 0.12, type: 'sawtooth' }),
  };
}
