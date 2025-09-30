import { clamp, cloneTracePayload } from './utils.js';

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
  'interactionMomentum',
  'eventPressure',
  'partnerEnergy',
  'partnerAgeFraction',
  'partnerSimilarity',
  'baseReproductionProbability',
  'riskTolerance',
  'selfSenescence',
  'partnerSenescence',
  'resourceTrend',
  'targetWeakness',
  'targetThreat',
  'targetProximity',
  'targetAttrition',
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
  targeting: createOutputGroup([
    [216, 'focusWeak', 'Focus on weaker enemies'],
    [217, 'focusStrong', 'Challenge strong enemies'],
    [218, 'focusProximity', 'Prioritize nearby enemies'],
    [219, 'focusAttrition', 'Exploit attrition'],
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

const mix = (a, b, t) => a + (b - a) * clamp(Number.isFinite(t) ? t : 0, 0, 1);

const clampSensorValue = (value) => {
  if (!Number.isFinite(value)) return 0;

  return clamp(value, -1, 1);
};

/**
 * Neural controller constructed from DNA-provided genes. Each Brain maintains
 * sensor modulation targets, neuron connections, and activation histories. It
 * evaluates sensors every tick to emit intents for movement, interaction,
 * reproduction, and targeting behaviours.
 */
export default class Brain {
  static SENSOR_COUNT = SENSOR_COUNT;

  static sensorIndex(key) {
    if (typeof key !== 'string') return undefined;

    return SENSOR_LOOKUP.get(key);
  }

  static fromDNA(dna) {
    if (!dna || typeof dna.neuralGenes !== 'function') return null;

    const genes = dna.neuralGenes();

    if (!Array.isArray(genes) || genes.length === 0) return null;

    const sensorModulation =
      typeof dna.neuralSensorModulation === 'function' ? dna.neuralSensorModulation() : null;

    const brain = new Brain({ genes, sensorModulation });

    if (typeof dna.updateBrainMetrics === 'function') {
      dna.updateBrainMetrics({
        neuronCount: brain.neuronCount,
        connectionCount: brain.connectionCount,
      });
    }

    return brain;
  }

  constructor({ genes = [], sensorModulation = null } = {}) {
    this.connections = [];
    this.activationMap = new Map();
    this.incoming = new Map();
    this.neuronSet = new Set();
    this.lastSensors = null;
    this.lastOutputs = new Map();
    this.lastActivationCount = 0;
    this.lastEvaluation = null;
    this.sensorBaselines = null;
    this.sensorGains = null;
    this.sensorTargets = null;
    this.sensorGainLimits = { min: 0.5, max: 1.8 };
    this.sensorAdaptationRate = 0;
    this.sensorReversionRate = 0;

    if (sensorModulation) {
      this.#initializeSensorModulation(sensorModulation);
    }

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

    if (this.connections.length > 0) {
      this.#pruneUnreachableNeurons();
    }
  }

  get neuronCount() {
    return this.neuronSet.size;
  }

  get connectionCount() {
    return this.connections.length;
  }

  evaluateGroup(groupName, sensorObject = {}, options = {}) {
    const traceEnabled = Boolean(options?.trace);
    const group = OUTPUT_GROUPS[groupName];

    if (!group || group.length === 0) {
      const emptyEvaluation = {
        values: null,
        activationCount: 0,
        sensors: new Array(SENSOR_COUNT).fill(0),
      };

      if (traceEnabled) {
        emptyEvaluation.trace = { sensors: [], nodes: [] };
      }

      this.lastEvaluation = {
        group: groupName,
        sensors: emptyEvaluation.sensors,
        activationCount: 0,
        outputs: null,
        trace: traceEnabled ? emptyEvaluation.trace : null,
      };
      this.lastActivationCount = 0;

      return emptyEvaluation;
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

    this.#applySensorModulation(sensors);

    const sensorVector = sensors.slice();

    this.lastSensors = sensorVector;
    const cache = new Map();
    const visiting = new Set();
    let activationCount = 0;
    const traceEntries = traceEnabled ? [] : null;
    const traceCache = traceEnabled ? new Map() : null;
    const sensorTrace = traceEnabled
      ? SENSOR_KEYS.map((key, index) => ({
          id: index,
          key,
          value: sensorVector[index] ?? 0,
        }))
      : null;

    const computeNode = (nodeId) => {
      if (this.#isSensor(nodeId)) {
        const index = nodeId < sensors.length ? nodeId : 0;

        const sensorValue = sensors[index] ?? 0;

        if (traceEnabled && !traceCache.has(nodeId)) {
          traceCache.set(nodeId, {
            id: nodeId,
            type: 'sensor',
            key: SENSOR_KEYS[nodeId] ?? `sensor_${nodeId}`,
            value: sensorValue,
          });
        }

        return sensorValue;
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
      let nodeInputs = null;

      if (traceEnabled) {
        nodeInputs = [];
      }

      for (let i = 0; i < incoming.length; i++) {
        const { source, weight } = incoming[i];
        const sourceValue = computeNode(source);

        sum += weight * sourceValue;

        if (traceEnabled) {
          nodeInputs.push({
            source,
            weight,
            value: sourceValue,
          });
        }
      }

      visiting.delete(nodeId);
      activationCount++;
      const activationType = this.activationMap.get(nodeId) ?? DEFAULT_ACTIVATION;
      const activationInfo =
        ACTIVATION_FUNCS[activationType] || ACTIVATION_FUNCS[DEFAULT_ACTIVATION];
      const output = activationInfo.fn(sum);

      cache.set(nodeId, output);

      if (traceEnabled) {
        const traceEntry = {
          id: nodeId,
          type: 'neuron',
          activationType,
          activationName: activationInfo.name,
          sum,
          output,
          inputs: nodeInputs,
        };

        traceEntries.push(traceEntry);
        traceCache.set(nodeId, traceEntry);
      }

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

    const result = {
      values: activationCount > 0 ? values : null,
      activationCount,
      sensors: sensorVector,
    };

    let tracePayload = null;

    if (traceEnabled) {
      tracePayload = {
        sensors: sensorTrace ? sensorTrace.map((entry) => ({ ...entry })) : [],
        nodes: traceEntries
          ? traceEntries.map((entry) => ({
              ...entry,
              inputs: Array.isArray(entry.inputs)
                ? entry.inputs.map((input) => ({ ...input }))
                : [],
            }))
          : [],
      };

      result.trace = tracePayload;
    }

    if (activationCount > 0) {
      for (let i = 0; i < pendingOutputs.length; i++) {
        const [key, value] = pendingOutputs[i];

        this.lastOutputs.set(key, value);
      }
    }

    this.lastActivationCount = activationCount;
    this.lastEvaluation = {
      group: groupName,
      sensors: sensorVector.slice(),
      activationCount,
      outputs: activationCount > 0 ? { ...values } : null,
      trace: traceEnabled && tracePayload ? cloneTracePayload(tracePayload) : null,
    };

    return result;
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
      lastActivationCount: this.lastActivationCount,
      lastEvaluation: this.lastEvaluation
        ? {
            group: this.lastEvaluation.group,
            activationCount: this.lastEvaluation.activationCount,
            sensors: this.lastEvaluation.sensors ? [...this.lastEvaluation.sensors] : null,
            outputs: this.lastEvaluation.outputs ? { ...this.lastEvaluation.outputs } : null,
            trace: cloneTracePayload(this.lastEvaluation.trace),
          }
        : null,
      sensorGains: this.sensorGains ? Array.from(this.sensorGains) : null,
      sensorTargets: this.sensorTargets ? Array.from(this.sensorTargets) : null,
      sensorGainLimits: this.sensorGainLimits
        ? { ...this.sensorGainLimits }
        : { min: 0.5, max: 1.8 },
      sensorAdaptationRate: this.sensorAdaptationRate,
      sensorReversionRate: this.sensorReversionRate,
    };
  }

  #isSensor(nodeId) {
    return Number.isFinite(nodeId) && nodeId >= 0 && nodeId < SENSOR_COUNT;
  }

  #initializeSensorModulation({
    baselineGains,
    targets,
    adaptationRate,
    reversionRate,
    gainLimits,
  } = {}) {
    const minLimit = Number.isFinite(gainLimits?.min) ? Math.max(0.05, gainLimits.min) : 0.5;
    const maxLimit = Number.isFinite(gainLimits?.max)
      ? Math.max(minLimit + 0.05, gainLimits.max)
      : 1.8;

    this.sensorGainLimits = { min: minLimit, max: Math.max(minLimit + 0.05, maxLimit) };
    this.sensorBaselines = this.#initSensorArray(baselineGains, 1, this.sensorGainLimits);
    this.sensorGains = new Float32Array(this.sensorBaselines);
    this.sensorTargets = this.#initSensorArray(targets, Number.NaN);
    this.sensorAdaptationRate = clamp(Number.isFinite(adaptationRate) ? adaptationRate : 0, 0, 0.6);

    const suggestedReversion = Number.isFinite(reversionRate)
      ? reversionRate
      : this.sensorAdaptationRate * 0.5;

    this.sensorReversionRate = clamp(suggestedReversion, 0, 1);

    this.#enforceGainBounds();
  }

  #initSensorArray(source, defaultValue, bounds = null) {
    const array = new Float32Array(SENSOR_COUNT);

    for (let i = 0; i < SENSOR_COUNT; i++) {
      let value = defaultValue;

      if (source && i < source.length) {
        const candidate = source[i];

        if (Number.isFinite(candidate) || Number.isNaN(candidate)) {
          value = candidate;
        }
      }

      if (bounds && Number.isFinite(value)) {
        const min = Number.isFinite(bounds.min) ? bounds.min : undefined;
        const max = Number.isFinite(bounds.max) ? bounds.max : undefined;

        if (min !== undefined) value = Math.max(value, min);
        if (max !== undefined) value = Math.min(value, max);
      }

      array[i] = value;
    }

    if (array.length > 0 && Number.isFinite(defaultValue)) {
      array[0] = defaultValue;
    }

    return array;
  }

  #enforceGainBounds() {
    if (!this.sensorGains || !this.sensorBaselines) return;

    const min = this.sensorGainLimits.min;
    const max = this.sensorGainLimits.max;

    for (let i = 0; i < this.sensorGains.length; i++) {
      const baseline = Number.isFinite(this.sensorBaselines[i])
        ? clamp(this.sensorBaselines[i], min, max)
        : clamp(1, min, max);

      this.sensorBaselines[i] = baseline;
      this.sensorGains[i] = clamp(
        Number.isFinite(this.sensorGains[i]) ? this.sensorGains[i] : baseline,
        min,
        max
      );
    }

    if (this.sensorGains.length > 0) {
      this.sensorGains[0] = 1;
      this.sensorBaselines[0] = 1;
    }

    if (
      this.sensorTargets &&
      this.sensorTargets.length > 0 &&
      !Number.isFinite(this.sensorTargets[0])
    ) {
      this.sensorTargets[0] = 1;
    }
  }

  #applySensorModulation(sensors) {
    if (!Array.isArray(sensors) && !(sensors instanceof Float32Array)) return;
    if (!this.sensorGains || !this.sensorBaselines) return;

    const min = this.sensorGainLimits.min;
    const max = this.sensorGainLimits.max;

    for (let i = 1; i < sensors.length && i < this.sensorGains.length; i++) {
      const rawValue = clampSensorValue(sensors[i]);
      let gain = this.sensorGains[i];

      if (!Number.isFinite(gain)) gain = this.sensorBaselines[i];

      const target =
        this.sensorTargets && i < this.sensorTargets.length ? this.sensorTargets[i] : Number.NaN;

      if (
        Number.isFinite(this.sensorAdaptationRate) &&
        this.sensorAdaptationRate > 0 &&
        Number.isFinite(target)
      ) {
        const diff = clamp(rawValue - target, -1, 1);

        gain += diff * this.sensorAdaptationRate;
      }

      if (this.sensorReversionRate > 0) {
        const base = this.sensorBaselines[i];

        if (Number.isFinite(base)) {
          gain = mix(gain, base, this.sensorReversionRate);
        }
      }

      gain = clamp(Number.isFinite(gain) ? gain : this.sensorBaselines[i], min, max);
      this.sensorGains[i] = gain;
      sensors[i] = clampSensorValue(rawValue * gain);
    }

    if (sensors.length > 0) sensors[0] = 1;
  }

  #pruneUnreachableNeurons() {
    const outputs = [];

    for (const group of Object.values(OUTPUT_GROUPS)) {
      if (!Array.isArray(group)) continue;

      for (let i = 0; i < group.length; i++) {
        const id = group[i]?.id;

        if (!Number.isFinite(id)) continue;
        if (!this.incoming.has(id)) continue;

        outputs.push(id);
      }
    }

    if (outputs.length === 0) {
      this.neuronSet = new Set();
      this.incoming.clear();
      this.connections = [];
      this.activationMap.clear();

      return;
    }

    const reachable = new Set();
    const stack = outputs.slice();

    while (stack.length > 0) {
      const node = stack.pop();

      if (!this.#isSensor(node)) {
        if (reachable.has(node)) {
          // continue traversing even if already marked to ensure upstream search
        } else {
          reachable.add(node);
        }
      }

      const incoming = this.incoming.get(node);

      if (!incoming) continue;

      for (let i = 0; i < incoming.length; i++) {
        const { source } = incoming[i];

        if (!Number.isFinite(source) || this.#isSensor(source)) continue;
        if (reachable.has(source)) continue;

        stack.push(source);
        reachable.add(source);
      }
    }

    this.neuronSet = new Set(reachable);

    const filteredIncoming = new Map();

    for (const [target, sources] of this.incoming.entries()) {
      if (!reachable.has(target)) continue;

      const filteredSources = sources.filter(
        ({ source }) => this.#isSensor(source) || reachable.has(source)
      );

      if (filteredSources.length > 0) {
        filteredIncoming.set(target, filteredSources);
      }
    }

    this.incoming = filteredIncoming;
    this.connections = this.connections.filter(
      ({ source, target }) =>
        reachable.has(target) && (this.#isSensor(source) || reachable.has(source))
    );

    for (const key of Array.from(this.activationMap.keys())) {
      if (!reachable.has(key)) this.activationMap.delete(key);
    }
  }
}
