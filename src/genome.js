import { clamp, createRNG, randomRange } from './utils.js';
import Brain, { NEURAL_GENE_BYTES } from './brain.js';

/**
 * Gene loci mapping. The first three indices are reserved for RGB rendering,
 * while the remaining loci control simulation traits. Values are stored as
 * bytes (0-255) so they can be mapped into useful ranges per accessor.
 */
export const GENE_LOCI = Object.freeze({
  COLOR_R: 0,
  COLOR_G: 1,
  COLOR_B: 2,
  RISK: 3,
  EXPLORATION: 4,
  COHESION: 5,
  RECOVERY: 6,
  ACTIVITY: 7,
  PARENTAL: 8,
  SENESCENCE: 9,
  COMBAT: 10,
  ALLY: 11,
  ENEMY: 12,
  FERTILITY: 13,
  ENERGY_EFFICIENCY: 14,
  ENERGY_CAPACITY: 15,
  MUTATION_RATE: 16,
  MUTATION_RANGE: 17,
  NEURAL: 18,
  SENSE: 19,
  FORAGING: 20,
  MOVEMENT: 21,
  STRATEGY: 22,
  RESIST_FLOOD: 23,
  RESIST_HEAT: 24,
  RESIST_DROUGHT: 25,
  RESIST_COLD: 26,
  DENSITY: 27,
  COOPERATION: 28,
});

const BASE_GENE_COUNT = Math.max(...Object.values(GENE_LOCI)) + 1;
const DEFAULT_NEURAL_CONNECTIONS = 16;
const DEFAULT_TOTAL_GENE_COUNT = BASE_GENE_COUNT + DEFAULT_NEURAL_CONNECTIONS * NEURAL_GENE_BYTES;

const clampGene = (value) => {
  if (Number.isNaN(value)) return 0;

  return Math.max(0, Math.min(255, value | 0));
};

export class DNA {
  constructor(rOrGenes = 0, g = 0, b = 0, options = {}) {
    let geneCount = options.geneCount ?? DEFAULT_TOTAL_GENE_COUNT;
    let genesInput = null;

    if (Array.isArray(rOrGenes) || rOrGenes instanceof Uint8Array) {
      genesInput = rOrGenes;
    } else if (
      typeof rOrGenes === 'object' &&
      rOrGenes !== null &&
      !(rOrGenes instanceof Uint8Array)
    ) {
      const config = rOrGenes;

      geneCount = config.geneCount ?? geneCount;
      genesInput = config.genes ?? genesInput;
    }

    this.genes = new Uint8Array(geneCount);
    this._brainMetrics = null;

    if (genesInput) {
      const limit = Math.min(genesInput.length ?? 0, geneCount);

      for (let i = 0; i < limit; i++) {
        this.genes[i] = clampGene(genesInput[i]);
      }
    } else {
      this.genes[GENE_LOCI.COLOR_R] = clampGene(rOrGenes);
      this.genes[GENE_LOCI.COLOR_G] = clampGene(g);
      this.genes[GENE_LOCI.COLOR_B] = clampGene(b);
    }
  }

  static random(rng = Math.random, geneCount = DEFAULT_TOTAL_GENE_COUNT) {
    const genes = new Uint8Array(geneCount);

    for (let i = 0; i < geneCount; i++) {
      genes[i] = Math.floor(rng() * 256) & 0xff;
    }

    return new DNA({ genes, geneCount });
  }

  get length() {
    return this.genes.length;
  }

  get r() {
    return this.geneAt(GENE_LOCI.COLOR_R);
  }

  set r(value) {
    this.genes[GENE_LOCI.COLOR_R] = clampGene(value);
  }

  get g() {
    return this.geneAt(GENE_LOCI.COLOR_G);
  }

  set g(value) {
    this.genes[GENE_LOCI.COLOR_G] = clampGene(value);
  }

  get b() {
    return this.geneAt(GENE_LOCI.COLOR_B);
  }

  set b(value) {
    this.genes[GENE_LOCI.COLOR_B] = clampGene(value);
  }

  geneAt(index) {
    return index >= 0 && index < this.genes.length ? this.genes[index] : 0;
  }

  geneFraction(index) {
    return this.geneAt(index) / 255;
  }

  toColor() {
    return `rgb(${this.r},${this.g},${this.b})`;
  }

  seed() {
    let hash = 2166136261;

    for (let i = 0; i < this.genes.length; i++) {
      hash ^= this.genes[i];
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  }

  prng() {
    return createRNG(this.seed());
  }

  // Deterministic per-trait RNG stream derived from DNA seed
  prngFor(tag) {
    let h = (this.seed() ^ 2166136261) >>> 0; // FNV-1a like mix

    for (let i = 0; i < tag.length; i++) {
      h ^= tag.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }

    return createRNG(h >>> 0);
  }

  isLegacyGenome() {
    const extraBytes = this.genes.length - BASE_GENE_COUNT;

    return extraBytes < NEURAL_GENE_BYTES;
  }

  hasNeuralGenes() {
    return !this.isLegacyGenome() && this.neuralGeneCount() > 0;
  }

  neuralGeneCount() {
    const extraBytes = this.genes.length - BASE_GENE_COUNT;

    if (extraBytes < NEURAL_GENE_BYTES) return 0;

    return Math.floor(extraBytes / NEURAL_GENE_BYTES);
  }

  #decodeNeuralGene(index) {
    const start = BASE_GENE_COUNT + index * NEURAL_GENE_BYTES;

    if (start < BASE_GENE_COUNT || start + NEURAL_GENE_BYTES > this.genes.length) {
      return null;
    }

    const b0 = this.genes[start];
    const b1 = this.genes[start + 1];
    const b2 = this.genes[start + 2];
    const b3 = this.genes[start + 3];
    const gene = (((b0 << 24) >>> 0) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
    const sourceId = (gene >>> 24) & 0xff;
    const targetId = (gene >>> 16) & 0xff;
    const weightRaw = (gene >>> 4) & 0xfff; // 12 bits
    const activationType = (gene >>> 1) & 0x7;
    const enabled = (gene & 0x1) === 1;
    const weight = clamp(weightRaw / 2047.5 - 1, -1, 1);

    return {
      index,
      raw: gene,
      sourceId,
      targetId,
      weight,
      activationType,
      enabled,
    };
  }

  neuralGenes() {
    if (!this.hasNeuralGenes()) return [];

    const count = this.neuralGeneCount();
    const genes = [];

    for (let i = 0; i < count; i++) {
      const gene = this.#decodeNeuralGene(i);

      if (gene) genes.push(gene);
    }

    return genes;
  }

  updateBrainMetrics({ neuronCount, connectionCount } = {}) {
    if (!this.hasNeuralGenes()) {
      this._brainMetrics = null;

      return;
    }

    const normalizedNeurons = Number.isFinite(neuronCount)
      ? Math.max(0, Math.round(neuronCount))
      : null;
    const normalizedConnections = Number.isFinite(connectionCount)
      ? Math.max(0, Math.round(connectionCount))
      : null;

    if (!this._brainMetrics) {
      this._brainMetrics = {
        neuronCount: normalizedNeurons ?? 0,
        connectionCount: normalizedConnections ?? 0,
      };

      return;
    }

    if (normalizedNeurons !== null) {
      this._brainMetrics.neuronCount = normalizedNeurons;
    }

    if (normalizedConnections !== null) {
      this._brainMetrics.connectionCount = normalizedConnections;
    }
  }

  getBrainMetrics() {
    if (!this._brainMetrics) return null;

    return { ...this._brainMetrics };
  }

  // Expand genome to a 6x5 weight matrix in [-1,1]
  weights() {
    const rnd = this.prngFor('weights');
    const rows = [];

    for (let a = 0; a < 6; a++) {
      const row = [];

      for (let i = 0; i < 5; i++) row.push(rnd() * 2 - 1);
      rows.push(row);
    }

    return rows;
  }

  movementGenes() {
    const rnd = this.prngFor('movementGenes');

    return { wandering: rnd(), pursuit: rnd(), cautious: rnd() };
  }

  interactionGenes() {
    const rnd = this.prngFor('interactionGenes');

    return { avoid: rnd(), fight: rnd(), cooperate: rnd() };
  }

  // Willingness to take risks (0..1). Higher -> more likely to pick fights.
  riskTolerance() {
    return this.geneFraction(GENE_LOCI.RISK);
  }

  // Preference to exploit known good tiles vs explore (0..1)
  exploitationBias() {
    return this.geneFraction(GENE_LOCI.EXPLORATION);
  }

  // Tendency to stay near allies (0..1)
  cohesion() {
    return this.geneFraction(GENE_LOCI.COHESION);
  }

  // Event recovery mitigation (0..1). Higher reduces event damage.
  recoveryRate() {
    return this.geneFraction(GENE_LOCI.RECOVERY);
  }

  // DNA-driven activity rate: how often a cell attempts actions per tick
  activityRate() {
    return 0.3 + 0.7 * this.geneFraction(GENE_LOCI.ACTIVITY);
  }

  // Fraction of current energy invested in offspring
  parentalInvestmentFrac() {
    return 0.2 + 0.5 * this.geneFraction(GENE_LOCI.PARENTAL);
  }

  // How strongly aging increases maintenance costs and reduces fertility
  senescenceRate() {
    return 0.1 + 0.4 * (1 - this.geneFraction(GENE_LOCI.SENESCENCE));
  }

  // Combat effectiveness multiplier
  combatPower() {
    return 0.8 + 0.9 * this.geneFraction(GENE_LOCI.COMBAT);
  }

  // DNA-derived social thresholds
  allyThreshold() {
    return 0.5 + 0.4 * this.geneFraction(GENE_LOCI.ALLY);
  }
  enemyThreshold() {
    return 0.6 - 0.4 * this.geneFraction(GENE_LOCI.ENEMY);
  }

  reproductionProb() {
    const rnd = this.prngFor('reproductionProb');
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const boldness = clamp(0.5 * risk + 0.5 * fertility, 0, 1);
    const synergy = clamp(
      0.35 * cooperation + 0.35 * efficiency + 0.3 * (1 - Math.abs(risk - fertility)),
      0,
      1
    );
    const base = 0.18 + 0.6 * boldness; // 0.18..0.78
    const synergyAdj = 0.75 + 0.35 * synergy; // 0.75..1.10
    const noise = 0.9 + rnd() * 0.2; // 0.9..1.1

    return Math.min(0.9, Math.max(0.05, base * synergyAdj * noise));
  }

  // Target mate similarity and tolerance derived from genome
  mateSimilarityPreference() {
    const rnd = this.prngFor('mateSimilarityPreference');
    const kinPull = this.b / 255; // blue pushes toward kin recognition
    const noveltyPush = this.r / 255; // red rewards novelty and dispersal
    const balance = this.g / 255; // green stabilizes the response

    const baseTarget = 0.5 + 0.35 * (kinPull - noveltyPush) + 0.15 * (balance - 0.5);
    const jitter = (rnd() - 0.5) * 0.2; // ±0.1 jitter keeps populations diverse
    const target = clamp(baseTarget + jitter, 0.05, 0.95);

    const toleranceNoise = (rnd() - 0.5) * 0.1;
    const tolerance = clamp(0.15 + 0.35 * (1 - balance) + toleranceNoise, 0.05, 0.6);
    const kinBiasNoise = (rnd() - 0.5) * 0.1;
    const kinBias = clamp(0.3 + 0.4 * kinPull - 0.2 * noveltyPush + kinBiasNoise, 0, 1);

    return { target, tolerance, kinBias };
  }

  initialEnergy(maxEnergy = 5) {
    const capacity = this.geneFraction(GENE_LOCI.ENERGY_CAPACITY);
    const value = 0.5 + capacity * (maxEnergy - 0.5);

    return Math.max(0.5, Math.min(maxEnergy, value));
  }

  lifespan(maxAge = 1000, minAge = 100) {
    const rnd = this.prngFor('lifespan');
    const longevity = this.geneFraction(GENE_LOCI.SENESCENCE);
    const resilience = this.geneFraction(GENE_LOCI.RESIST_COLD);
    const base = 0.45 + 0.55 * ((longevity + resilience) / 2); // 0.45..1.0
    const lifespanAdj = this.lifespanAdj();
    const v = Math.round(maxAge * (base * (0.95 + rnd() * 0.1))) + lifespanAdj;

    return Math.max(minAge, v);
  }

  floodResist() {
    return this.geneFraction(GENE_LOCI.RESIST_FLOOD);
  }
  heatResist() {
    return this.geneFraction(GENE_LOCI.RESIST_HEAT);
  }
  droughtResist() {
    return this.geneFraction(GENE_LOCI.RESIST_DROUGHT);
  }
  coldResist() {
    return this.geneFraction(GENE_LOCI.RESIST_COLD);
  }

  // Probability (0..1) to blend alleles during crossover instead of inheriting a pure channel
  crossoverMix() {
    const rnd = this.prngFor('crossoverMix');
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const cohesion = this.geneFraction(GENE_LOCI.COHESION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const base = 0.25 + 0.45 * cooperation;
    const temperament = 0.2 * (cohesion - risk);
    const jitter = (rnd() - 0.5) * 0.2; // deterministic per-genome variance

    return clamp(base + temperament + jitter, 0, 1);
  }

  mutationChance() {
    const rnd = this.prngFor('mutationChance');
    const rate = this.geneFraction(GENE_LOCI.MUTATION_RATE);
    const base = 0.04 + rate * 0.22;
    const jitter = (rnd() - 0.5) * 0.05;

    return clamp(base + jitter, 0.02, 0.3);
  }

  mutationRange() {
    const rnd = this.prngFor('mutationRange');
    const span = this.geneFraction(GENE_LOCI.MUTATION_RANGE);

    return 4 + Math.floor(span * 24 + rnd() * 4); // ~4..32
  }

  starvationThresholdFrac() {
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const base = 0.48 - 0.14 * efficiency - 0.08 * cooperation + 0.08 * risk;

    return clamp(base, 0.25, 0.85);
  }

  neurons() {
    if (this.hasNeuralGenes()) {
      const tracked = this._brainMetrics;

      if (tracked && Number.isFinite(tracked.neuronCount) && tracked.neuronCount > 0) {
        return Math.max(1, tracked.neuronCount);
      }

      const sensorLimit = Brain?.SENSOR_COUNT ?? 0;
      const nodes = new Set();
      const genes = this.neuralGenes();

      for (let i = 0; i < genes.length; i++) {
        const gene = genes[i];

        if (!gene || gene.enabled === false) continue;

        if (Number.isFinite(gene.sourceId) && gene.sourceId >= sensorLimit) {
          nodes.add(gene.sourceId);
        }
        if (Number.isFinite(gene.targetId) && gene.targetId >= sensorLimit) {
          nodes.add(gene.targetId);
        }
      }

      return Math.max(1, nodes.size || 1);
    }

    const rnd = this.prngFor('neurons');
    const neuro = this.geneFraction(GENE_LOCI.NEURAL);

    return Math.max(1, Math.floor(neuro * 4 + rnd() * 2) + 1);
  }

  sight() {
    const rnd = this.prngFor('sight');
    const sense = this.geneFraction(GENE_LOCI.SENSE);

    return Math.max(1, Math.floor(sense * 4 + rnd() * 2) + 1);
  }

  baseEnergyLossScale() {
    const capacity = this.geneFraction(GENE_LOCI.ENERGY_CAPACITY);

    return 0.5 + capacity; // 0.5..1.5 scale
  }

  // Lifespan derived solely from DNA, without external clamps
  lifespanDNA() {
    const rnd = this.prngFor('lifespan');
    const longevity = this.geneFraction(GENE_LOCI.SENESCENCE);
    const resilience = this.geneFraction(GENE_LOCI.RESIST_COLD);
    const base = 300 + ((longevity + resilience) / 2) * 900; // 300..1200
    const noise = (rnd() - 0.5) * 120; // +/-60
    const adj = this.lifespanAdj();

    return Math.max(10, Math.round(base + noise + adj));
  }

  // DNA-derived base energy loss per tick (before scale)
  energyLossBase() {
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const drivePenalty = 0.45 * risk + 0.2 * (1 - movement);
    const base = 0.018 + 0.02 * (1 - efficiency) + 0.01 * drivePenalty;

    return clamp(base, 0.012, 0.055);
  }

  // How efficiently a cell can harvest tile energy per tick (0.15..0.85)
  forageRate() {
    const gather = this.geneFraction(GENE_LOCI.FORAGING);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const harvestFocus = 0.32 + 0.28 * gather + 0.18 * cooperation - 0.18 * risk;

    return clamp(harvestFocus, 0.15, 0.85);
  }

  // Absolute caps (energy units per tick) for harvesting; DNA-driven
  harvestCapMin() {
    const foraging = this.geneFraction(GENE_LOCI.FORAGING);

    return 0.03 + 0.12 * foraging; // 0.03..0.15
  }
  harvestCapMax() {
    const capacity = this.geneFraction(GENE_LOCI.ENERGY_CAPACITY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const raw = 0.28 + 0.32 * capacity + 0.2 * cooperation - 0.18 * risk;

    return clamp(raw, 0.2, 0.9);
  }

  // Energy cost characteristics for actions
  moveCost() {
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);

    return 0.002 + 0.006 * movement; // 0.002..0.008
  }
  fightCost() {
    const combat = this.geneFraction(GENE_LOCI.COMBAT);

    return 0.01 + 0.03 * combat; // 0.01..0.04
  }

  cognitiveCostComponents({
    baselineNeurons = 0,
    dynamicNeurons = 0,
    sight = 0,
    effDensity = 0,
  } = {}) {
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);
    const base = 0.0004 + 0.0008 * (1 - efficiency);
    const densityFactor = 0.5 + 0.5 * Math.max(0, effDensity);
    const normalizedSight = Math.max(0, sight);
    const baseline = base * (Math.max(0, baselineNeurons) + 0.5 * normalizedSight) * densityFactor;
    const usageScale = 0.6 + 0.8 * activity; // 0.6..1.4
    const dynamic = base * Math.max(0, dynamicNeurons) * usageScale * densityFactor;
    const total = baseline + dynamic;

    return {
      baseline,
      dynamic,
      total,
      usageScale,
      densityFactor,
      base,
    };
  }

  // Cognitive/perception cost based on neurons and sight
  cognitiveCost(neurons, sight, effDensity = 0) {
    const { total } = this.cognitiveCostComponents({
      baselineNeurons: neurons,
      dynamicNeurons: 0,
      sight,
      effDensity,
    });

    return total;
  }

  // Reproduction energy threshold as a fraction of max tile energy
  reproductionThresholdFrac() {
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    let threshold = 0.28 + 0.3 * (1 - efficiency) + 0.18 * fertility - 0.08 * cooperation;

    return clamp(threshold, 0.22, 0.7);
  }

  // Cooperation share fraction of current energy
  cooperateShareFrac() {
    return 0.2 + 0.4 * this.geneFraction(GENE_LOCI.COOPERATION); // 0.2..0.6
  }

  strategy() {
    const rnd = this.prngFor('strategy');
    const anchor = this.geneFraction(GENE_LOCI.STRATEGY);

    return clamp(anchor * 0.7 + rnd() * 0.3, 0, 1); // 0..1
  }

  // Preference (-1..1) for genetic similarity in mates. Positive -> likes similar, negative -> seeks diversity.
  mateSimilarityBias() {
    const rnd = this.prngFor('mateSimilarityBias');
    const r = this.r / 255;
    const g = this.g / 255;
    const b = this.b / 255;
    const homophily = (r - b) * 1.2; // red encourages kin attraction, blue encourages novelty
    const stability = (g - 0.5) * 0.4; // green moderates extremes
    const jitter = (rnd() - 0.5) * 0.6;

    return clamp(homophily - stability + jitter, -1, 1);
  }

  // Curiosity/outbreeding appetite (0..1). Higher encourages sampling dissimilar mates.
  diversityAppetite() {
    const rnd = this.prngFor('diversityAppetite');
    const g = this.g / 255;
    const b = this.b / 255;
    const bias = this.mateSimilarityBias();
    const curiosityBase = 0.25 + 0.45 * b; // bluer genomes are more exploratory
    const efficiencyBrake = 0.25 * g; // greener genomes conserve effort
    const jitter = (rnd() - 0.5) * 0.3;
    let appetite = curiosityBase - efficiencyBrake + jitter;

    // Strong homophily dampens curiosity, heterophily boosts it
    appetite += Math.max(0, -bias) * 0.4;
    appetite -= Math.max(0, bias) * 0.3;

    return clamp(appetite, 0, 1);
  }

  lifespanAdj() {
    return Math.round((this.geneFraction(GENE_LOCI.SENESCENCE) - 0.5) * 200);
  }

  densityResponses() {
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);

    const reproMax = 1.0 + efficiency * 0.3;
    const reproMin = 0.3 + efficiency * 0.4;
    const fightMin = 0.8 + risk * 0.3;
    const fightMax = 1.3 + risk * 0.9;
    const coopMax = 1.1 + cooperation * 0.2;
    const coopMin = 0.5 + cooperation * 0.4;
    const energyMin = 1.0 + density * 0.2;
    const energyMax = 1.1 + (1 - efficiency) * 0.6;
    const cautiousMin = 1.0 + (1 - movement) * 0.2;
    const cautiousMax = 1.2 + (1 - movement) * 0.8;
    const pursuitMax = 1.0 + movement * 0.2;
    const pursuitMin = 0.6 + (1 - cooperation) * 0.4;
    const enemyBiasMin = 0.02 + risk * 0.08;
    const enemyBiasMax = 0.2 + risk * 0.5;

    return {
      reproduction: { min: reproMin, max: reproMax },
      fight: { min: fightMin, max: fightMax },
      cooperate: { min: coopMin, max: coopMax },
      energyLoss: { min: energyMin, max: energyMax },
      cautious: { min: cautiousMin, max: cautiousMax },
      pursuit: { min: pursuitMin, max: pursuitMax },
      enemyBias: { min: enemyBiasMin, max: enemyBiasMax },
    };
  }

  reproduceWith(other, mutationChance = 0.15, mutationRange = 12, options = {}) {
    const parentSeed = (this.seed() ^ (other?.seed?.() ?? 0)) >>> 0;
    const entropySource = options?.rng;
    let entropyRoll;

    if (entropySource && typeof entropySource.next === 'function') {
      entropyRoll = entropySource.next();
    } else if (typeof entropySource === 'function') {
      entropyRoll = entropySource();
    }

    if (!Number.isFinite(entropyRoll)) {
      entropyRoll = Math.random();
    }

    const entropy = Math.floor(Math.max(0, Math.min(1, entropyRoll)) * 0xffffffff) >>> 0;
    const rng = createRNG((parentSeed ^ entropy) >>> 0);
    const blendA = typeof this.crossoverMix === 'function' ? this.crossoverMix() : 0.5;
    const blendB = typeof other?.crossoverMix === 'function' ? other.crossoverMix() : 0.5;
    const blendProbability = clamp((blendA + blendB) / 2, 0, 1);
    const range = Math.max(0, mutationRange | 0);
    const geneCount = Math.max(this.length, other?.length ?? 0, DEFAULT_TOTAL_GENE_COUNT);

    const mixGene = (a, b) => {
      let v;

      if (rng() < blendProbability) {
        const weight = rng();

        v = Math.round(a * weight + b * (1 - weight));
      } else {
        v = rng() < 0.5 ? a : b;
      }

      if (rng() < mutationChance) {
        v += Math.floor(randomRange(-1, 1, rng) * range);
      }

      return clampGene(v);
    };

    const genes = new Uint8Array(geneCount);

    for (let i = 0; i < geneCount; i++) {
      const a = this.geneAt(i);
      const b = other?.geneAt?.(i) ?? other?.genes?.[i] ?? 0;

      genes[i] = mixGene(a, b);
    }

    return new DNA({ genes, geneCount });
  }

  similarity(other) {
    if (!other) return 0;

    const geneCount = Math.max(this.length, other.length ?? 0);
    let distSq = 0;

    for (let i = 0; i < geneCount; i++) {
      const delta = this.geneAt(i) - (other.geneAt?.(i) ?? 0);

      distSq += delta * delta;
    }

    const dist = Math.sqrt(distSq);
    const maxDist = Math.sqrt(geneCount * 255 * 255);

    return geneCount === 0 ? 1 : 1 - dist / maxDist;
  }
}

export default DNA;
