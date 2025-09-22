export const EVENT_EFFECTS = {
  flood: {
    regenAdd: 0.25,
    regenScale: null,
    drainAdd: 0,
    cell: {
      energyLoss: 0.3,
      resistanceGene: 'floodResist',
    },
  },
  drought: {
    regenAdd: 0,
    regenScale: { base: 1, change: -0.7, min: 0 },
    drainAdd: 0.1,
    cell: {
      energyLoss: 0.25,
      resistanceGene: 'droughtResist',
    },
  },
  heatwave: {
    regenAdd: 0,
    regenScale: { base: 1, change: -0.45, min: 0 },
    drainAdd: 0.08,
    cell: {
      energyLoss: 0.35,
      resistanceGene: 'heatResist',
    },
  },
  coldwave: {
    regenAdd: 0,
    regenScale: { base: 1, change: -0.25, min: 0 },
    drainAdd: 0,
    cell: {
      energyLoss: 0.2,
      resistanceGene: 'coldResist',
    },
  },
};

export const EVENT_TYPES = Object.freeze(Object.keys(EVENT_EFFECTS));

export function getEventEffect(eventType) {
  return EVENT_EFFECTS[eventType] || null;
}
