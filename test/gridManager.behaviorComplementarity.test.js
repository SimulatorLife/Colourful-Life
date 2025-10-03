import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";
import { computeBehaviorComplementarity } from "../src/behaviorComplementarity.js";

const createCell = (genes = {}) => ({
  interactionGenes: { cooperate: 0.5, fight: 0.5, avoid: 0.5, ...genes },
});

test("computeBehaviorComplementarity averages absolute interaction differences", () => {
  const parentA = createCell({ cooperate: 1, fight: 0.1, avoid: 0.25 });
  const parentB = createCell({ cooperate: 0.2, fight: 0.8, avoid: 0.1 });

  const complementarity = computeBehaviorComplementarity(parentA, parentB);
  const expected = (0.8 + 0.7 + 0.15) / 3;

  assert.type(complementarity, "number");
  assert.ok(complementarity > 0);
  assert.ok(complementarity <= 1);
  approxEqual(complementarity, expected, 1e-9);
});

test("computeBehaviorComplementarity ignores missing or invalid genes", () => {
  const parentA = createCell({ cooperate: null, fight: "nan" });
  const parentB = createCell({ cooperate: 0.9, fight: 0.2, avoid: 0.9 });

  const complementarity = computeBehaviorComplementarity(parentA, parentB);

  approxEqual(complementarity, Math.abs(0.5 - 0.9), 1e-9);
});
