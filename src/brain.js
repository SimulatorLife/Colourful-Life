import { clamp } from './utils.js';

export const NEURAL_GENE_BYTES = 4;

export const SENSOR_KEYS = Object.freeze([
  'bias',
  'energy',
  'effectiveDensity',
  'allyFraction',
  'enemyFraction',
  'mateFraction',
  'allySimilarity',
  'enemySimilarity',
  'mateSimilarity',
  'ageFraction',
  'eventPressure',
  'partnerEnergy',
  'partnerAgeFraction',
  'partnerSimilarity',
  'baseReproductionProbability',
  'riskTolerance',
  'selfSenescence',
  'partnerSenescence',
]);

const SENSOR_LOOKUP = new Map(SENSOR_KEYS.map((key, index) => [key, index]));
const SENSOR_COUNT = SENSOR_KEYS.length;

const createOutputGroup = (entries) => entries.map(([id, key, label]) => ({ id, key, label }));

export const OUTPUT_GROUPS = Object.freeze({
  movement: createOutputGroup([
    [192, 'rest', 'Rest / wait'],
    [193, 'pursue', 'Pursue target'],
    [194, 'avoid', 'Retreat from threat'],
    [195, 'cohere', 'Cohere with allies'],
    [196, 'explore', 'Explore / forage'],
  ]),
  interaction: createOutputGroup([
    [200, 'avoid', 'Avoid contact'],
    [201, 'fight', 'Engage in combat'],
    [202, 'cooperate', 'Cooperate / share'],
  ]),
  reproduction: createOutputGroup([
    [208, 'decline', 'Decline mating'],
    [209, 'accept', 'Accept mating'],
  ]),
});

const ACTIVATION_FUNCS = {
  0: { name: 'identity', fn: (x) => x },
  1: {
    name: 'sigmoid',
    fn: (x) => 1 / (1 + Math.exp(-clamp(x, -20, 20))),
  },
  2: { name: 'tanh', fn: (x) => Math.tanh(clamp(x, -8, 8)) },
  3: { name: 'relu', fn: (x) => (x > 0 ? x : 0) },
  4: { name: 'step', fn: (x) => (x >= 0 ? 1 : 0) },
  5: { name: 'sin', fn: (x) => Math.sin(x) },
  6: { name: 'gaussian', fn: (x) => Math.exp(-x * x) },
  7: { name: 'abs', fn: (x) => Math.abs(x) },
};

const DEFAULT_ACTIVATION = 2; // tanh

const clampSensorValue = (value) => {
  if (!Number.isFinite(value)) return 0;

  return clamp(value, -1, 1);
};

export default class Brain {
  static SENSOR_COUNT = SENSOR_COUNT;

  static fromDNA(dna) {
    if (!dna || typeof dna.neuralGenes !== 'function') return null;

    const genes = dna.neuralGenes();

    if (!Array.isArray(genes) || genes.length === 0) return null;

    return new Brain({ genes });
  }

  constructor({ genes = [] } = {}) {
    this.connections = [];
    this.activationMap = new Map();
    this.incoming = new Map();
    this.neuronSet = new Set();
    this.lastSensors = null;
    this.lastOutputs = new Map();
    this.lastActivationCount = 0;

    for (let i = 0; i < genes.length; i++) {
      const gene = genes[i];

      if (!gene || gene.enabled === false) continue;
      const source = Number(gene.sourceId);
      const target = Number(gene.targetId);

      if (!Number.isFinite(source) || !Number.isFinite(target)) continue;

      const weight = Number.isFinite(gene.weight) ? gene.weight : 0;
      const activationType = Number.isFinite(gene.activationType)
        ? gene.activationType
        : DEFAULT_ACTIVATION;

      this.connections.push({ source, target, weight, activationType });
      if (!this.incoming.has(target)) this.incoming.set(target, []);
      this.incoming.get(target).push({ source, weight });

      if (!this.activationMap.has(target)) {
        this.activationMap.set(target, activationType);
      }

      if (!this.#isSensor(source)) this.neuronSet.add(source);
      if (!this.#isSensor(target)) this.neuronSet.add(target);
    }
  }

  get neuronCount() {
    return this.neuronSet.size;
  }

  get connectionCount() {
    return this.connections.length;
  }

  evaluateGroup(groupName, sensorObject = {}) {
    const group = OUTPUT_GROUPS[groupName];

    if (!group || group.length === 0) {
      return { values: null, activationCount: 0 };
    }

    const sensors = new Array(SENSOR_COUNT).fill(0);

    sensors[0] = 1; // bias constant

    if (sensorObject && typeof sensorObject === 'object') {
      for (const [key, value] of Object.entries(sensorObject)) {
        const idx = SENSOR_LOOKUP.get(key);

        if (idx === undefined) continue;
        sensors[idx] = clampSensorValue(value);
      }
    }

    this.lastSensors = sensors.slice();
    const cache = new Map();
    const visiting = new Set();
    let activationCount = 0;

    const computeNode = (nodeId) => {
      if (this.#isSensor(nodeId)) {
        const index = nodeId < sensors.length ? nodeId : 0;

        return sensors[index] ?? 0;
      }

      if (cache.has(nodeId)) return cache.get(nodeId);

      if (visiting.has(nodeId)) {
        cache.set(nodeId, 0);

        return 0;
      }

      visiting.add(nodeId);
      const incoming = this.incoming.get(nodeId);

      if (!incoming || incoming.length === 0) {
        visiting.delete(nodeId);
        cache.set(nodeId, 0);

        return 0;
      }

      let sum = 0;

      for (let i = 0; i < incoming.length; i++) {
        const { source, weight } = incoming[i];
        const sourceValue = computeNode(source);

        sum += weight * sourceValue;
      }

      visiting.delete(nodeId);
      activationCount++;
      const activationType = this.activationMap.get(nodeId) ?? DEFAULT_ACTIVATION;
      const { fn } = ACTIVATION_FUNCS[activationType] || ACTIVATION_FUNCS[DEFAULT_ACTIVATION];
      const output = fn(sum);

      cache.set(nodeId, output);

      return output;
    };

    const values = {};
    const pendingOutputs = [];

    for (let i = 0; i < group.length; i++) {
      const { id, key } = group[i];
      const value = computeNode(id);

      values[key] = value;
      pendingOutputs.push([key, value]);
    }

    if (activationCount === 0) {
      this.lastActivationCount = 0;

      return { values: null, activationCount: 0 };
    }

    for (let i = 0; i < pendingOutputs.length; i++) {
      const [key, value] = pendingOutputs[i];

      this.lastOutputs.set(key, value);
    }

    this.lastActivationCount = activationCount;

    return { values, activationCount };
  }

  snapshot() {
    return {
      neuronCount: this.neuronCount,
      connectionCount: this.connectionCount,
      connections: this.connections.map(({ source, target, weight, activationType }) => ({
        source,
        target,
        weight,
        activationType,
      })),
      activationByNode: Array.from(this.activationMap.entries()).map(([node, type]) => ({
        node,
        activationType: type,
        activationName: (ACTIVATION_FUNCS[type] || ACTIVATION_FUNCS[DEFAULT_ACTIVATION]).name,
      })),
      sensors: this.lastSensors ? [...this.lastSensors] : null,
      lastOutputs: Object.fromEntries(this.lastOutputs.entries()),
    };
  }

  #isSensor(nodeId) {
    return Number.isFinite(nodeId) && nodeId >= 0 && nodeId < SENSOR_COUNT;
  }
}
