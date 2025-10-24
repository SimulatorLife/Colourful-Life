import { assert, suite } from "#tests/harness";
import ReproductionZonePolicy from "../src/grid/reproductionZonePolicy.js";

const test = suite("ReproductionZonePolicy");

test("constructor and setter accept only object managers", () => {
  const initialManager = { label: "manager" };
  const policy = new ReproductionZonePolicy({ selectionManager: initialManager });

  assert.is(policy.getSelectionManager(), initialManager, "constructor sets manager");

  policy.setSelectionManager(null);
  assert.is(policy.getSelectionManager(), null, "null clears existing manager");

  policy.setSelectionManager(42);
  assert.is(
    policy.getSelectionManager(),
    null,
    "non-object assignments should be ignored",
  );

  const nextManager = { label: "next" };

  policy.setSelectionManager(nextManager);
  assert.is(policy.getSelectionManager(), nextManager, "valid manager is accepted");
});

test("hasActiveZones safely queries the attached selection manager", () => {
  const policy = new ReproductionZonePolicy();

  assert.is(policy.hasActiveZones(), false, "no manager means no active zones");

  policy.setSelectionManager({ hasActiveZones: () => true });
  assert.is(policy.hasActiveZones(), true, "truthy manager response is returned");

  policy.setSelectionManager({ hasActiveZones: () => false });
  assert.is(policy.hasActiveZones(), false, "falsey manager response propagates");

  policy.setSelectionManager({ hasActiveZones: "not-a-function" });
  assert.is(
    policy.hasActiveZones(),
    false,
    "non-callable hasActiveZones should be treated as inactive",
  );

  policy.setSelectionManager({});
  assert.is(
    policy.hasActiveZones(),
    false,
    "missing hasActiveZones also defaults to false",
  );

  const failure = new Error("failure");

  policy.setSelectionManager({
    hasActiveZones() {
      throw failure;
    },
  });

  assert.is(
    policy.hasActiveZones(),
    false,
    "exceptions from hasActiveZones fall back to false",
  );
});

test("validateArea forwards arguments and coerces invalid results", () => {
  const calls = [];
  const policy = new ReproductionZonePolicy({
    selectionManager: {
      validateReproductionArea(payload) {
        calls.push(payload);

        return { allowed: false, role: "parentB", reason: "denied" };
      },
    },
  });

  const query = {
    parentA: { row: 1, col: 1 },
    parentB: { row: 2, col: 2 },
    spawn: { row: 3, col: 3 },
  };

  assert.equal(policy.validateArea(query), {
    allowed: false,
    role: "parentB",
    reason: "denied",
  });
  assert.equal(calls, [query], "manager receives the same payload");

  policy.setSelectionManager({
    validateReproductionArea() {
      return "unexpected";
    },
  });
  assert.equal(
    policy.validateArea({ parentA: { row: 0, col: 0 } }),
    { allowed: true },
    "non-object responses are coerced into allow-all",
  );

  const error = new Error("boom");

  policy.setSelectionManager({
    validateReproductionArea() {
      throw error;
    },
  });
  assert.equal(
    policy.validateArea({ parentA: { row: 0, col: 0 } }),
    { allowed: true },
    "exceptions from the manager fall back to allow-all",
  );

  policy.setSelectionManager(null);
  assert.equal(
    policy.validateArea(),
    { allowed: true },
    "no manager defaults to allow-all",
  );
});

test("filterSpawnCandidates respects active zones and preserves fallbacks", () => {
  const policy = new ReproductionZonePolicy();

  assert.is(
    policy.filterSpawnCandidates(null),
    null,
    "non-arrays are returned directly",
  );
  const empty = [];

  assert.is(policy.filterSpawnCandidates(empty), empty, "empty arrays short-circuit");

  const candidates = [
    { r: 0, c: 0 },
    { r: 1, c: 1 },
    { r: 2, c: 2 },
  ];

  assert.is(
    policy.filterSpawnCandidates(candidates),
    candidates,
    "no manager means original candidates are preserved",
  );

  const manager = {
    activeCalls: 0,
    hasActiveZones() {
      this.activeCalls += 1;

      return true;
    },
    isInActiveZone(r, c) {
      assert.is(this, manager, "manager context is preserved");

      return c % 2 === 0;
    },
  };

  policy.setSelectionManager(manager);

  const filtered = policy.filterSpawnCandidates(candidates);

  assert.equal(filtered, [
    { r: 0, c: 0 },
    { r: 2, c: 2 },
  ]);

  const single = [{ r: 1, c: 1 }];
  const fallback = policy.filterSpawnCandidates(single);

  assert.is(
    fallback,
    single,
    "when filtering removes all candidates the original array is returned",
  );

  policy.setSelectionManager({
    hasActiveZones: () => false,
    isInActiveZone: () => false,
  });
  assert.is(
    policy.filterSpawnCandidates(candidates),
    candidates,
    "inactive zones skip filtering",
  );

  policy.setSelectionManager({ hasActiveZones: () => true });
  assert.is(
    policy.filterSpawnCandidates(candidates),
    candidates,
    "missing isInActiveZone method leaves candidates untouched",
  );

  const erroringManager = {
    hasActiveZones: () => true,
    isInActiveZone() {
      throw new Error("boom");
    },
  };

  policy.setSelectionManager(erroringManager);
  assert.is(
    policy.filterSpawnCandidates(candidates),
    candidates,
    "errors during zone membership checks preserve original candidates",
  );
});
