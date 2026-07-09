# Deepgraph WebGPU Successor: Project Summary
**Date:** June 9, 2026

This document serves as a comprehensive record of our architectural decisions, successful experiments, and remaining technical challenges in building a WebGPU-powered successor to deepscatter.

## What We Have Built (The Successes)

### 1. WebGPU Instanced Rendering Engine
We successfully transitioned from standard WebGL to a cutting-edge **WebGPU** backend using `three/tsl`. 
* **The Architecture:** By utilizing `instancedGeometry`, we drastically eliminated CPU-to-GPU memory transfer overhead. Instead of pushing millions of unique vertices, we push a single instance mesh (a point/circle) and use GPU node materials to apply spatial offsets `(x, y)` directly from Apache Arrow `Float32Array` buffers.
* **The Result:** We can comfortably render tens of millions of points at high framerates with practically zero CPU bottlenecking during the draw calls.

### 2. Streaming Apache Arrow Quadtree
We built a robust, network-first hierarchical Level-Of-Detail (LOD) manager that dynamically fetches `feather` tiles over HTTP.
* **Web Workers:** We correctly offloaded the heavy lifting. Apache Arrow decoding and buffer extraction happens entirely inside Web Workers, preventing the main UI thread from locking up when decompressing 50,000-point tiles.
* **Dynamic Bounding Boxes:** We resolved a massive bug where the initial Quadtree bounds were physically disconnected from the dataset. The engine now dynamically intercepts `0/0/0.feather`, extracts the true global bounds (e.g., `[-180, 180]`), and instantly regenerates the spatial tree, allowing for flawless spatial frustum culling.

### 3. Foveated Tie-Breaker BFS (The 200-Tile Budget)
To prevent the GPU from memory-crashing when zooming deeply into densely populated datasets (like the Milky Way), we engineered a highly specialized LOD traversal algorithm.
* **Strict Budgets:** The engine never requests or renders more than 200 tiles per frame.
* **Pure Breadth-First-Search:** We guarantee that shallow tiles (Z=0, Z=1) are loaded universally across the entire screen before any deep tiles are considered. This completely eliminated "black holes" in the map.
* **Foveated Distance:** When the budget is close to running out, the engine mathematically prioritizes tiles closest to the center of the camera. This creates a "Google Maps" effect—razor-sharp detail exactly where the user is looking, gracefully degrading to lower LODs at the far edges.

---

## Where We Are Struggling (The Challenges)

### 1. Network Throttling & Worker Saturation
While WebGPU renders fast, the network is agonizingly slow.
* When the Quadtree algorithm identifies 80 new tiles needed for a sudden zoom action, the browser instantly fires 80 parallel HTTP requests. 
* Browsers heavily throttle connections to the same domain (typically max 6 concurrent connections).
* **The Pain Point:** This creates a massive traffic jam. The Web Workers sit idle waiting for HTTP streams, and the visualizer appears to "stall" or load very slowly until the browser clears the connection queue.

### 2. Additive LOD Visual "Popping"
Unlike image-based maps where a high-res tile *replaces* a blurry tile, deepscatter datasets are **Additive**. 
* The root tile (`0/0/0`) contains a random 1% sample of the data. The next level (`1/0/0`) contains a *different* 1% sample.
* **The Pain Point:** When the engine successfully loads a new deep tile, 50,000 new dots instantaneously pop onto the screen with 100% opacity. This creates a visually jarring, flickering effect during zooms. We have not yet figured out how to inject temporal anti-aliasing or alpha-fading shaders to gracefully fade in the new data buffers over time.

### 3. Predictive Pre-fetching vs Strict Culling
Our Frustum Culling is currently *too* mathematically perfect.
* The engine only evaluates tiles that are explicitly inside the camera's rectangular view right now.
* **The Pain Point:** When the user aggressively pans the camera, they are panning into the void. The engine only requests the tiles *after* the user's camera has arrived there. We lack a "predictive collar" (an invisible buffer zone outside the screen) that secretly pre-fetches tiles the user is likely to pan towards.

### 4. Density Balancing & The "Horizontal Band" Artifact
Because we are plotting astronomical data, the density is not uniform. The Milky Way's galactic plane is millions of times denser than the polar regions.
* Our Quadtree budget evaluates screenspace error purely by tile width vs viewport height.
* **The Pain Point:** If a tile at the pole is physically sparse, it will still consume 1 full tile out of our 200-tile budget to render just 10 points. Meanwhile, a tile in the galactic plane consumes 1 tile to render 50,000 points. The algorithm is blind to point density, which occasionally results in horizontal banding where the LOD algorithm runs out of budget before accurately representing the vast emptiness of space.
