import { createRNG, randomRange, randomPercent } from './utils.js';

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

  reproductionProb() {
    const rnd = this.prngFor('reproductionProb');
    // Bias by green channel (resource affinity): 0.2..0.6
    const base = 0.2 + (this.g / 255) * 0.4;

    return Math.min(0.8, Math.max(0.05, base * (0.9 + rnd() * 0.2)));
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

  // How efficiently a cell can harvest tile energy per tick (0.2..0.8)
  forageRate() {
    const g = this.g / 255;

    return 0.2 + 0.6 * g;
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
