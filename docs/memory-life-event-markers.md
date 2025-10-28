# Life Event Marker Overlay Memory Profile

To validate the reduction in per-frame allocations when rendering life event markers, run the profiling script with forced garbage collection enabled:

```bash
node --expose-gc scripts/profile-life-event-markers-memory.mjs
```

On Node 20, the legacy implementation peaked roughly **1.20 MB** above baseline, while the pooled version stabilized around **1.00 MB**, a reduction of about **200 KB** in steady-state overhead per render pass.【7c32de†L1-L2】
