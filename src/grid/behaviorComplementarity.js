import { clamp } from "../utils/math.js";

const INTERACTION_KEYS = ["cooperate", "fight", "avoid"];
const INTERACTION_KEY_COUNT = INTERACTION_KEYS.length;

function normalizeInteractionGene(genes, key) {
  if (!genes || typeof genes !== "object") return null;

  const raw = genes[key];

  if (raw == null) return null;

  const value = Number(raw);

  if (!Number.isFinite(value)) return null;

  return clamp(value, 0, 1);
}

function resolveInteractionGenes(candidate) {
  if (!candidate) return null;

  if (candidate.interactionGenes && typeof candidate.interactionGenes === "object") {
    return candidate.interactionGenes;
  }

  if (
    candidate.dna &&
    typeof candidate.dna === "object" &&
    typeof candidate.dna.interactionGenes === "function"
  ) {
    return candidate.dna.interactionGenes();
  }

  return null;
}

/**
 * Measures how dissimilar two organisms' interaction genes are, returning a
 * normalized complementarity score used to encourage diverse pairings.
 *
 * @param {Object} organismA - First organism with interaction genes.
 * @param {Object} organismB - Second organism with interaction genes.
 * @returns {number} Complementarity score between 0 (identical) and 1 (maximally different).
 */
export function computeBehaviorComplementarity(organismA, organismB) {
  if (!organismA || !organismB) return 0;

  const genesA = resolveInteractionGenes(organismA);
  const genesB = resolveInteractionGenes(organismB);

  if (!genesA || !genesB) return 0;

  let sum = 0;
  let count = 0;

  // Manual indexing avoids the temporary accumulator object created by Array.reduce,
  // trimming a small amount of overhead in this hot path invoked during each pairing
  // evaluation.
  for (let index = 0; index < INTERACTION_KEY_COUNT; index += 1) {
    const key = INTERACTION_KEYS[index];
    const valueA = normalizeInteractionGene(genesA, key);

    if (valueA == null) continue;

    const valueB = normalizeInteractionGene(genesB, key);

    if (valueB == null) continue;

    sum += Math.abs(valueA - valueB);
    count += 1;
  }

  if (count === 0) return 0;

  return clamp(sum / count, 0, 1);
}

export default computeBehaviorComplementarity;
