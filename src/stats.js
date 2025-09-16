export default class Stats {
  constructor(historySize = 200) {
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
  updateFromGrid(grid) {
    this.totals.ticks++;
    let pop = 0;
    let energySum = 0;
    let ageSum = 0;
    const cells = [];

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cell = grid.getCell(r, c);

        if (cell) {
          pop++;
          energySum += cell.energy;
          ageSum += cell.age;
          cells.push(cell);
        }
      }
    }
    const meanEnergy = pop ? energySum / pop : 0;
    const meanAge = pop ? ageSum / pop : 0;
    const diversity = this.estimateDiversity(cells);

    this.pushHistory('population', pop);
    this.pushHistory('diversity', diversity);
    this.pushHistory('energy', meanEnergy);
    this.pushHistory('growth', this.births - this.deaths);

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
    };
  }

  logEvent(event, multiplier = 1) {
    const s = event ? (event.strength || 0) * multiplier : 0;

    this.pushHistory('eventStrength', s);
  }

  pushHistory(key, value) {
    const arr = this.history[key];

    arr.push(value);
    if (arr.length > this.historySize) arr.shift();
  }
}
