const TRAIT_KEYS = ['cooperation', 'fighting', 'breeding', 'sight'];
const TRAIT_THRESHOLD = 0.6;
const MAX_REPRODUCTION_PROB = 0.8;
const MAX_SIGHT_RANGE = 5;

const clamp01 = (value) => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;

  return value;
};

const createEmptyTraitSnapshot = () => {
  const averages = {};
  const fractions = {};
  const counts = {};

  for (let i = 0; i < TRAIT_KEYS.length; i++) {
    const key = TRAIT_KEYS[i];

    averages[key] = 0;
    fractions[key] = 0;
    counts[key] = 0;
  }

  return { population: 0, averages, fractions, counts };
};

export default class Stats {
  constructor(historySize = 10000) {
    this.historySize = historySize;
    this.resetTick();
    this.history = {
      population: [],
      diversity: [],
      energy: [],
      growth: [],
      eventStrength: [],
    };
    this.totals = { ticks: 0, births: 0, deaths: 0, fights: 0, cooperations: 0 };
    this.traitHistory = { presence: {}, average: {} };

    for (let i = 0; i < TRAIT_KEYS.length; i++) {
      const key = TRAIT_KEYS[i];

      this.traitHistory.presence[key] = [];
      this.traitHistory.average[key] = [];
    }

    this.traitPresence = createEmptyTraitSnapshot();
  }

  resetTick() {
    this.births = 0;
    this.deaths = 0;
    this.fights = 0;
    this.cooperations = 0;
  }

  onBirth() {
    this.births++;
    this.totals.births++;
  }
  onDeath() {
    this.deaths++;
    this.totals.deaths++;
  }
  onFight() {
    this.fights++;
    this.totals.fights++;
  }
  onCooperate() {
    this.cooperations++;
    this.totals.cooperations++;
  }

  // Sample mean pairwise distance between up to S pairs
  estimateDiversity(cells, S = 200) {
    const n = cells.length;

    if (n < 2) return 0;
    let samples = Math.min(S, (n * (n - 1)) / 2);
    let sum = 0;

    for (let i = 0; i < samples; i++) {
      const a = cells[(Math.random() * n) | 0];
      const b = cells[(Math.random() * n) | 0];

      if (a === b) {
        i--;
        continue;
      }
      sum += 1 - a.dna.similarity(b.dna); // distance in [0,1]
    }

    return sum / samples;
  }

  // Compute per-tick aggregates and push to history
  updateFromSnapshot(snapshot) {
    this.totals.ticks++;
    const pop = snapshot?.population || 0;
    const cells = snapshot?.cells || [];
    const meanEnergy = pop ? snapshot.totalEnergy / pop : 0;
    const meanAge = pop ? snapshot.totalAge / pop : 0;
    const diversity = this.estimateDiversity(cells);
    const traitPresence = this.computeTraitPresence(cells);

    this.pushHistory('population', pop);
    this.pushHistory('diversity', diversity);
    this.pushHistory('energy', meanEnergy);
    this.pushHistory('growth', this.births - this.deaths);

    this.traitPresence = traitPresence;
    for (let i = 0; i < TRAIT_KEYS.length; i++) {
      const key = TRAIT_KEYS[i];

      this.pushTraitHistory('presence', key, traitPresence.fractions[key]);
      this.pushTraitHistory('average', key, traitPresence.averages[key]);
    }

    return {
      population: pop,
      births: this.births,
      deaths: this.deaths,
      growth: this.births - this.deaths,
      fights: this.fights,
      cooperations: this.cooperations,
      meanEnergy,
      meanAge,
      diversity,
      traitPresence,
    };
  }

  logEvent(event, multiplier = 1) {
    const s = event ? (event.strength || 0) * multiplier : 0;

    this.pushHistory('eventStrength', s);
  }

  computeTraitPresence(cells = []) {
    const population = Array.isArray(cells) ? cells.length : 0;

    if (!population) return createEmptyTraitSnapshot();

    let coopSum = 0;
    let fightSum = 0;
    let breedSum = 0;
    let sightSum = 0;
    let coopActive = 0;
    let fightActive = 0;
    let breedActive = 0;
    let sightActive = 0;

    for (let i = 0; i < population; i++) {
      const cell = cells[i];

      if (!cell) continue;

      const interaction = cell.interactionGenes;
      const dna = cell.dna;

      let value =
        interaction && typeof interaction.cooperate === 'number' ? interaction.cooperate : 0;

      value = clamp01(value);
      coopSum += value;
      if (value >= TRAIT_THRESHOLD) coopActive++;

      value = interaction && typeof interaction.fight === 'number' ? interaction.fight : 0;
      value = clamp01(value);
      fightSum += value;
      if (value >= TRAIT_THRESHOLD) fightActive++;

      value = 0;
      if (dna && typeof dna.reproductionProb === 'function') {
        const prob = dna.reproductionProb();

        if (prob > 0) value = prob / MAX_REPRODUCTION_PROB;
      }
      value = clamp01(value);
      breedSum += value;
      if (value >= TRAIT_THRESHOLD) breedActive++;

      const sight = cell.sight || 0;

      value = sight > 0 ? sight / MAX_SIGHT_RANGE : 0;
      value = clamp01(value);
      sightSum += value;
      if (value >= TRAIT_THRESHOLD) sightActive++;
    }

    const invPop = 1 / population;

    return {
      population,
      averages: {
        cooperation: coopSum * invPop,
        fighting: fightSum * invPop,
        breeding: breedSum * invPop,
        sight: sightSum * invPop,
      },
      fractions: {
        cooperation: coopActive * invPop,
        fighting: fightActive * invPop,
        breeding: breedActive * invPop,
        sight: sightActive * invPop,
      },
      counts: {
        cooperation: coopActive,
        fighting: fightActive,
        breeding: breedActive,
        sight: sightActive,
      },
    };
  }

  pushHistory(key, value) {
    const arr = this.history[key];

    arr.push(value);
    if (arr.length > this.historySize) arr.shift();
  }

  pushTraitHistory(type, key, value) {
    const bucket = this.traitHistory?.[type]?.[key];

    if (!bucket) return;

    bucket.push(value);
    if (bucket.length > this.historySize) bucket.shift();
  }
}
