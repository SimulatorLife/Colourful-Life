# Rendering throughput boost

Profile the rendering layer—canvas draw loops, buffer swaps, observer updates, input handlers—and isolate a costly stage that slows frame throughput. Optimize that stage with clarity-preserving tweaks such as batching draws, reducing per-frame allocations, reusing contexts, or memoizing derived view models. Maintain separation between simulation logic and UI bindings, uphold accessibility guarantees, and share a before/after frame time sample or FPS measurement in the PR body.
