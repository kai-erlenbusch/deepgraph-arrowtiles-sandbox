# Critical Code & Performance Review: Deepgraph
_Date: June 29, 2026 13:38 PM_

Based on the goal of building a successor to Nomic's Deepscatter that can handle millions of points using PMTiles and Arrow, here is a critical review of the `deepgraph-arrowtiles-sandbox`.

## 🌟 Architecture Strengths

1. **Modern GPU Architecture (TSL + WebGPU):** Using Three.js's new node material system (TSL) to push the rendering logic entirely to the GPU is a huge win. Handling GAIA magnitude thresholds, color mixing (`bp_rp`), and time-based fading entirely in the vertex/fragment shaders ensures the CPU doesn't have to touch point updates.
2. **Object Pool (Slot) System:** Pre-allocating `maxTiles` (400) `InstancedBufferGeometry` meshes and swapping buffers in and out is the correct way to handle streaming point clouds without exploding VRAM or triggering constant garbage collection.
3. **Additive Quadtree Rendering:** The `PMTilesClient` correctly traverses from `Z=0` down to the target zoom, fetching all parents. This guarantees that base layers remain visible, preventing "popping" artifacts where dense lower-LOD layers suddenly disappear.

---

## 🏎️ Performance Bottlenecks (Frontend)

### 1. `Array.slice()` Memory Allocation on GPU Uploads
In `Scatterplot.ts` (`updateTiles`), when transferring the `Float32Array` buffers from the Web Worker into the Three.js Instanced Attributes, you are using `.slice()`:
```typescript
(ox.array as Float32Array).set(tile.xBuffer.slice(0, numItems));
```
> [!CAUTION]
> `.slice()` allocates a brand new `ArrayBuffer` on the heap and copies the data into it, just to be immediately copied again by `.set()`. When streaming dozens of tiles per frame during panning, this causes massive memory churn and Garbage Collection (GC) stuttering.

**Fix:** Use `.subarray(0, numItems)` which creates a zero-copy view over the existing buffer:
```typescript
(ox.array as Float32Array).set(tile.xBuffer.subarray(0, numItems));
```

### 2. Main-Thread Buffer Copying in `PMTilesClient`
In `parseArrowInWorker`, you do this before posting to the Web Worker:
```typescript
const copy = new Uint8Array(data);
this.worker.postMessage({ key, buffer: copy.buffer }, [copy.buffer]);
```
> [!WARNING]
> While this safely detaches the buffer for Transferable passing, creating a massive `Uint8Array` copy on the Main Thread for every single tile load blocks the UI thread. 

**Fix:** PMTiles provides a `getZxy()` response. If it comes from an HTTP Range Request, it's often already a distinct buffer. Instead of deep-copying on the main thread, try to pass the raw data directly if it doesn't share a buffer with the PMTiles internal cache, or find a way to slice the original `ArrayBuffer` without a deep copy if possible.

### 3. GPU Picking Render Target Lock
The GPU picking mechanism in `Scatterplot.ts` (packing the global ID into RGBA) is brilliant for exact point picking. However, doing a full scene render (even at 1x1 pixels) across 400 meshes on every `mousemove` will cripple your frame rate.

> [!TIP]
> Keep this disabled for hover, or throttle it to 100ms. For instant hover effects without rendering, consider building a spatial index (like a KD-Tree) inside the Web Worker for the currently visible tiles, and querying it via message passing for hover events.

---

## 🏗️ Data Pipeline Bottlenecks (`generate_pipeline.py`)

The pipeline does an amazing job orchestrating DuckDB and Arrow, but the core Additive LOD assignment ruins the performance benefits.

### The Single-Threaded Python Loop
You successfully stream data natively from DuckDB using PyArrow, but then you drop into a nested Python loop to process millions of points:
```python
for i in range(batch.num_rows):
    for z in range(max_zoom + 1):
        tid = t_cols[z][i]
        if capacities[(z, tid)] < max_capacity:
            capacities[(z, tid)] += 1
            # ... append to 6 separate python lists ...
```

> [!CAUTION]
> This loop is executing sequentially in single-threaded Python. Processing 1.8 Billion GAIA stars through this loop will take days. It completely bottlenecks the 40GB/s throughput that DuckDB and Parquet provide.

**Recommendation:** 
This is exactly why you were building the Rust `arrowtiles` extension! The `AdditiveAssignScalar` UDF you built in Rust is designed to replace this exact Python loop by running the capacity assignment in parallel C++ threads. Until the Rust extension is wired up to replace this loop, data generation will remain bottlenecked by Python's execution speed. 

Furthermore, appending to 6 separate native Python lists (`out_x.append()`) and then converting them *back* to Arrow arrays (`pa.array(out_x)`) introduces extreme memory overhead. If you must use Python, consider using Numba, Cython, or vectorized NumPy masks for this capacity assignment.
