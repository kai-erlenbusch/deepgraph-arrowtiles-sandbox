# START_HERE: The DeepGraph Philosophy 🌌

**ATTENTION AI AGENTS AND DEVELOPERS:** If you are new to this repository, read this document first. It contains the core philosophy, history, and architectural decisions that define this project. Understanding this will save you hours of context-gathering.

---

## 1. The Inspiration: Deepscatter & Quadfeather
This project is deeply inspired by **Deepscatter** and **Quadfeather**, created by Ben Schmidt (Nomic AI). 
Deepscatter was revolutionary because it solved a massive problem in data visualization: **How do you render over a billion points in a web browser?**

Traditional WebGL engines choke on a few hundred thousand points. Deepscatter achieved this by:
1. **Quadfeather**: A C++ script that partitions giant CSV/Parquet datasets into a spatial quadtree, sorting points by their "significance" (e.g., brightness, population) and saving them into thousands of tiny Apache Arrow `.feather` files.
2. **Deepscatter (Frontend)**: A custom WebGL renderer that traverses this quadtree, loading tiles on-demand as the user zooms in, rendering points using instanced geometry and additive blending to create beautiful, density-mapped visualizations.

If you haven't seen it in action, research Ben Schmidt's **Gaia** visualization (rendering 1.8 billion stars from the ESA Gaia catalog). It is the benchmark we are measuring ourselves against.

---

## 2. Why We Are Building The Successor
While Deepscatter is brilliant, it has severe infrastructural and architectural limitations that prevent it from being a ubiquitous standard:

### The "File Count" Problem
Quadfeather outputs a full quadtree as **thousands (sometimes hundreds of thousands) of individual `.feather` files**. 
- Uploading 100,000 files to an AWS S3 bucket is incredibly slow and expensive.
- The browser must fire thousands of individual HTTP `GET` requests, which easily exhausts browser connection limits and causes stalling.
- Managing, moving, or sharing the dataset requires dealing with a massive directory tree.

### The "Builder" Problem
Quadfeather is a complex C++ tool that can be difficult to compile, extend, or integrate into modern data engineering pipelines (which primarily run on Python, Rust, and SQL).

---

## 3. Our Solution: DeepGraph + ArrowTiles
**DeepGraph ArrowTiles** is the modern successor. The core concept is **"PMTiles for Scatterplots"**.

Instead of writing thousands of files, we write a **single, unified `.pmtiles` archive**. 

### The Backend: DuckDB + Rust
We leverage **DuckDB** for out-of-core data processing and a custom **Rust** CLI tool (`arrowtiles_bucketer`) for spatial partitioning. 
1. **Global Sorting:** DuckDB reads the raw Parquet files and performs a global sort by magnitude (brightness), ensuring that the most significant points across the *entire dataset* are prioritized.
2. **Spatial Voxel Bucketing:** The Rust tool reads the data streams and bins the points into a spatial quadtree, keeping them strictly ordered by brightness.
3. **Single Archive Packing:** The quadtree chunks are written as pure Apache Arrow IPC binaries and packed into a single `.pmtiles` file.

### The Frontend: WebGPU & HTTP Range Requests
Instead of WebGL, we built a modern **WebGPU** engine using Three.js.
- **Range Requests:** The `PMTilesClient` parses the `.pmtiles` directory structure and uses **HTTP Range Requests** to fetch only the exact byte-ranges of the Arrow IPC chunks it needs directly from the single file. This is highly efficient and CDN-friendly.
- **Zero-Copy Arrays:** The Apache Arrow IPC chunks are parsed natively into `Float32Arrays` in a Web Worker and passed directly to the GPU buffers with zero overhead.

---

## 4. The "Seam" Problem & Global Magnitude Culling (LOD)
One of the hardest challenges in building an out-of-core renderer is **Level of Detail (LOD)**. 

### The Pitfall of Local Capping
Initially, we limited each tile to a maximum of 100,000 points on the frontend to prevent GPU crashes. This caused a fatal visual artifact: **Checkerboard Seams**. 
Because the dense galactic core had millions of points, the 100,000 limit chopped off all its faint stars. Meanwhile, the empty sky *didn't* hit the limit, meaning it rendered all its faint stars. When placed side-by-side, the empty sky had a thick background of "faint noise" while the dense core did not, creating a harsh square boundary.

### The Holy Grail: Global Culling
We fixed this by removing the local point limit and implementing **Global Magnitude Culling** in the WebGPU shader:
1. Because the points in the Arrow IPC chunks are strictly sorted by absolute magnitude, the shader has access to their true global brightness.
2. We pass a `maxMagUniform` to the shader based on the camera zoom.
3. When zoomed out, the GPU physically discards any star fainter than a specific global threshold (e.g., Magnitude 14). 
4. Because a magnitude 14 star in the empty sky is treated exactly the same as a magnitude 14 star in the galactic core, the density transitions perfectly smoothly without any tile seams, while simultaneously restoring 60 FPS by eliminating billions of pixel overdraws.

---

## 5. Instructions for Agents
If you are an AI agent tasked with modifying this codebase, keep these constraints in mind:
1. **Performance over Everything:** This is a stress test. 1.8 billion points is no joke. Do not introduce O(N) JavaScript loops over the data arrays on the main thread.
2. **WebGPU Nuances:** Additive blending without depth testing is extremely expensive on fill rate. Keep point quad sizes small at low zooms.
3. **Network Limits:** Browsers limit concurrent HTTP connections to a domain (usually ~6). Do not allow the Quadtree to blindly fetch hundreds of tiles, or the browser will stall with `net::ERR_INSUFFICIENT_RESOURCES`. Always tune the `overfetch` logic.
4. **Rust for Heavy Lifting:** If Stage 2 data processing needs to be modified, do it in `scripts/arrowtiles_bucketer/src/main.rs`. Do not attempt to process 24 GB of data natively in Python loops.
