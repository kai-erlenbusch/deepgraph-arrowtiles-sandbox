# Deepgraph WebGPU Sandbox: Project Summary
**Date:** 2026-06-09

**Goal:** Create a 2D "Google Maps" style tiling system for complex scatter plots capable of scaling to billions of points (currently testing with the 1.8 Billion point ESA GAIA galaxy dataset).

---

## 🟢 What Has Worked (Our Successes)

### 1. WebGPU & Three.js TSL
Moving to WebGPU has given us the raw power needed for massive point clouds. Utilizing Three.js Node Materials (TSL) has allowed us to write elegant, low-level shader logic (like using `probDiscard` for stochastic sub-pixel anti-aliasing) without writing raw WGSL strings.

### 2. Apache Arrow IPC & Web Workers
Traditional JSON/CSV parsing crashes the browser. Fetching binary Apache Arrow (`.feather`) files inside a Web Worker and slicing the data straight out of the binary `ArrayBuffer` has successfully bypassed CPU-heavy parsing. Using Transferable Objects (`postMessage(data, [buffers])`) moves the memory to the main thread instantly.

### 3. Additive LOD (Level of Detail)
We successfully adopted Deepscatter's quadtree model. Instead of replacing low-res tiles with high-res ones, we use **Additive LOD**. Parent tiles contain the brightest/most salient stars, and child tiles are rendered *on top of* them. This guarantees that zooming in never mathematically erases the most important data points.

### 4. Vertex Discard over Compute Culling
We discovered that modern GPUs can easily process 20 million vertex invocations per frame. By mathematically moving out-of-bounds vertices to `vec3(1000000.0)` directly in the vertex shader, we effectively cull points without the massive overhead of a dispatch barrier.

### 5. "True Zero-Copy" WebGPU Bypass
We engineered a brilliant bypass for Three.js. Instead of copying data into a massive CPU-side `Float32Array` (which triggers heavy Garbage Collection), we access `renderer.backend.device.queue.writeBuffer()` to write the raw binary directly from the network to the GPU memory slot.

---

## 🔴 Where We Are Struggling (Our Bottlenecks)

### 1. PCIe Bus Blocking & Stuttering
Our initial implementation batched buffer updates across massive gaps (using `minUpdateOffset` to `maxUpdateOffset`). If we loaded Slot 0 and Slot 100, Three.js would send the entire 26 Megabyte block over the PCIe bus, causing severe UI stuttering during camera panning. We are actively refactoring this to use sparse, disjoint `writeBuffer` calls (260KB exactly per tile) to prevent bus saturation.

### 2. Compute Shader Atomic Contention
We attempted to build an advanced GPU Compute Shader to cull points, but using a global `atomicAdd` across 5 million points destroyed our performance. It forced thousands of parallel Streaming Multiprocessors (SMs) into a single-file line to increment a single variable, effectively turning our GPU into a slow, sequential CPU. We are ripping this out in favor of simple Vertex Discard.

### 3. Web Worker Memory Leaks
While we successfully use Transferable Objects to give memory to the main thread, the Apache Arrow JS library (`tableFromIPC`) holds internal references to memory. If the Web Worker does not explicitly garbage collect the Arrow `Table` objects after parsing, the worker slowly balloons in memory until the tab crashes (OOM).

### 4. Javascript Garbage Collection Pressure
Even small allocations add up. In `TileManager.ts`, recalculating the quadtree `getVisibleTiles()` by creating new arrays every frame causes GC micro-stutters. We are having to adapt to classic high-performance JS patterns (pre-allocating global arrays and tracking a `length` integer).

### 5. Camera Math Mismatch
Trying to use a `PerspectiveCamera` to build a 2D slippy map resulted in a nightmare of depth trigonometry, floating-point precision loss, and "Camera Target Drift" when zooming to the mouse. We are actively refactoring the renderer to use an `OrthographicCamera`, which provides perfectly linear frustum math.

---

### The Path Forward
Our `implementation_plan.md` has formally mapped out the fixes for the PCIe stuttering, the memory leaks, and the camera math. Once the coding agent executes these architectural changes, the sandbox should easily match Deepscatter's billion-point, 60 FPS standard.
