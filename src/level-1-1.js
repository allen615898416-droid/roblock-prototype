const units = (grunt = 0, runner = 0, options = {}) => ({
  grunt,
  runner,
  heavy: options.heavy ?? 0,
  fragment: options.fragment ?? 0,
  shooter: options.shooter ?? 0,
  elite: options.elite ?? {},
});
const wave = (at, composition) => ({ trigger: 'time', at, composition });

export const LEVEL_1_1 = Object.freeze({
  id: '1-1', name: '断裂街口', wallHp: 1000,
  segments: [
    { id: 'S1', duration: 24, inventory: 16, supply: {}, waves: [wave(0, units(2, 1)), wave(12, units(3, 1)), wave(22, units(2, 0, { heavy: 1 }))] },
    { id: 'S2', duration: 24, inventory: 16, supply: {}, waves: [wave(0, units(3, 1)), wave(11, units(3, 1, { fragment: 2 })), wave(21, units(3, 1, { heavy: 1 }))] },
    { id: 'S3', duration: 26, inventory: 20, supply: { teachingSuper: true, candidates: [{ templateId: 'O' }, { templateId: 'O' }, { templateId: 'O' }, { templateId: 'O' }] }, waves: [wave(0, units(4, 1)), wave(12, units(3, 2, { fragment: 3 })), wave(24, units(4, 1, { elite: { runner: 1 } }))] },
    { id: 'S4', duration: 28, inventory: 24, supply: {}, waves: [wave(0, units(4, 2)), wave(13, units(3, 2, { shooter: 1 })), wave(25, units(4, 2, { heavy: 1 }))] },
    { id: 'S5', duration: 30, inventory: 24, supply: {}, waves: [wave(0, units(5, 2)), wave(14, units(4, 2, { fragment: 4 })), wave(27, units(4, 2, { heavy: 1, elite: { grunt: 1 } }))] },
    { id: 'S6', duration: 34, inventory: 24, supply: {}, commander: { type: 'commander', name: '断裂街口指挥体', at: 22, telegraphSeconds: 1.5 }, waves: [
      wave(0, units(5, 2, { heavy: 1 })), wave(16, units(4, 2, { shooter: 1 })), { trigger: 'time', at: 22, composition: { commander: 1 } }, { trigger: 'boss-hp', at: 0.65, composition: units(4, 2, { fragment: 3 }) }, { trigger: 'boss-hp', at: 0.3, composition: units(5, 2, { heavy: 1 }) },
    ] },
  ],
});
