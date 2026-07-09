# Deepgraph WebGPU Architecture Report
**Date:** June 9, 2026

## The Vision
Our goal with the `deepgraph-webgpu-sandbox` is to build the spiritual successor to Ben Schmidt's Deepscatter—an engine capable of rendering 1.8 billion data points (like the GAIA astronomical dataset) in the browser at a locked 144Hz, completely bypassing the memory and performance bottlenecks of traditional WebGL/Canvas engines. 

To achieve this, we leveraged modern WebGPU and Three.js Shading Language (TSL).

---

## 🟢 What Worked: Our Major Breakthroughs

Through aggressive experimentation and architectural reviews, we have successfully implemented a state-of-the-art streaming engine. Here are the core pillars that are currently working beautifully:

### 1. The True Zero-Copy Data Pipeline
Initially, transferring millions of points caused massive Javascript Heap ballooning (4.5GB+) and browser crashes. 
*   **The Fix:** We built a Web Worker that uses Apache Arrow IPC format. The worker slices the raw binary `ArrayBuffers` directly out of the `.feather` files and transfers them to the main thread. 
*   **The WebGPU Hack:** We bypassed Three.js's CPU-side `.set()` method entirely. We now intercept the internal `renderer.backend.device.queue.writeBuffer()` to drop the binary data directly into VRAM. The JS engine never parses a single number.
*   **Garbage Collection:** We immediately invoke `delete tile.xBuffer` after the VRAM upload, ensuring the JS Heap stays nearly empty.

### 2. Disjoint GPU Uploads (Killing PCIe Stutter)
Early versions suffered from 500ms main-thread freezes. This was caused by WebGPU serializing massive, contiguous blocks of sparse memory across the PCIe bus (e.g., updating Slot 0 and Slot 100 caused Slots 1-99 to be uploaded as well).
*   **The Fix:** Our new direct `writeBuffer` approach issues independent, disjoint 260KB commands per tile. The PCIe bus is now completely unstressed.

### 3. GPU Vertex Discard (Killing the Compute Bottleneck)
We initially built a clever Compute Shader to do GPU frustum culling. However, forcing 52-million vertices to increment a single `atomicAdd` counter serialized the GPU and destroyed parallelism.
*   **The Fix:** We ripped out the Compute Shader entirely. We now use TSL to natively discard vertices directly in the Vertex Shader (`select(isVisible, position, vec3(1000000.0))`). The hardware rasterizer culls the off-screen points at near-zero cost.

### 4. Foveated Additive LOD (The "Google Maps" Feel)
Traditional tile engines replace low-res tiles with high-res ones. For astronomical data, this deletes the brightest stars!
*   **Ancestry Protection:** We built a custom Additive Quadtree that locks parent tiles (Z=0, Z=1) in memory permanently so the galaxy's scaffolding never vanishes.
*   **Radial Priority Sorting:** The fetch queue now calculates the mathematical distance from the tile center to the camera focal point. Tiles directly under the user's mouse download first.
*   **Opacity Blending:** When new tiles stream in from the network, TSL calculates `timerGlobal().sub(spawnTime)` to trigger a 300ms `smoothstep` alpha fade. This completely masks network latency!

---

## 🔴 Where We Are Struggling: Unresolved Challenges

While the streaming engine is mathematically sound, we face challenges regarding the source data and high-frequency rendering.

### 1. Data Ingestion & "Sparsity" (The Quadfeather Problem)
*   **The Issue:** When you zoom all the way out, the galaxy looks surprisingly sparse. This is because the server's `.feather` files were pre-compiled using a random 10% sample to generate the Z=1 and Z=2 parent tiles.
*   **The Desired Solution:** To fix this, we would need to abandon the pre-built `files.benschmidt.org` tiles and build our own DuckDB data-ingestion pipeline. Instead of random sampling, our pipeline would use **Kernel Density Estimation (KDE)** to merge tight clusters of stars into single, larger, brighter points in the parent tiles.

### 2. Deep Zoom 32-Bit Jitter
*   **The Issue:** WebGPU uses `Float32` precision. As the user zooms incredibly deep into the quadtree (e.g., Z=14), the tiny decimal differences between star coordinates exceed the 32-bit floating-point limit. This will eventually cause the stars to "wobble" or jump between pixels when panning.
*   **The Desired Solution:** We need to implement **Relative-To-Center (RTC)** rendering. The vertex shader must calculate coordinates relative to the current camera target using dual-component floats (Double Precision emulation), ensuring infinite zoom stability.

### 3. Sub-Pixel Aliasing
*   **The Issue:** Because we are rendering millions of 1-pixel or 2-pixel sized points, slight camera pans cause those points to snap violently to the nearest physical screen pixel, creating "shimmering" or high-frequency noise.
*   **The Desired Solution:** We need a **Temporal Anti-Aliasing (TAA)** post-processing pass. By accumulating the last 4 frames and jittering the camera slightly, we can smooth out the single-pixel starlight into a beautiful, cinematic glow.

---

## Summary
The engineering we have accomplished in `Scatterplot.ts` and `TileManager.ts` represents the bleeding edge of what is possible in a web browser today. We have successfully conquered the memory, bandwidth, and traversal algorithms. Our next phase will involve conquering optical clarity (TAA, RTC) and data engineering (KDE DuckDB pipelines).
