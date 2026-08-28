# Performance and scalability

## Dense-population profile

The canonical stress case is the headless `SimulationEngine` benchmark in
[`scripts/profile-energy.mjs`](../scripts/profile-energy.mjs). It seeds 65% of
a 60×60 world (2,340 organisms), warms up for 20 ticks, then measures 30 ticks
with the fixed seed `424242`:

```sh
PERF_INCLUDE_SIM=1 \
PERF_SIM_ROWS=60 PERF_SIM_COLS=60 PERF_SIM_DENSITY=0.65 \
PERF_SIM_WARMUP=20 PERF_SIM_ITERATIONS=30 \
pnpm run benchmark
```

On the same Node 25/macOS process, the dense simulation path measured:

| Path                               |  Trimmed mean |      Raw mean | Seeded population |
| ---------------------------------- | ------------: | ------------: | ----------------: |
| Before bounded neural mate scoring | 86.60 ms/tick | 92.26 ms/tick |             2,340 |
| After bounded neural mate scoring  | 63.18 ms/tick | 67.06 ms/tick |             2,340 |

That is a 27.0% reduction in trimmed tick time and a 27.3% reduction in raw
tick time. The final population was 532 before and 529 after; this small
trajectory difference is expected because the optimization changes which
candidates receive expensive neural affinity evaluation, while retaining
DNA-derived scoring and neural influence for the bounded candidate budget.
Measurements are hardware- and runtime-specific; compare medians from fresh
processes rather than treating these values as a universal guarantee.

A subsystem profile of the same workload identified `handleReproduction` and
its neural mate previews as the dominant CPU path after energy preparation.
Before the change, every selected candidate could trigger a full reproduction
network preview. `Cell.scorePotentialMates` now performs cheap genome-based
scoring across the capped mate pool and evaluates neural affinity for at most
four nearest candidates per decision. This makes neural mate-selection work
O(1) per organism with respect to the visible candidate pool instead of scaling
with its full width, without removing genome-driven or neural behaviour.

## Runtime architecture

The simulation and presentation loops are separate budgets:

- `GridManager.update` owns simulation state transitions and is measured by the
  headless benchmark.
- `SimulationEngine` advances the simulation at the configured update cadence.
- Rendering is demand-driven: a normal animation frame that did not advance a
  simulation tick does not redraw the grid or overlays. Explicit `tick`,
  `step`, and `requestFrame` calls still render so inspectors and paused UI
  controls remain responsive.
- Grid rendering uses the existing dirty-tile/ImageData path where available;
  the browser should not pay a full cell traversal for an idle animation frame.

This split prevents a low updates-per-second configuration or a paused tab from
spending the render budget repeatedly painting unchanged state.

## Profiling guidance

Use `node --cpu-prof` around the benchmark when investigating a regression. The
important dense-world questions are:

1. Is energy preparation still proportional to the grid area rather than the
   population?
2. Is target discovery bounded by the spatial occupancy index rather than
   scanning empty tiles?
3. Is neural work bounded per organism and candidate budget?
4. Are rendering and overlay work skipped when no state changed?
5. Are new allocations retained across the tick, causing garbage collection to
   dominate the profile?

Do not loosen performance thresholds to make a profile pass. Fix the owning
phase, rerun the fixed-seed benchmark, and record the scenario and runtime with
any future change.
