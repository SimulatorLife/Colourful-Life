import { clamp } from "./utils.js";

const INTERACTION_KEYS = ["cooperate", "fight", "avoid"];

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

  for (const key of INTERACTION_KEYS) {
    const valueA = normalizeInteractionGene(genesA, key);
    const valueB = normalizeInteractionGene(genesB, key);

    if (valueA == null || valueB == null) continue;

    sum += Math.abs(valueA - valueB);
    count++;
  }

  if (count === 0) return 0;

  return clamp(sum / count, 0, 1);
}

export default computeBehaviorComplementarity;
