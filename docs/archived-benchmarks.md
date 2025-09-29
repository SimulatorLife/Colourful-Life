# Archived Benchmark Scripts

The legacy Node-based benchmark scripts for density heatmap rendering and energy regeneration were removed because they were not referenced by the build, runtime, or test workflows. The overlays module now contains the optimized implementations that the rest of the application exercises directly, so keeping the standalone scripts caused duplicate logic without delivering additional coverage.
