import { clamp, createRNG, randomRange } from "./utils/math.js";
import Brain, { NEURAL_GENE_BYTES } from "./brain.js";
import {
  ACTIVITY_BASE_RATE,
  MUTATION_CHANCE_BASELINE,
  OFFSPRING_VIABILITY_BUFFER,
  DECAY_RETURN_FRACTION,
} from "./config.js";

const ACTIVITY_RATE_SPAN = 0.7;

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
  COURTSHIP: 29,
  GESTATION_EFFICIENCY: 30,
});

const BASE_GENE_COUNT = Math.max(...Object.values(GENE_LOCI)) + 1;
const DEFAULT_NEURAL_CONNECTIONS = 16;
const DEFAULT_TOTAL_GENE_COUNT =
  BASE_GENE_COUNT + DEFAULT_NEURAL_CONNECTIONS * NEURAL_GENE_BYTES;

export const SHARED_RNG_CACHE_MAX_ENTRIES = 256;

const MUTATING_TYPED_ARRAY_METHODS = new Set([
  "copyWithin",
  "fill",
  "reverse",
  "set",
  "sort",
]);

const clampGene = (value) => {
  const normalized = Number.isNaN(value) ? 0 : value | 0;

  return clamp(normalized, 0, 255);
};

export class DNA {
  #genesTarget;

  constructor(rOrGenes = 0, g = 0, b = 0, options = {}) {
    let geneCount = options.geneCount ?? DEFAULT_TOTAL_GENE_COUNT;
    let genesInput = null;

    if (Array.isArray(rOrGenes) || rOrGenes instanceof Uint8Array) {
      genesInput = rOrGenes;
    } else if (
      typeof rOrGenes === "object" &&
      rOrGenes !== null &&
      !(rOrGenes instanceof Uint8Array)
    ) {
      const config = rOrGenes;

      geneCount = config.geneCount ?? geneCount;
      genesInput = config.genes ?? genesInput;
    }

    this.#genesTarget = new Uint8Array(geneCount);
    const genesProxy = this.#createGenesProxy(this.#genesTarget);

    Object.defineProperty(this, "genes", {
      configurable: false,
      enumerable: true,
      writable: false,
      value: genesProxy,
    });
    this._brainMetrics = null;
    this._seed = null;
    this._rngCache = new Map();
    this._sharedRngCache = new Map();
    this._inverseMaxDistanceCache = new Map();

    if (genesInput) {
      const limit = Math.min(genesInput.length ?? 0, geneCount);

      for (let i = 0; i < limit; i++) {
        this.#genesTarget[i] = clampGene(genesInput[i]);
      }
    } else {
      this.#genesTarget[GENE_LOCI.COLOR_R] = clampGene(rOrGenes);
      this.#genesTarget[GENE_LOCI.COLOR_G] = clampGene(g);
      this.#genesTarget[GENE_LOCI.COLOR_B] = clampGene(b);
    }

    this.#invalidateCaches();
  }

  static random(rng = Math.random, geneCount = DEFAULT_TOTAL_GENE_COUNT) {
    const genes = new Uint8Array(geneCount);

    for (let i = 0; i < geneCount; i++) {
      genes[i] = Math.floor(rng() * 256) & 0xff;
    }

    return new DNA({ genes, geneCount });
  }

  get length() {
    return this.#genesTarget.length;
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
    const genes = this.#genesTarget;

    return index >= 0 && index < genes.length ? genes[index] : 0;
  }

  geneFraction(index) {
    const genes = this.#genesTarget;

    if (index >= 0 && index < genes.length) {
      return genes[index] / 255;
    }

    return 0;
  }

  toColor() {
    return `rgb(${this.r},${this.g},${this.b})`;
  }

  seed() {
    if (Number.isInteger(this._seed)) {
      return this._seed;
    }

    let hash = 2166136261;
    const genes = this.#genesTarget;

    for (let i = 0; i < genes.length; i++) {
      hash ^= genes[i];
      hash = Math.imul(hash, 16777619);
    }

    this._seed = hash >>> 0;

    return this._seed;
  }

  // Deterministic per-trait RNG stream derived from DNA seed
  prngFor(tag) {
    const key = typeof tag === "string" && tag.length > 0 ? tag : "default";

    if (!this._rngCache.has(key)) {
      let h = (this.seed() ^ 2166136261) >>> 0; // FNV-1a like mix

      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }

      this._rngCache.set(key, h >>> 0);
    }

    return createRNG(this._rngCache.get(key));
  }

  sharedRng(other, tag = "") {
    const otherSeed = other && typeof other.seed === "function" ? other.seed() : 0;
    const tagKey = typeof tag === "string" && tag.length > 0 ? tag : "";
    const cacheKey = `${otherSeed}:${tagKey}`;

    if (!this._sharedRngCache.has(cacheKey)) {
      let h = (this.seed() ^ otherSeed ^ 0x9e3779b9) >>> 0;

      if (tagKey) {
        for (let i = 0; i < tagKey.length; i++) {
          h ^= tagKey.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
      }

      this._sharedRngCache.set(cacheKey, h >>> 0);
      this.#pruneSharedRngCache();
    }

    return createRNG(this._sharedRngCache.get(cacheKey));
  }

  isLegacyGenome() {
    const extraBytes = this.#genesTarget.length - BASE_GENE_COUNT;

    return extraBytes < NEURAL_GENE_BYTES;
  }

  hasNeuralGenes() {
    return !this.isLegacyGenome() && this.neuralGeneCount() > 0;
  }

  neuralGeneCount() {
    const extraBytes = this.#genesTarget.length - BASE_GENE_COUNT;

    if (extraBytes < NEURAL_GENE_BYTES) return 0;

    return Math.floor(extraBytes / NEURAL_GENE_BYTES);
  }

  #invalidateCaches() {
    this._seed = null;
    if (this._rngCache) this._rngCache.clear();
    if (this._sharedRngCache) this._sharedRngCache.clear();
    if (this._inverseMaxDistanceCache) this._inverseMaxDistanceCache.clear();
    this._cachedReproductionProb = null;
  }

  #pruneSharedRngCache(limit = SHARED_RNG_CACHE_MAX_ENTRIES) {
    const cache = this._sharedRngCache;

    if (!cache) {
      return;
    }

    const maxEntries = Math.max(0, Math.floor(limit ?? 0));

    if (maxEntries === 0) {
      cache.clear();

      return;
    }

    if (cache.size <= maxEntries) {
      return;
    }

    let excess = cache.size - maxEntries;

    for (const key of cache.keys()) {
      if (excess <= 0) break;

      cache.delete(key);
      excess -= 1;
    }
  }

  #resolveInverseMaxDistance(geneCount) {
    if (!(geneCount > 0)) {
      return 0;
    }

    if (!this._inverseMaxDistanceCache) {
      this._inverseMaxDistanceCache = new Map();
    }

    if (this._inverseMaxDistanceCache.has(geneCount)) {
      return this._inverseMaxDistanceCache.get(geneCount);
    }

    const maxDist = Math.sqrt(geneCount * 255 * 255);
    const inverse = maxDist > 0 ? 1 / maxDist : 0;

    this._inverseMaxDistanceCache.set(geneCount, inverse);

    return inverse;
  }

  #createGenesProxy(target) {
    const owner = this;

    const handler = {
      get(obj, prop, receiver) {
        if (prop === "length") {
          return obj.length;
        }

        if (typeof prop === "number") {
          return obj[prop];
        }

        if (typeof prop === "string") {
          const index = Number(prop);

          if (Number.isInteger(index) && index >= 0 && index < obj.length) {
            return obj[index];
          }
        }

        const value = Reflect.get(obj, prop, receiver);

        if (typeof value === "function") {
          if (typeof prop === "string" && MUTATING_TYPED_ARRAY_METHODS.has(prop)) {
            return (...args) => {
              const result = value.apply(obj, args);

              owner.#invalidateCaches();

              return result;
            };
          }

          return value.bind(obj);
        }

        return value;
      },
      set(obj, prop, value, receiver) {
        const index = Number(prop);
        const isIndex = Number.isInteger(index) && index >= 0 && index < obj.length;
        const prev = isIndex ? obj[index] : undefined;
        const result = Reflect.set(obj, prop, value, receiver);

        if (result && isIndex && obj[index] !== prev) {
          owner.#invalidateCaches();
        }

        return result;
      },
    };

    return new Proxy(target, handler);
  }

  #decodeNeuralGene(index) {
    const start = BASE_GENE_COUNT + index * NEURAL_GENE_BYTES;
    const genes = this.#genesTarget;

    if (start < BASE_GENE_COUNT || start + NEURAL_GENE_BYTES > genes.length) {
      return null;
    }
    const b0 = genes[start];
    const b1 = genes[start + 1];
    const b2 = genes[start + 2];
    const b3 = genes[start + 3];
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

    return Array.from({ length: count }, (_, index) =>
      this.#decodeNeuralGene(index),
    ).filter(Boolean);
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
    const rnd = this.prngFor("weights");

    return Array.from({ length: 6 }, () =>
      Array.from({ length: 5 }, () => rnd() * 2 - 1),
    );
  }

  movementGenes() {
    const rng = this.prngFor("movementGenes");
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const cohesion = this.geneFraction(GENE_LOCI.COHESION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const jitter = () => (rng() - 0.5) * 0.2;

    const wandering = clamp(
      0.35 +
        0.5 * exploration +
        0.2 * (1 - cohesion) -
        0.1 * risk +
        0.15 * (1 - density) +
        jitter(),
      0.05,
      1.8,
    );
    const pursuit = clamp(
      0.35 +
        0.6 * movement +
        0.3 * risk +
        0.25 * strategy -
        0.1 * (1 - cohesion) +
        jitter(),
      0.05,
      1.8,
    );
    const cautious = clamp(
      0.35 +
        0.6 * (1 - movement) +
        0.3 * (1 - risk) +
        0.25 * (1 - strategy) +
        0.1 * density +
        jitter(),
      0.05,
      1.8,
    );

    return { wandering, pursuit, cautious };
  }

  interactionGenes() {
    const rng = this.prngFor("interactionGenes");
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const jitter = () => (rng() - 0.5) * 0.2;

    const avoid = clamp(
      0.3 +
        0.6 * (1 - risk) +
        0.3 * (1 - combat) +
        0.2 * density +
        0.1 * (1 - strategy) +
        jitter(),
      0.05,
      1.8,
    );
    const fight = clamp(
      0.3 +
        0.6 * risk +
        0.5 * combat -
        0.15 * cooperation +
        0.1 * (1 - recovery) +
        jitter(),
      0.05,
      1.8,
    );
    const cooperate = clamp(
      0.25 +
        0.7 * cooperation +
        0.25 * parental +
        0.2 * recovery -
        0.1 * risk +
        jitter(),
      0.05,
      1.8,
    );

    return { avoid, fight, cooperate };
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
    return clamp(
      ACTIVITY_BASE_RATE + ACTIVITY_RATE_SPAN * this.geneFraction(GENE_LOCI.ACTIVITY),
      0,
      1,
    );
  }

  // Fraction of current energy invested in offspring
  parentalInvestmentFrac() {
    return 0.2 + 0.5 * this.geneFraction(GENE_LOCI.PARENTAL);
  }

  // Minimum fraction of tile energy this genome expects per offspring
  offspringEnergyDemandFrac() {
    const rng = this.prngFor("offspringEnergyDemandFrac");
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const capacity = this.geneFraction(GENE_LOCI.ENERGY_CAPACITY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const nurture = 0.22 + 0.58 * parental; // 0.22..0.80
    const brood = 0.1 + 0.5 * fertility; // 0.10..0.60
    const thrift = 0.2 + 0.6 * efficiency; // 0.20..0.80
    const stamina = 0.14 + 0.46 * capacity; // 0.14..0.60
    const boldness = 0.1 + 0.35 * risk; // 0.10..0.45
    const base =
      0.14 +
      nurture * 0.45 +
      brood * 0.28 +
      boldness * 0.22 +
      stamina * 0.25 -
      thrift * 0.38;
    const jitter = (rng() - 0.5) * 0.08; // deterministic per-genome wobble

    return clamp(base + jitter, 0.08, 0.55);
  }

  offspringEnergyTransferEfficiency() {
    const rng = this.prngFor("offspringEnergyTransferEfficiency");
    const gestation = this.geneFraction(GENE_LOCI.GESTATION_EFFICIENCY);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const metabolicLean =
      0.62 +
      0.18 * efficiency +
      0.12 * parental +
      0.08 * recovery +
      0.06 * fertility -
      0.14 * risk;
    const gestationAnchor = 0.6 + 0.35 * gestation;
    const blended = 0.6 * gestationAnchor + 0.4 * metabolicLean;
    const jitter = (rng() - 0.5) * 0.04;

    return clamp(blended + jitter, 0.5, 0.96);
  }

  offspringViabilityBuffer(globalBuffer = OFFSPRING_VIABILITY_BUFFER) {
    const rng = this.prngFor("offspringViabilityBuffer");
    const gestation = this.geneFraction(GENE_LOCI.GESTATION_EFFICIENCY);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const baseline = clamp(
      Number.isFinite(globalBuffer) ? globalBuffer : OFFSPRING_VIABILITY_BUFFER,
      1,
      2,
    );
    const caution = clamp(0.85 + parental * 0.35 + (1 - risk) * 0.4, 0.7, 1.6);
    const support = clamp(
      0.8 + efficiency * 0.3 + gestation * 0.35 + recovery * 0.2,
      0.75,
      1.6,
    );
    const temperament = clamp(caution / support, 0.65, 1.45);
    const jitter = 1 + (rng() - 0.5) * 0.08;

    return clamp(baseline * temperament * jitter, 1, 2);
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
    if (Number.isFinite(this._cachedReproductionProb)) {
      return this._cachedReproductionProb;
    }

    const rnd = this.prngFor("reproductionProb");
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const boldness = clamp(0.5 * risk + 0.5 * fertility, 0, 1);
    const synergy = clamp(
      0.35 * cooperation + 0.35 * efficiency + 0.3 * (1 - Math.abs(risk - fertility)),
      0,
      1,
    );
    const base = 0.18 + 0.6 * boldness; // 0.18..0.78
    const synergyAdj = 0.75 + 0.35 * synergy; // 0.75..1.10
    const noise = 0.9 + rnd() * 0.2; // 0.9..1.1

    const probability = Math.min(0.9, Math.max(0.05, base * synergyAdj * noise));

    this._cachedReproductionProb = probability;

    return probability;
  }

  reproductionCooldownTicks() {
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const base = 3 + Math.round(4 * (1 - fertility));
    const nurturePenalty = Math.round(parental * 3);
    const cautionPenalty = Math.round((1 - risk) * 2);
    const efficiencyRelief = Math.round(efficiency * 2);
    const cooldown = base + nurturePenalty + cautionPenalty - efficiencyRelief;

    return Math.max(2, cooldown);
  }

  // Target mate similarity and tolerance derived from genome
  mateSimilarityPreference() {
    const rnd = this.prngFor("mateSimilarityPreference");
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
    const rnd = this.prngFor("lifespan");
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
    const rnd = this.prngFor("crossoverMix");
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const cohesion = this.geneFraction(GENE_LOCI.COHESION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const base = 0.25 + 0.45 * cooperation;
    const temperament = 0.2 * (cohesion - risk);
    const jitter = (rnd() - 0.5) * 0.2; // deterministic per-genome variance

    return clamp(base + temperament + jitter, 0, 1);
  }

  mutationChance() {
    const rnd = this.prngFor("mutationChance");
    const rate = this.geneFraction(GENE_LOCI.MUTATION_RATE);
    const base = 0.04 + rate * 0.22;
    const jitter = (rnd() - 0.5) * 0.05;

    return clamp(base + jitter, 0.02, 0.3);
  }

  mutationRange() {
    const rnd = this.prngFor("mutationRange");
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

    const rnd = this.prngFor("neurons");
    const neuro = this.geneFraction(GENE_LOCI.NEURAL);

    return Math.max(1, Math.floor(neuro * 4 + rnd() * 2) + 1);
  }

  sight() {
    const rnd = this.prngFor("sight");
    const sense = this.geneFraction(GENE_LOCI.SENSE);

    return Math.max(1, Math.floor(sense * 4 + rnd() * 2) + 1);
  }

  baseEnergyLossScale() {
    const capacity = this.geneFraction(GENE_LOCI.ENERGY_CAPACITY);

    return 0.5 + capacity; // 0.5..1.5 scale
  }

  // Lifespan derived solely from DNA, without external clamps
  lifespanDNA() {
    const rnd = this.prngFor("lifespan");
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
    const drivePenalty = 0.5 * risk + 0.25 * (1 - movement);
    const base = 0.0095 + 0.009 * (1 - efficiency) + 0.005 * drivePenalty;

    return clamp(base, 0.0085, 0.032);
  }

  scarcityReliefProfile() {
    const rng = this.prngFor("scarcityReliefProfile");
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const drought = this.geneFraction(GENE_LOCI.RESIST_DROUGHT);
    const heat = this.geneFraction(GENE_LOCI.RESIST_HEAT);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const preparedness = (drought + heat) / 2;
    const scarcity = 1 - preparedness;
    const inefficiency = 1 - efficiency;
    const fragility = 1 - recovery;
    const baseline = clamp(
      0.12 +
        0.24 * inefficiency +
        0.15 * fragility +
        0.12 * scarcity +
        0.1 * risk +
        0.08 * movement +
        (rng() - 0.5) * 0.04,
      0.04,
      0.5,
    );
    const taper = clamp(
      0.35 +
        0.3 * inefficiency +
        0.2 * fragility +
        0.14 * scarcity +
        0.18 * risk +
        0.1 * movement +
        (rng() - 0.5) * 0.05,
      0.2,
      0.95,
    );
    const curvature = clamp(
      0.6 +
        0.4 * inefficiency +
        0.25 * risk +
        0.12 * movement -
        0.2 * recovery -
        0.1 * preparedness +
        (rng() - 0.5) * 0.25,
      0.3,
      1.8,
    );

    return { baseline, taper, curvature };
  }

  energyScarcityRelief(energyFraction = 0, profile = null) {
    const resolvedEnergy = clamp(
      Number.isFinite(energyFraction) ? energyFraction : 0,
      0,
      1,
    );
    const data =
      profile && typeof profile === "object" ? profile : this.scarcityReliefProfile();
    const baseline = clamp(data?.baseline ?? 0.15, 0.05, 0.6);
    const taper = clamp(data?.taper ?? 0.85, 0.2, 1.05);
    const curvature = clamp(data?.curvature ?? 1, 0.25, 2);
    const curved = Math.pow(resolvedEnergy, curvature);
    const eased = Math.min(1, curved * taper);
    const relief = baseline + (1 - baseline) * eased;

    return clamp(relief, 0.05, 1);
  }

  decayEnergyReturnFraction(globalFraction = DECAY_RETURN_FRACTION) {
    const baseline = clamp(
      Number.isFinite(globalFraction) ? globalFraction : DECAY_RETURN_FRACTION,
      0,
      0.98,
    );
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const capacity = this.geneFraction(GENE_LOCI.ENERGY_CAPACITY);
    const coldResist = this.geneFraction(GENE_LOCI.RESIST_COLD);
    const droughtResist = this.geneFraction(GENE_LOCI.RESIST_DROUGHT);
    const heatResist = this.geneFraction(GENE_LOCI.RESIST_HEAT);
    const resilience = (recovery + efficiency + capacity + coldResist) / 4;
    const weathering = (droughtResist + heatResist) / 2;
    const structureScore = density;
    const conservationScore =
      0.4 * structureScore + 0.35 * resilience + 0.25 * weathering;
    const rng = this.prngFor("decayEnergyReturnFraction");
    const jitter = (rng() - 0.5) * 0.06;
    const centered = conservationScore - 0.5 + jitter;
    const upwardAllowance = Math.min(0.35, 0.18 + baseline * 0.4);
    const downwardAllowance = Math.min(0.4, 0.2 + (1 - baseline) * 0.45);
    const adjustment =
      centered >= 0 ? centered * upwardAllowance : centered * downwardAllowance;
    const bounded = clamp(
      baseline + adjustment,
      Math.max(0, baseline - downwardAllowance),
      Math.min(0.98, baseline + upwardAllowance),
    );

    return clamp(bounded, 0.05, 0.98);
  }

  metabolicProfile() {
    const rng = this.prngFor("metabolicProfile");
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const jitter = (rng() - 0.5) * 0.08;

    const baseline = clamp(
      0.2 +
        0.38 * activity +
        0.22 * movement +
        0.18 * risk -
        0.4 * efficiency -
        0.22 * recovery +
        jitter,
      0.04,
      1.1,
    );
    const crowdingTax = clamp(
      0.16 + 0.32 * (1 - density) + 0.18 * risk + 0.12 * parental - 0.28 * efficiency,
      0.03,
      1,
    );
    const neuralDrag = clamp(
      0.12 + 0.38 * neural + 0.18 * activity - 0.24 * recovery,
      0.04,
      0.9,
    );

    return { baseline, crowdingTax, neuralDrag };
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

  // DNA-weighted tolerance for harvesting in crowded tiles (0..1)
  forageCrowdingTolerance() {
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const rnd = this.prngFor("crowdTolerance");
    const baseline =
      0.22 + 0.55 * density + 0.18 * cooperation - 0.22 * risk + 0.12 * exploration;
    const jitter = (rnd() - 0.5) * 0.06;

    return clamp(baseline + jitter, 0.05, 0.95);
  }

  // DNA-tuned smoothing factor for the resource trend sensor (0.1..0.85)
  resourceTrendAdaptation() {
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const base = 0.2 + 0.5 * sense + 0.2 * exploration - 0.2 * recovery;

    return clamp(base, 0.1, 0.85);
  }

  eventResponseProfile() {
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);

    const drainMitigation = clamp(
      0.25 + 0.55 * recovery + 0.15 * cooperation - 0.3 * risk,
      0.05,
      0.85,
    );
    const vigilance = clamp(
      0.4 + 0.35 * risk + 0.25 * sense + 0.2 * exploration - 0.2 * strategy,
      0.2,
      1.25,
    );
    const pressureRetention = clamp(
      0.35 + 0.3 * risk + 0.25 * density - 0.28 * recovery - 0.18 * strategy,
      0.05,
      0.95,
    );
    const rebound = clamp(
      0.1 + 0.45 * recovery + 0.2 * strategy + 0.1 * cooperation - 0.25 * risk,
      0.02,
      0.75,
    );

    return { drainMitigation, vigilance, pressureRetention, rebound };
  }

  eventAnticipationProfile() {
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);

    const assimilation = clamp(
      0.2 + 0.45 * sense + 0.25 * density - 0.4 * strategy,
      0.05,
      0.85,
    );
    const relief = clamp(
      0.12 + 0.4 * recovery + 0.2 * strategy - 0.25 * risk,
      0.05,
      0.7,
    );
    const gainInfluence = clamp(
      0.25 + 0.35 * risk + 0.2 * sense - 0.3 * recovery,
      0,
      1,
    );
    const volatility = clamp(
      0.25 + 0.4 * risk + 0.2 * density - 0.3 * strategy,
      0.05,
      1.2,
    );
    const fatigueWeight = clamp(0.2 + 0.45 * activity - 0.35 * recovery, 0, 1.2);
    const rewardScale = clamp(
      0.3 + 0.35 * strategy + 0.2 * recovery - 0.3 * risk,
      0.05,
      1.5,
    );
    const baseline = clamp(0.1 + 0.35 * risk + 0.25 * sense - 0.2 * recovery, 0, 1);

    return {
      assimilation,
      relief,
      gainInfluence,
      volatility,
      fatigueWeight,
      rewardScale,
      baseline,
    };
  }

  interactionPlasticity() {
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);

    const baseline = clamp(
      (cooperation - combat) * 1.1 +
        (parental - risk) * 0.6 +
        (exploration - 0.5) * 0.3,
      -1,
      1,
    );
    const learningRate = clamp(0.18 + 0.45 * sense + 0.25 * cooperation, 0.08, 0.85);
    const volatility = clamp(
      0.35 + 0.4 * risk + 0.3 * combat - 0.25 * cooperation,
      0.1,
      1.2,
    );
    const decay = clamp(0.05 + 0.4 * density + 0.25 * (1 - activity), 0.02, 0.55);

    return { baseline, learningRate, volatility, decay };
  }

  interactionAffectProfile() {
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const ally = this.geneFraction(GENE_LOCI.ALLY);
    const enemy = this.geneFraction(GENE_LOCI.ENEMY);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);

    const aggression = clamp(
      0.35 + 0.5 * combat + 0.35 * risk - 0.25 * cooperation,
      0,
      1.2,
    );
    const empathy = clamp(
      0.25 + 0.5 * cooperation + 0.25 * parental - 0.25 * risk,
      0,
      1,
    );
    const kinFavor = clamp(0.2 + 0.45 * ally - 0.25 * enemy + 0.25 * parental, 0, 1);
    const prudence = clamp(0.3 + 0.5 * strategy + 0.25 * recovery - 0.2 * risk, 0, 1);

    const fightWinBase = clamp(-0.25 - aggression * 0.9 + prudence * 0.3, -1.4, -0.05);
    const fightWinKin = clamp(-0.15 - empathy * 0.7, -1, 0);
    const fightLossBase = clamp(
      fightWinBase - 0.25 - (1 - recovery) * 0.4,
      -1.7,
      -0.15,
    );
    const fightLossKin = clamp(fightWinKin - 0.2 - (1 - recovery) * 0.3, -1.2, 0);
    const coopReceiveBase = clamp(0.3 + empathy * 0.9 + kinFavor * 0.2, 0.05, 1.4);
    const coopGiveBase = clamp(
      coopReceiveBase - 0.15 + cooperation * 0.1 - aggression * 0.2,
      0.02,
      1.2,
    );
    const coopReceiveKin = clamp(0.2 + kinFavor * 0.6, 0, 1);
    const coopGiveKin = clamp(coopReceiveKin - 0.05 + kinFavor * 0.1, 0, 0.9);
    const reproduceBase = clamp(
      0.25 + parental * 0.6 + cooperation * 0.25 - risk * 0.15,
      0.05,
      1,
    );
    const reproduceKin = clamp(0.15 + kinFavor * 0.5, 0, 0.8);
    const genericPositive = clamp(0.1 + empathy * 0.5 - aggression * 0.2, -0.1, 0.6);
    const genericNegative = clamp(-0.15 - aggression * 0.6 + prudence * 0.2, -1, 0.1);
    const energyWeight = clamp(0.25 + cooperation * 0.35 - risk * 0.25, 0.05, 0.6);
    const intensityWeight = clamp(
      0.5 + aggression * 0.4 + prudence * 0.2 - empathy * 0.2,
      0.2,
      1.5,
    );

    return {
      fight: {
        win: { base: fightWinBase, kinship: fightWinKin },
        loss: { base: fightLossBase, kinship: fightLossKin },
      },
      cooperation: {
        give: { base: coopGiveBase, kinship: coopGiveKin },
        receive: { base: coopReceiveBase, kinship: coopReceiveKin },
      },
      reproduce: { base: reproduceBase, kinship: reproduceKin },
      generic: {
        positive: genericPositive,
        negative: genericNegative,
      },
      energyDeltaWeight: energyWeight,
      intensityWeight,
    };
  }

  combatEdgeSharpness() {
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const aggressiveness = 0.5 * combat + 0.35 * risk;
    const caution = 0.25 * recovery + 0.25 * strategy;
    const raw = 0.85 + aggressiveness - caution;

    return clamp(raw, 0.5, 1.6);
  }

  neuralSensorModulation() {
    const sensorCount = Brain?.SENSOR_COUNT ?? 0;

    if (sensorCount === 0) return null;

    const rng = this.prngFor("neuralSensorModulation");
    const baseline = new Float32Array(sensorCount);
    const targets = new Float32Array(sensorCount);

    for (let i = 0; i < sensorCount; i++) {
      baseline[i] = 1;
      targets[i] = Number.NaN;
    }

    baseline[0] = 1;
    targets[0] = 1;

    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const capacity = this.geneFraction(GENE_LOCI.ENERGY_CAPACITY);
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const senescence = this.geneFraction(GENE_LOCI.SENESCENCE);
    const foraging = this.geneFraction(GENE_LOCI.FORAGING);
    const fatigueProfile = this.neuralFatigueProfile();
    const fatigueBaseline = clamp(fatigueProfile?.baseline ?? 0.35, 0, 1);
    const fatigueRiskWeight = clamp(
      fatigueProfile?.fatigueRiskWeight ?? 0.4,
      0.05,
      0.9,
    );
    const restRiskBonus = clamp(fatigueProfile?.restRiskBonus ?? 0.2, 0, 0.6);

    const minGain = 0.45 + 0.25 * recovery; // 0.45..0.7
    const maxGain = Math.max(minGain + 0.05, 1.45 + 0.45 * movement); // 1.45..1.95
    const adaptationRate = clamp(0.02 + 0.15 * sense + 0.05 * neural, 0.015, 0.22);
    const reversionRate = clamp(
      0.04 + 0.1 * (1 - strategy) + 0.08 * (1 - activity),
      0.01,
      0.35,
    );

    const toSigned = (fraction, midpoint = 0.5, amplitude = 1) => {
      const centered = fraction - midpoint;

      return clamp(centered * 2 * amplitude, -1, 1);
    };

    const updateModulation = (
      key,
      { gain, target = Number.NaN, jitter = 0.1 } = {},
    ) => {
      const index = Brain?.sensorIndex?.(key);

      if (!Number.isFinite(index) || index < 0 || index >= sensorCount) return;

      const offset = (rng() - 0.5) * jitter;
      const proposedGain = Number.isFinite(gain) ? gain : 1;

      baseline[index] = clamp(proposedGain + offset, minGain, maxGain);

      if (Number.isFinite(target)) {
        targets[index] = clamp(target, -1, 1);
      }
    };

    updateModulation("energy", {
      gain: 0.8 + 0.6 * efficiency,
      target: toSigned(capacity, 0.45, 0.9),
      jitter: 0.12,
    });

    updateModulation("effectiveDensity", {
      gain: 0.85 + 0.4 * density + 0.2 * cooperation,
      target: toSigned(density, 0.45, 0.9),
      jitter: 0.1,
    });

    updateModulation("allyFraction", {
      gain: 0.75 + 0.5 * cooperation,
      target: toSigned(0.25 + 0.55 * cooperation, 0.5, 1),
      jitter: 0.1,
    });

    updateModulation("enemyFraction", {
      gain: 0.7 + 0.4 * ((risk + combat) / 2),
      target: toSigned(0.12 + 0.25 * (1 - risk), 0.5, 1),
      jitter: 0.08,
    });

    updateModulation("mateFraction", {
      gain: 0.65 + 0.45 * fertility,
      target: toSigned(0.25 + 0.45 * fertility + 0.1 * cooperation, 0.5, 1),
      jitter: 0.1,
    });

    updateModulation("allySimilarity", {
      gain: 0.7 + 0.35 * cooperation,
      target: toSigned(0.5 + 0.25 * cooperation - 0.2 * exploration, 0.5, 1),
      jitter: 0.08,
    });

    updateModulation("enemySimilarity", {
      gain: 0.75 + 0.35 * risk,
      target: toSigned(0.3 + 0.25 * risk - 0.15 * cooperation, 0.5, 1),
      jitter: 0.07,
    });

    updateModulation("mateSimilarity", {
      gain: 0.65 + 0.4 * fertility,
      target: toSigned(0.45 + 0.25 * fertility - 0.3 * exploration, 0.5, 1),
      jitter: 0.09,
    });

    updateModulation("ageFraction", {
      gain: 0.65 + 0.35 * senescence,
      target: toSigned(0.4 + 0.4 * senescence, 0.5, 1),
      jitter: 0.07,
    });

    updateModulation("eventPressure", {
      gain: 0.7 + 0.3 * recovery + 0.2 * (1 - exploration),
      target: toSigned(0.1 + 0.35 * (1 - recovery), 0.5, 1),
      jitter: 0.08,
    });

    updateModulation("partnerEnergy", {
      gain: 0.65 + 0.35 * parental,
      target: toSigned(0.35 + 0.45 * parental, 0.5, 1),
      jitter: 0.09,
    });

    updateModulation("partnerAgeFraction", {
      gain: 0.6 + 0.3 * parental,
      target: toSigned(0.35 + 0.3 * parental - 0.2 * risk, 0.5, 1),
      jitter: 0.08,
    });

    updateModulation("partnerSimilarity", {
      gain: 0.6 + 0.35 * parental,
      target: toSigned(0.45 + 0.25 * parental - 0.25 * exploration, 0.5, 1),
      jitter: 0.08,
    });

    updateModulation("baseReproductionProbability", {
      gain: 0.65 + 0.35 * fertility + 0.2 * cooperation,
      target: toSigned(0.35 + 0.45 * fertility + 0.15 * cooperation, 0.5, 1),
      jitter: 0.1,
    });

    updateModulation("riskTolerance", {
      gain: 0.6 + 0.4 * risk + 0.2 * neural - 0.25 * recovery,
      target: toSigned(
        0.32 +
          0.42 * risk -
          0.18 * cooperation -
          0.28 * fatigueBaseline +
          restRiskBonus * 0.2,
        0.5,
        1,
      ),
      jitter: 0.07 + fatigueRiskWeight * 0.06,
    });
    updateModulation("interactionMomentum", {
      gain: 0.7 + 0.35 * cooperation + 0.25 * sense,
      target: toSigned(0.4 + 0.45 * cooperation - 0.35 * combat, 0.5, 1),
      jitter: 0.1,
    });

    updateModulation("selfSenescence", {
      gain: 0.6 + 0.35 * senescence,
      target: toSigned(0.45 + 0.35 * senescence - 0.2 * activity, 0.5, 1),
      jitter: 0.08,
    });

    updateModulation("partnerSenescence", {
      gain: 0.6 + 0.3 * parental,
      target: toSigned(0.4 + 0.3 * parental - 0.15 * activity, 0.5, 1),
      jitter: 0.08,
    });

    updateModulation("resourceTrend", {
      gain: 0.7 + 0.3 * sense + 0.3 * exploration + 0.2 * foraging,
      target: toSigned(0.45 + 0.35 * exploration - 0.25 * recovery, 0.5, 1),
      jitter: 0.12,
    });

    updateModulation("neuralFatigue", {
      gain: clamp(0.75 + 0.35 * (1 - recovery) + 0.25 * (1 - neural), 0.55, 1.6),
      target: toSigned(fatigueBaseline, 0.45, 1),
      jitter: 0.06,
    });

    updateModulation("targetWeakness", {
      gain: 0.78 + 0.35 * (1 - combat) + 0.25 * strategy,
      target: toSigned(strategy, 0.5, 0.8),
      jitter: 0.1,
    });

    updateModulation("targetThreat", {
      gain: 0.72 + 0.4 * combat + 0.3 * risk,
      target: toSigned(risk, 0.5, 0.9),
      jitter: 0.12,
    });

    updateModulation("targetProximity", {
      gain: 0.7 + 0.35 * movement + 0.2 * exploration,
      target: toSigned(1 - movement, 0.5, 0.9),
      jitter: 0.12,
    });

    updateModulation("targetAttrition", {
      gain: 0.68 + 0.3 * movement + 0.25 * (1 - cooperation),
      target: toSigned(strategy, 0.5, 0.85),
      jitter: 0.1,
    });

    updateModulation("opportunitySignal", {
      gain: 0.7 + 0.35 * strategy + 0.25 * neural,
      target: toSigned(
        0.45 + 0.35 * strategy + 0.25 * cooperation - 0.3 * risk,
        0.5,
        0.9,
      ),
      jitter: 0.09,
    });

    return {
      baselineGains: baseline,
      targets,
      adaptationRate,
      reversionRate,
      gainLimits: { min: minGain, max: maxGain },
    };
  }

  neuralPlasticityProfile() {
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);

    const learningRate = clamp(
      0.03 + 0.22 * neural + 0.12 * sense - 0.08 * risk,
      0.01,
      0.32,
    );
    const rewardSensitivity = clamp(
      0.35 + 0.5 * recovery + 0.2 * neural + 0.15 * parental,
      0.1,
      1.4,
    );
    const punishmentSensitivity = clamp(
      0.3 + 0.45 * risk + 0.2 * (1 - recovery) + 0.15 * (1 - strategy),
      0.1,
      1.5,
    );
    const retention = clamp(
      0.78 + 0.14 * strategy + 0.12 * neural - 0.1 * activity,
      0.4,
      0.97,
    );
    const volatility = clamp(
      0.18 + 0.35 * activity + 0.18 * (1 - strategy),
      0.05,
      0.75,
    );
    const fatigueWeight = clamp(0.28 + 0.45 * recovery + 0.2 * parental, 0.1, 1.1);
    const costWeight = clamp(0.3 + 0.55 * (1 - efficiency) + 0.25 * activity, 0.1, 1.4);

    return {
      learningRate,
      rewardSensitivity,
      punishmentSensitivity,
      retention,
      volatility,
      fatigueWeight,
      costWeight,
    };
  }

  neuralReinforcementProfile() {
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);
    const cohesion = this.geneFraction(GENE_LOCI.COHESION);
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);

    const movement = this.movementGenes();
    const moveTotal = Math.max(
      0.0001,
      (movement?.wandering || 0) + (movement?.pursuit || 0) + (movement?.cautious || 0),
    );
    const interaction = this.interactionGenes();
    const interactionTotal = Math.max(
      0.0001,
      (interaction?.avoid || 0) +
        (interaction?.fight || 0) +
        (interaction?.cooperate || 0),
    );
    const conflict = this.conflictFocus();
    const conflictTotal = Math.max(
      0.0001,
      (conflict?.weak || 0) +
        (conflict?.strong || 0) +
        (conflict?.proximity || 0) +
        (conflict?.attrition || 0),
    );

    const opportunityAssimilation = clamp(
      0.18 + 0.32 * neural + 0.24 * exploration,
      0.05,
      0.8,
    );
    const opportunityDecay = clamp(
      0.06 + 0.28 * (1 - strategy) + 0.2 * (1 - recovery),
      0.01,
      0.55,
    );
    const opportunityPositiveWeight = clamp(
      0.4 + 0.35 * cooperation + 0.3 * fertility,
      0.1,
      1.2,
    );
    const opportunityNegativeWeight = clamp(0.35 + 0.4 * risk + 0.3 * combat, 0.1, 1.3);
    const opportunityVolatility = clamp(
      0.18 + 0.38 * (1 - strategy) + 0.28 * exploration,
      0.05,
      0.9,
    );
    const opportunityBaseline = clamp(
      0.05 + 0.35 * strategy + 0.25 * neural - 0.3 * risk,
      -0.6,
      0.8,
    );
    const opportunitySynergy = clamp(
      0.22 + 0.35 * efficiency + 0.25 * parental,
      0,
      0.8,
    );
    const opportunityGroupWeights = {
      movement: clamp(0.35 + 0.4 * movement + 0.2 * exploration, 0.05, 1.3),
      interaction: clamp(0.3 + 0.45 * cooperation + 0.2 * combat, 0.05, 1.3),
      reproduction: clamp(0.35 + 0.45 * fertility + 0.3 * parental, 0.05, 1.4),
      targeting: clamp(0.3 + 0.4 * combat + 0.35 * strategy, 0.05, 1.4),
    };

    return {
      energyDeltaWeight: clamp(0.35 + 0.45 * efficiency + 0.2 * recovery, 0.1, 1.25),
      cognitiveCostWeight: clamp(
        0.25 + 0.4 * (1 - efficiency) + 0.15 * activity,
        0.08,
        1.15,
      ),
      fatigueReliefWeight: clamp(0.3 + 0.45 * recovery + 0.2 * parental, 0.1, 1.2),
      restBoostWeight: clamp(0.25 + 0.35 * recovery + 0.25 * (1 - activity), 0.05, 1.1),
      movementAlignmentWeight: clamp(0.2 + 0.4 * (1 - risk) + 0.3 * strategy, 0.05, 1),
      interactionAlignmentWeight: clamp(
        0.2 + 0.35 * cooperation + 0.3 * combat + 0.2 * risk,
        0.05,
        1.05,
      ),
      reproductionWeight: clamp(0.2 + 0.45 * fertility + 0.35 * parental, 0.05, 1.1),
      targetingAlignmentWeight: clamp(
        0.25 + 0.35 * strategy + 0.25 * combat,
        0.05,
        1.1,
      ),
      survivalInstinct: clamp(
        0.4 + 0.4 * recovery + 0.25 * efficiency + 0.15 * risk,
        0.2,
        1.35,
      ),
      fertilityUrge: clamp(
        0.3 + 0.45 * fertility + 0.3 * parental + 0.2 * activity - 0.15 * risk,
        0.15,
        1.3,
      ),
      movementActions: {
        rest: clamp((movement?.cautious || 0) / moveTotal, 0, 1),
        pursue: clamp((movement?.pursuit || 0) / moveTotal, 0, 1),
        avoid: clamp(
          ((movement?.cautious || 0) + (interaction?.avoid || 0)) /
            Math.max(0.0001, moveTotal + interactionTotal),
          0,
          1,
        ),
        cohere: clamp(0.2 + 0.6 * cohesion, 0, 1),
        explore: clamp((movement?.wandering || 0) / moveTotal, 0, 1),
      },
      interactionActions: {
        avoid: clamp((interaction?.avoid || 0) / interactionTotal, 0, 1),
        fight: clamp((interaction?.fight || 0) / interactionTotal, 0, 1),
        cooperate: clamp((interaction?.cooperate || 0) / interactionTotal, 0, 1),
      },
      targetingFocus: {
        weak: clamp((conflict?.weak || 0) / conflictTotal, 0, 1),
        strong: clamp((conflict?.strong || 0) / conflictTotal, 0, 1),
        proximity: clamp((conflict?.proximity || 0) / conflictTotal, 0, 1),
        attrition: clamp((conflict?.attrition || 0) / conflictTotal, 0, 1),
      },
      opportunity: {
        assimilation: opportunityAssimilation,
        decay: opportunityDecay,
        positiveWeight: opportunityPositiveWeight,
        negativeWeight: opportunityNegativeWeight,
        volatility: opportunityVolatility,
        baseline: opportunityBaseline,
        synergyWeight: opportunitySynergy,
        groupWeights: opportunityGroupWeights,
      },
    };
  }

  riskMemoryProfile() {
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const cohesion = this.geneFraction(GENE_LOCI.COHESION);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const foraging = this.geneFraction(GENE_LOCI.FORAGING);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);

    const assimilation = clamp(
      0.16 + 0.28 * neural + 0.18 * sense - 0.12 * risk,
      0.04,
      0.6,
    );
    const decay = clamp(0.08 + 0.22 * strategy + 0.18 * recovery, 0.02, 0.5);
    const resourceWeight = clamp(
      0.25 + 0.35 * foraging + 0.25 * exploration - 0.2 * risk,
      0.1,
      0.9,
    );
    const scarcityDrive = clamp(
      0.32 + 0.4 * risk + 0.22 * movement - 0.18 * cooperation,
      0.1,
      1.1,
    );
    const eventWeight = clamp(
      0.28 + 0.42 * risk + 0.25 * sense - 0.18 * recovery,
      0.05,
      1.2,
    );
    const socialWeight = clamp(
      0.22 + 0.45 * cooperation + 0.3 * cohesion - 0.25 * risk,
      0.05,
      1,
    );
    const fatigueWeight = clamp(
      0.2 + 0.35 * recovery + 0.2 * neural - 0.18 * activity,
      0.05,
      0.9,
    );
    const confidenceWeight = clamp(
      0.2 + 0.35 * strategy + 0.25 * movement - 0.3 * risk + 0.15 * combat,
      0,
      0.9,
    );

    return {
      assimilation,
      decay,
      resourceWeight,
      scarcityDrive,
      eventWeight,
      socialWeight,
      fatigueWeight,
      confidenceWeight,
    };
  }

  combatLearningProfile() {
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);

    return {
      baseAssimilation: clamp(
        0.22 + 0.34 * neural + 0.28 * combat - 0.18 * risk,
        0.05,
        0.85,
      ),
      successAmplifier: clamp(0.35 + 0.4 * combat + 0.22 * strategy, 0.1, 1.1),
      failureAmplifier: clamp(
        0.4 + 0.45 * risk + 0.24 * (1 - recovery) + 0.15 * (1 - strategy),
        0.15,
        1.2,
      ),
      gainInfluence: clamp(0.25 + 0.35 * strategy + 0.22 * neural, 0.05, 0.85),
      kinshipPenaltyWeight: clamp(0.2 + 0.35 * cooperation + 0.25 * parental, 0.05, 1),
      threatWeight: clamp(0.25 + 0.4 * strategy + 0.2 * combat, 0.05, 1.15),
      weaknessWeight: clamp(0.28 + 0.35 * combat + 0.22 * strategy, 0.05, 1.15),
      attritionWeight: clamp(
        0.2 + 0.32 * strategy + 0.26 * (1 - cooperation),
        0.05,
        1.1,
      ),
      proximityWeight: clamp(0.18 + 0.35 * movement + 0.2 * strategy, 0.05, 1.05),
      riskFlexWeight: clamp(0.32 + 0.36 * strategy + 0.24 * recovery, 0.1, 1.25),
    };
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
    const baseline =
      base * (Math.max(0, baselineNeurons) + 0.5 * normalizedSight) * densityFactor;
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

  neuralFatigueProfile() {
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const activity = this.geneFraction(GENE_LOCI.ACTIVITY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const density = this.geneFraction(GENE_LOCI.DENSITY);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);

    const baseline = clamp(
      0.22 + 0.28 * (1 - recovery) + 0.18 * (1 - neural),
      0.05,
      0.75,
    );
    const loadCapacity = clamp(
      0.6 + 0.8 * neural + 0.3 * activity - 0.25 * (1 - recovery),
      0.35,
      1.75,
    );
    const stressGain = clamp(0.18 + 0.5 * risk + 0.35 * (1 - recovery), 0.05, 0.95);
    const recoveryRate = clamp(
      0.14 + 0.55 * recovery + 0.2 * strategy - 0.18 * risk,
      0.05,
      0.8,
    );
    const densitySensitivity = clamp(
      0.15 + 0.45 * density - 0.15 * recovery,
      0.05,
      0.7,
    );
    const restThreshold = clamp(0.3 + 0.35 * (1 - activity) + 0.2 * parental, 0.1, 0.9);
    const fatigueRiskWeight = clamp(0.32 + 0.45 * risk - 0.25 * recovery, 0.15, 0.9);
    const restRiskBonus = clamp(
      0.12 + 0.3 * activity + 0.25 * strategy - 0.18 * risk,
      0,
      0.6,
    );
    const restEfficiency = clamp(
      0.3 + 0.5 * recovery + 0.2 * strategy - 0.25 * activity + 0.15 * parental,
      0.1,
      1.3,
    );

    return {
      baseline,
      loadCapacity,
      stressGain,
      recoveryRate,
      densitySensitivity,
      restThreshold,
      fatigueRiskWeight,
      restRiskBonus,
      restEfficiency,
    };
  }

  // Reproduction energy threshold as a fraction of max tile energy
  reproductionThresholdFrac() {
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    let threshold =
      0.2 + 0.25 * (1 - efficiency) + 0.16 * fertility - 0.08 * cooperation;

    return clamp(threshold, 0.16, 0.7);
  }

  reproductionReachProfile() {
    const courtship = this.geneFraction(GENE_LOCI.COURTSHIP);
    const cohesion = this.geneFraction(GENE_LOCI.COHESION);
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);

    const rawBase =
      1.15 +
      courtship * 0.75 +
      cohesion * 0.35 +
      sense * 0.25 +
      exploration * 0.25 +
      parental * 0.15 -
      risk * 0.4 -
      (1 - efficiency) * 0.15;
    const base = clamp(rawBase, 0.6, 3.5);
    const min = clamp(0.85 + parental * 0.2, 0.5, base);
    const max = clamp(Math.max(base, 1.3 + courtship * 1.1 + cohesion * 0.6), base, 4);
    const densityPenalty = clamp(0.2 + (1 - cohesion) * 0.5 + risk * 0.35, 0.05, 1.2);
    const energyBonus = clamp(0.25 + parental * 0.35 + courtship * 0.25, 0, 1.2);
    const scarcityBoost = clamp(0.15 + exploration * 0.35 + sense * 0.25, 0, 1);
    const affinityWeight = clamp(0.12 + courtship * 0.35 - risk * 0.1, 0, 0.7);

    return {
      base,
      min,
      max,
      densityPenalty,
      energyBonus,
      scarcityBoost,
      affinityWeight,
    };
  }

  conflictFocus() {
    const rng = this.prngFor("conflictFocus");
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const combat = this.geneFraction(GENE_LOCI.COMBAT);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const movement = this.geneFraction(GENE_LOCI.MOVEMENT);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const jitter = () => (rng() - 0.5) * 0.2;

    const weak = clamp(
      0.4 + 0.6 * (1 - risk) + 0.3 * strategy - 0.2 * combat + jitter(),
      0.1,
      1.6,
    );
    const strong = clamp(
      0.3 + 0.7 * risk + 0.4 * combat - 0.2 * strategy + jitter(),
      0.1,
      1.6,
    );
    const proximity = clamp(
      0.35 + 0.5 * (1 - movement) + 0.2 * cooperation + jitter(),
      0.1,
      1.6,
    );
    const attrition = clamp(
      0.3 + 0.5 * movement + 0.2 * (1 - cooperation) + jitter(),
      0.1,
      1.6,
    );

    return { weak, strong, proximity, attrition };
  }

  cooperationProfile() {
    const rng = this.prngFor("cooperationProfile");
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const parental = this.geneFraction(GENE_LOCI.PARENTAL);
    const efficiency = this.geneFraction(GENE_LOCI.ENERGY_EFFICIENCY);
    const recovery = this.geneFraction(GENE_LOCI.RECOVERY);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const cohesion = this.geneFraction(GENE_LOCI.COHESION);
    const jitter = (rng() - 0.5) * 0.1;

    const base = clamp(
      0.18 + 0.45 * cooperation + 0.2 * parental - 0.12 * risk + jitter,
      0.08,
      0.75,
    );
    const min = clamp(base * (0.35 + 0.25 * efficiency), 0.02, base);
    const max = clamp(
      base + 0.25 * cooperation + 0.2 * efficiency + 0.1 * recovery,
      base,
      0.95,
    );
    const energyBias = clamp(0.3 + 0.4 * parental + 0.2 * (1 - efficiency), 0, 1);
    const kinBias = clamp(0.2 + 0.5 * cohesion + 0.2 * cooperation - 0.2 * risk, 0, 1);

    return { base, min, max, energyBias, kinBias };
  }

  // Cooperation share fraction of current energy
  cooperateShareFrac(context = {}) {
    const profile = this.cooperationProfile();

    if (!profile) {
      return 0.2 + 0.4 * this.geneFraction(GENE_LOCI.COOPERATION);
    }

    const { energyDelta = 0, kinship = 0 } = context || {};
    const deficitSignal = clamp(-energyDelta, -1, 1);
    const kinSignal = clamp(kinship, 0, 1);
    const adjustment =
      deficitSignal * profile.energyBias * 0.5 + kinSignal * profile.kinBias * 0.3;
    const share = profile.base + adjustment;

    return clamp(share, profile.min, profile.max);
  }

  strategy() {
    const rnd = this.prngFor("strategy");
    const anchor = this.geneFraction(GENE_LOCI.STRATEGY);

    return clamp(anchor * 0.7 + rnd() * 0.3, 0, 1); // 0..1
  }

  strategyDriftRange() {
    const mutationSpan = this.geneFraction(GENE_LOCI.MUTATION_RANGE);
    const courtship = this.geneFraction(GENE_LOCI.COURTSHIP);
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const base = 0.05 + 0.4 * mutationSpan;
    const openness = 0.2 * courtship + 0.15 * neural;
    const restraint = 0.25 * strategy;

    return clamp(base + openness - restraint, 0.02, 0.8);
  }

  inheritStrategy(parentStrategies = [], { fallback = null } = {}) {
    const rng = this.prngFor("inheritStrategy");
    const sanitized = Array.isArray(parentStrategies)
      ? parentStrategies.filter((value) => Number.isFinite(value))
      : [];
    const anchor = this.strategy();
    const fallbackValue = Number.isFinite(fallback) ? clamp(fallback, 0, 1) : anchor;
    const parentAvg =
      sanitized.length > 0
        ? sanitized.reduce((sum, value) => sum + clamp(value, 0, 1), 0) /
          sanitized.length
        : fallbackValue;
    const courtship = this.geneFraction(GENE_LOCI.COURTSHIP);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const strategyGene = this.geneFraction(GENE_LOCI.STRATEGY);
    const heritageWeight = clamp(
      0.25 + 0.35 * courtship + 0.2 * exploration - 0.3 * strategyGene,
      0.1,
      0.8,
    );
    const drift = (rng() - 0.5) * this.strategyDriftRange();
    const combined = anchor * (1 - heritageWeight) + parentAvg * heritageWeight + drift;

    return clamp(combined, 0, 1);
  }

  // Preference (-1..1) for genetic similarity in mates. Positive -> likes similar, negative -> seeks diversity.
  mateSimilarityBias() {
    const rnd = this.prngFor("mateSimilarityBias");
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
    const rnd = this.prngFor("diversityAppetite");
    const g = this.g / 255;
    const b = this.b / 255;
    const bias = this.mateSimilarityBias();
    const courtship = this.geneFraction(GENE_LOCI.COURTSHIP);
    const curiosityBase = 0.22 + 0.35 * b + 0.28 * courtship; // bluer and courtship-heavy genomes are curious
    const efficiencyBrake = 0.18 * g + 0.07 * (1 - courtship); // greener genomes conserve effort; low courtship tempers swings
    const jitter = (rnd() - 0.5) * (0.25 + 0.15 * courtship);
    let appetite = curiosityBase - efficiencyBrake + jitter;

    // Strong homophily dampens curiosity, heterophily boosts it with courtship modulation
    appetite += Math.max(0, -bias) * (0.35 + 0.25 * courtship);
    appetite -= Math.max(0, bias) * (0.25 + 0.2 * (1 - courtship));

    return clamp(appetite, 0, 1);
  }

  mateSamplingProfile() {
    const rng = this.prngFor("mateSamplingProfile");
    const courtship = this.geneFraction(GENE_LOCI.COURTSHIP);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const sense = this.geneFraction(GENE_LOCI.SENSE);
    const risk = this.geneFraction(GENE_LOCI.RISK);

    const curiosityBase = 0.04 + 0.45 * courtship + 0.25 * exploration + 0.1 * risk;
    const cautionBrake =
      0.15 * (1 - fertility) + 0.12 * (1 - cooperation) + 0.15 * strategy;
    const curiosityChance = clamp(
      curiosityBase - cautionBrake + (rng() - 0.5) * 0.08,
      0.01,
      0.8,
    );

    const tailBase = 0.15 + 0.5 * courtship + 0.2 * exploration;
    const tailModeration = 0.25 * strategy + 0.1 * (1 - sense);
    const tailFraction = clamp(
      tailBase - tailModeration + (rng() - 0.5) * 0.1,
      0.05,
      0.75,
    );

    const preferenceSoftening = clamp(
      0.6 + 0.8 * courtship + 0.3 * cooperation - 0.5 * strategy,
      0.3,
      2.4,
    );
    const selectionJitter = clamp(
      0.03 + 0.4 * courtship - 0.25 * strategy + (rng() - 0.5) * 0.08,
      0,
      0.5,
    );
    const noveltyWeight = clamp(
      -0.1 + 0.6 * courtship + 0.25 * exploration - 0.2 * strategy,
      -0.4,
      0.6,
    );
    const fallbackNoveltyBias = clamp(
      -0.15 + 0.7 * courtship + 0.3 * exploration - 0.25 * strategy,
      -0.5,
      0.65,
    );
    const fallbackStabilityWeight = clamp(
      0.25 + 0.45 * fertility + 0.25 * cooperation - 0.4 * exploration,
      0.05,
      0.9,
    );
    const fallbackNoise = clamp(
      0.04 + 0.35 * courtship - 0.2 * strategy + 0.1 * (1 - sense),
      0.02,
      0.4,
    );

    return {
      curiosityChance,
      tailFraction,
      preferenceSoftening,
      selectionJitter,
      noveltyWeight,
      fallbackNoveltyBias,
      fallbackStabilityWeight,
      fallbackNoise,
    };
  }

  mateAffinityPlasticityProfile() {
    const courtship = this.geneFraction(GENE_LOCI.COURTSHIP);
    const cooperation = this.geneFraction(GENE_LOCI.COOPERATION);
    const strategy = this.geneFraction(GENE_LOCI.STRATEGY);
    const neural = this.geneFraction(GENE_LOCI.NEURAL);
    const exploration = this.geneFraction(GENE_LOCI.EXPLORATION);
    const risk = this.geneFraction(GENE_LOCI.RISK);
    const fertility = this.geneFraction(GENE_LOCI.FERTILITY);

    const assimilation = clamp(
      0.18 + 0.32 * courtship + 0.18 * neural - 0.2 * strategy,
      0.05,
      0.8,
    );
    const successWeight = clamp(
      0.35 + 0.4 * cooperation + 0.2 * fertility + 0.15 * courtship,
      0.1,
      1.2,
    );
    const penaltyWeight = clamp(
      0.25 + 0.45 * strategy + 0.2 * risk + 0.15 * (1 - cooperation),
      0.05,
      1.4,
    );
    const opportunityWeight = clamp(
      0.2 + 0.45 * exploration + 0.25 * courtship - 0.25 * strategy,
      0,
      1.2,
    );
    const complementWeight = clamp(
      0.2 + 0.35 * cooperation + 0.2 * neural - 0.15 * risk,
      0,
      1.1,
    );
    const gainInfluence = clamp(
      0.18 + 0.35 * neural + 0.2 * cooperation - 0.18 * strategy,
      0.05,
      0.9,
    );
    const retention = clamp(
      0.55 + 0.25 * strategy + 0.15 * neural - 0.2 * courtship,
      0.25,
      0.92,
    );

    return {
      assimilation,
      successWeight,
      penaltyWeight,
      opportunityWeight,
      complementWeight,
      gainInfluence,
      retention,
    };
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

  reproduceWith(
    other,
    mutationChance = MUTATION_CHANCE_BASELINE,
    mutationRange = 12,
    rngOverride,
  ) {
    const parentSeed = (this.seed() ^ (other?.seed?.() ?? 0)) >>> 0;
    let rng = null;

    if (typeof rngOverride === "function") {
      rng = rngOverride;
    } else {
      let sharedEntropy = 0;

      if (typeof this.sharedRng === "function") {
        const shared = this.sharedRng(other, "offspringMix");

        if (typeof shared === "function") {
          sharedEntropy = Math.floor(shared() * 0xffffffff) >>> 0;
        }
      }

      const runtimeEntropy = Math.floor(Math.random() * 0xffffffff) >>> 0;

      rng = createRNG((parentSeed ^ sharedEntropy ^ runtimeEntropy) >>> 0);
    }
    const blendA = typeof this.crossoverMix === "function" ? this.crossoverMix() : 0.5;
    const blendB =
      typeof other?.crossoverMix === "function" ? other.crossoverMix() : 0.5;
    const blendProbability = clamp((blendA + blendB) / 2, 0, 1);
    const range = Math.max(0, mutationRange | 0);
    const geneCount = Math.max(
      this.length,
      other?.length ?? 0,
      DEFAULT_TOTAL_GENE_COUNT,
    );

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

  similarity(other, options = {}) {
    if (!other) return 0;

    const { squared = false, inverseMaxDistance } = options ?? {};
    const selfGenes = this.#genesTarget;
    const selfLength = selfGenes.length;
    const otherObject = typeof other === "object" && other !== null ? other : null;
    const otherLength =
      typeof otherObject?.length === "number"
        ? otherObject.length
        : (otherObject?.genes?.length ?? 0);
    const geneCount = Math.max(selfLength, otherLength);

    if (geneCount === 0) {
      return 1;
    }

    const directGenes =
      other instanceof DNA
        ? other.#genesTarget
        : other instanceof Uint8Array
          ? other
          : otherObject?.genes instanceof Uint8Array
            ? otherObject.genes
            : Array.isArray(other)
              ? other
              : Array.isArray(otherObject?.genes)
                ? otherObject.genes
                : null;
    const fallbackGenes = !directGenes && otherObject?.genes ? otherObject.genes : null;
    const fallbackGeneAt =
      !directGenes && typeof otherObject?.geneAt === "function"
        ? otherObject.geneAt.bind(otherObject)
        : null;

    let distSq = 0;

    if (directGenes) {
      const otherLen = directGenes.length;

      for (let i = 0; i < geneCount; i++) {
        const a = i < selfLength ? selfGenes[i] : 0;
        const b = i < otherLen ? directGenes[i] : 0;
        const delta = a - b;

        distSq += delta * delta;
      }
    } else {
      const fallbackLen =
        fallbackGenes && typeof fallbackGenes.length === "number"
          ? fallbackGenes.length
          : 0;

      for (let i = 0; i < geneCount; i++) {
        const a = i < selfLength ? selfGenes[i] : 0;
        let b = 0;

        if (fallbackGeneAt) {
          const candidate = fallbackGeneAt(i);

          if (Number.isFinite(candidate)) {
            b = candidate;
          } else if (i < fallbackLen) {
            b = fallbackGenes[i];
          }
        } else if (i < fallbackLen) {
          b = fallbackGenes[i];
        }

        const delta = a - (Number.isFinite(b) ? b : 0);

        distSq += delta * delta;
      }
    }

    const invMax =
      typeof inverseMaxDistance === "number" && Number.isFinite(inverseMaxDistance)
        ? inverseMaxDistance
        : this.#resolveInverseMaxDistance(geneCount);

    if (squared) {
      const invMaxSq = invMax * invMax;

      return 1 - distSq * invMaxSq;
    }

    const dist = Math.sqrt(distSq);

    return 1 - dist * invMax;
  }
}

export default DNA;
