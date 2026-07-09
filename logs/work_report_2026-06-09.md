# DeepGraph WebGPU Sandbox - Work Report
**Date:** 2026-06-09

## Overview
Today's session focused on addressing performance bottlenecks and visual anomalies in the WebGPU-based deepgraph rendering engine, specifically targeting the `TileManager` quadtree loading logic and `Scatterplot` shader blending. 

While several experimental architectures were explored, we ultimately determined that the added complexity introduced unacceptable regressions, prompting a clean rollback to our last stable checkpoint on GitHub.

## Key Areas Explored

### 1. Dynamic LOD Thresholding & The Queue Penalty
**The Goal:** We attempted to tame the exponential $4^n$ explosion of tile requests by introducing a negative feedback loop to the quadtree traversal. The idea was to monitor `pendingRequests.size` and artificially raise the Screen Space Error (SSE) threshold (a "queue penalty") when the Web Workers became saturated.
**The Result:** While mathematically elegant in theory, this created an artificial serialization bottleneck. The quadtree stopped subdividing at shallow zoom levels (e.g., Z=5), completely starving the deeper, high-resolution levels (Z=10). This destroyed the parallel fetching architecture and caused deep zoom operations to stall indefinitely.

### 2. Aggressive Network Abort Thrashing
**The Goal:** To conserve bandwidth, we tried aggressively aborting network requests for tiles that had fallen out of the `desiredTiles` list due to camera panning.
**The Result:** Because the Dynamic LOD was constantly fluctuating the `desiredTiles` list based on network queue size rather than just camera frustum, tiles were endlessly entering and exiting the desired list. This led to a catastrophic thrashing loop where the engine would abort a fetch, clear the queue, immediately re-request the exact same tile, and repeat the cycle endlessly.

### 3. Additive Blending & The "Wall of Mud" Regression
**The Goal:** We intended to restore the visual clarity of the astronomical palette (deep space blue -> crisp white core -> deep red).
**The Result:** A misunderstanding of the color mapping led to the astronomical `vec3` constants being overwritten by hex values from a UI `warmPaletteColors` array. When combined with a bug where overlapping parent/child LOD tiles were no longer being unloaded from the GPU slots frame-by-frame, millions of massive, low-res points were additively blended on top of each other. This blew out the mathematical scale of the colors, rendering the visualization as a washed-out, orange/brown wall of mud.

## Resolution
Recognizing that the compounding regressions were moving us further away from a performant tiling system, we made the strategic decision to abandon the experimental Dynamic LOD and cache sync changes. 

We performed a `git reset --hard` back to commit `6cf1c66`, perfectly aligning the local environment with the stable state pushed to the `origin/main` GitHub repository.

## Next Steps
For future iterations on performance:
* Any LOD constraints should likely be decoupled from network queue sizes to avoid artificial serialization.
* Parent/child GPU tile unloading must be explicitly managed to prevent additive blending blowouts.
* Future quadtree rendering logic should be stress-tested carefully when introducing hysteresis or thresholding algorithms.
