import { clamp, createRNG, randomRange, randomPercent } from './utils.js';

// Genome modeled as loci; currently r,g,b act as loci to preserve behavior
export class DNA {
  constructor(r, g, b) {
    this.r = r | 0;
    this.g = g | 0;
    this.b = b | 0;
  }

  static random(rng = Math.random) {
    return new DNA(Math.floor(rng() * 256), Math.floor(rng() * 256), Math.floor(rng() * 256));
  }

  toColor() {
    return `rgb(${this.r},${this.g},${this.b})`;
  }

  seed() {
    return (this.r | (this.g << 8) | (this.b << 16)) >>> 0;
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
    const r = this.r / 255;

    return r; // simple mapping
  }

  // Preference to exploit known good tiles vs explore (0..1)
  exploitationBias() {
    const g = this.g / 255;

    return g; // resource affinity biases exploitation
  }

  // Tendency to stay near allies (0..1)
  cohesion() {
    const b = this.b / 255;

    return b; // blue biases social cohesion
  }

  // Event recovery mitigation (0..1). Higher reduces event damage.
  recoveryRate() {
    const brightness = (this.r + this.g + this.b) / (3 * 255);

    return brightness; // brighter genomes recover better
  }

  // DNA-driven activity rate: how often a cell attempts actions per tick
  activityRate() {
    const brightness = (this.r + this.g + this.b) / (3 * 255);

    return 0.3 + 0.7 * brightness; // 0.3..1.0
  }

  // Fraction of current energy invested in offspring
  parentalInvestmentFrac() {
    const b = this.b / 255;

    return 0.2 + 0.5 * b; // 0.2..0.7
  }

  // How strongly aging increases maintenance costs and reduces fertility
  senescenceRate() {
    const b = this.b / 255;

    return 0.1 + 0.4 * (1 - b); // 0.1..0.5
  }

  // Combat effectiveness multiplier
  combatPower() {
    const r = this.r / 255;

    return 0.8 + 0.9 * r; // 0.8..1.7
  }

  // DNA-derived social thresholds
  allyThreshold() {
    // Bluer genomes prefer tighter kin groups
    const b = this.b / 255;

    return 0.5 + 0.4 * b; // 0.5..0.9
  }
  enemyThreshold() {
    // Redder genomes classify more as enemies (lower threshold)
    const r = this.r / 255;

    return 0.6 - 0.4 * r; // 0.2..0.6
  }

  reproductionProb() {
    const rnd = this.prngFor('reproductionProb');
    const r = this.r / 255;
    const g = this.g / 255;
    const b = this.b / 255;
    // Red contributes boldness, green steadies fertility, blue tempers boldness
    const boldness = clamp(0.55 * r + 0.25 * g + 0.2 * (1 - b), 0, 1);
    const synergy = clamp(0.35 * g + 0.35 * b + 0.3 * (1 - Math.abs(r - g)), 0, 1);
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
    const brightness = (this.r + this.g + this.b) / (3 * 255);

    return Math.max(0.5, Math.min(maxEnergy, 0.5 + brightness * (maxEnergy - 0.5)));
  }

  lifespan(maxAge = 1000, minAge = 100) {
    const rnd = this.prngFor('lifespan');
    const base = 0.5 + (this.b / 255) * 0.5; // 0.5..1.0 of maxAge
    const lifespanAdj = ((this.b - 127.5) / 255) * 100;
    const v = Math.round(maxAge * (base * (0.95 + rnd() * 0.1))) + lifespanAdj;

    return Math.max(minAge, v);
  }

  floodResist() {
    return this.b / 255;
  }
  heatResist() {
    return this.r / 255;
  }
  droughtResist() {
    return this.g / 255;
  }
  coldResist() {
    return (this.g + this.b) / (2 * 255);
  }

  mutationChance() {
    const rnd = this.prngFor('mutationChance');

    return 0.08 + rnd() * 0.2; // 0.08..0.28
  }

  mutationRange() {
    const rnd = this.prngFor('mutationRange');

    return 6 + Math.floor(rnd() * 20); // 6..25
  }

  starvationThresholdFrac() {
    // Higher green -> better resource efficiency, lower threshold
    return 0.8 - (this.g / 255) * 0.6; // 0.2..0.8
  }

  neurons() {
    const rnd = this.prngFor('neurons');

    return Math.max(1, Math.floor(rnd() * 5) + 1);
  }

  sight() {
    const rnd = this.prngFor('sight');

    return Math.max(1, Math.floor(rnd() * 5) + 1);
  }

  baseEnergyLossScale() {
    const brightness = (this.r + this.g + this.b) / (3 * 255);

    return 0.5 + brightness; // 0.5..1.5 scale
  }

  // Lifespan derived solely from DNA, without external clamps
  lifespanDNA() {
    const rnd = this.prngFor('lifespan');
    const b = this.b / 255;
    // Blue channel biases toward longevity; add small noise
    const base = 300 + b * 900; // 300..1200
    const noise = (rnd() - 0.5) * 120; // +/-60
    const adj = this.lifespanAdj();

    return Math.max(10, Math.round(base + noise + adj));
  }

  // DNA-derived base energy loss per tick (before scale)
  energyLossBase() {
    // Greener genomes are more efficient
    const g = this.g / 255;

    return 0.015 + (1 - g) * 0.03; // ~0.015..0.045
  }

  // How efficiently a cell can harvest tile energy per tick (0.2..0.8)
  forageRate() {
    const g = this.g / 255;

    return 0.2 + 0.6 * g;
  }

  // Absolute caps (energy units per tick) for harvesting; DNA-driven
  harvestCapMin() {
    const b = this.b / 255;

    return 0.03 + 0.12 * b; // 0.03..0.15
  }
  harvestCapMax() {
    const g = this.g / 255;

    return 0.25 + 0.6 * g; // 0.25..0.85
  }

  // Energy cost characteristics for actions
  moveCost() {
    const b = this.b / 255;

    return 0.002 + 0.006 * b; // 0.002..0.008
  }
  fightCost() {
    const r = this.r / 255;

    return 0.01 + 0.03 * r; // 0.01..0.04
  }

  // Cognitive/perception cost based on neurons and sight
  cognitiveCost(neurons, sight, effDensity = 0) {
    const brightness = (this.r + this.g + this.b) / (3 * 255);
    const base = 0.0004 + 0.0008 * (1 - brightness); // efficient genomes pay less

    return base * (neurons + 0.5 * sight) * (0.5 + 0.5 * effDensity);
  }

  // Reproduction energy threshold as a fraction of max tile energy
  reproductionThresholdFrac() {
    const r = this.r / 255;
    const g = this.g / 255;
    const b = this.b / 255;
    const efficiency = clamp(0.45 * g + 0.25 * b, 0, 1);
    const ambition = clamp(0.4 * r + 0.2 * (1 - b), 0, 1);
    const cooperative = clamp(0.3 * b + 0.2 * g, 0, 1);
    let threshold = 0.28 + 0.3 * (1 - efficiency) + 0.18 * ambition - 0.08 * cooperative;

    return clamp(threshold, 0.22, 0.7);
  }

  // Cooperation share fraction of current energy
  cooperateShareFrac() {
    const b = this.b / 255;

    return 0.2 + 0.4 * b; // 0.2..0.6
  }

  strategy() {
    const rnd = this.prngFor('strategy');

    return rnd(); // 0..1
  }

  lifespanAdj() {
    return ((this.b - 127.5) / 255) * 100;
  }

  densityResponses() {
    const r = this.r / 255;
    const g = this.g / 255;
    const b = this.b / 255;
    const brightness = (this.r + this.g + this.b) / (3 * 255);

    const reproMax = 1.0 + g * 0.3;
    const reproMin = 0.3 + g * 0.4;
    const fightMin = 0.8 + r * 0.3;
    const fightMax = 1.3 + r * 0.9;
    const coopMax = 1.1 + b * 0.2;
    const coopMin = 0.5 + b * 0.4;
    const energyMin = 1.0 + brightness * 0.2;
    const energyMax = 1.1 + (1 - g) * 0.6;
    const cautiousMin = 1.0 + b * 0.2;
    const cautiousMax = 1.2 + b * 0.8;
    const pursuitMax = 1.0 + r * 0.2;
    const pursuitMin = 0.6 + (1 - b) * 0.4;
    const enemyBiasMin = 0.02 + r * 0.08;
    const enemyBiasMax = 0.2 + r * 0.5;

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

  reproduceWith(other, mutationChance = 0.15, mutationRange = 12) {
    // Per-locus blend with mutation; equivalent to previous behavior
    const mix = (a, b) => {
      let v = Math.round((a + b) / 2);

      if (randomPercent(mutationChance)) v += Math.floor(randomRange(-1, 1) * mutationRange);

      return Math.max(0, Math.min(255, v));
    };

    return new DNA(mix(this.r, other.r), mix(this.g, other.g), mix(this.b, other.b));
  }

  similarity(other) {
    const dx = this.r - other.r,
      dy = this.g - other.g,
      dz = this.b - other.b;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxDist = Math.sqrt(3 * 255 * 255);

    return 1 - dist / maxDist;
  }
}

export default DNA;
