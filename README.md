# Deepgraph WebGPU: ArrowTiles Sandbox 🌌

This repository is an experimental sandbox and stress test for the WebGPU-based successor to the Deepgraph static embedding engine. 

The specific goal of this sandbox is to push the boundaries of browser-based rendering by visualizing the **European Space Agency's (ESA) Gaia dataset**—an astronomical catalogue mapping the positions and movements of over a billion stars in the Milky Way galaxy.

Because the Gaia dataset is incredibly dense and massive, it serves as the ultimate stress test for out-of-core data streaming, GPU memory management, and Additive Blending LOD (Level-Of-Detail) algorithms.

This repository builds upon our previous `deepgraph-webgpu-sandbox`, but fundamentally replaces the backend. Instead of streaming thousands of individual `.feather` files from an S3 bucket, this architecture uses a **DuckDB** spatial extension to pack the entire quadtree into a single, highly-optimized **PMTiles** archive containing Apache Arrow IPC chunks.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- A modern browser with **WebGPU enabled** (Chrome 113+, Edge 113+, Firefox Nightly, or Safari 18+).
- Python 3.10+ (for the data generation pipeline)
- DuckDB with the custom `arrowtiles` extension.

### Setup

```bash
# Clone the repository
git clone https://github.com/kai-erlenbusch/deepgraph-arrowtiles-sandbox.git
cd deepgraph-arrowtiles-sandbox

# Install dependencies
npm install

# Start the development server
npm run dev
```

The application will launch on `http://localhost:5173`.

---

## 🏗️ Architecture Overview

The system operates on a multi-threaded pipeline designed to minimize CPU bottlenecks during rendering and maximize data throughput over HTTP.

```mermaid
graph TD
    subgraph Browser Main Thread
        TM[TileManager] -->|Calculates Frustum & LOD| PM[PMTilesClient]
        PM -->|HTTP Range Requests| S3[(.pmtiles Archive)]
        S3 -->|Apache Arrow IPC Binary| PM
        PM -->|Float32Arrays| BUF[GPU Buffer Upload]
        BUF --> R[WebGPU Renderer]
        R -->|Draws InstancedMesh| C[Canvas]
    end
    subgraph Data Pipeline (DuckDB)
        RAW[(Raw Parquet)] -->|Global Magnitude Sort| DDB[DuckDB Engine]
        DDB -->|arrowtiles_export| S3
    end
```

1. **`main.ts`**: Initializes the WebGPU scene and handles the `InstancedMesh`.
2. **`TileManager.ts`**: Handles spatial Quadtree indexing and LOD traversal.
3. **`PMTilesClient.ts`**: Replaces the old Web Worker. It issues HTTP Range Requests to the unified `.pmtiles` archive, extracts the Apache Arrow IPC binary chunks, and parses them into zero-copy `Float32Array` buffers.
4. **`generate_pipeline.py`**: A DuckDB pipeline that ingests raw Parquet datasets, projects them geometrically using a Hammer projection, sorts them globally by magnitude (brightness), and exports the quadtree.

---

## 🏎️ Deep Dive: WebGPU Instanced Rendering & Density Culling

Traditional WebGL engines struggle to render millions of distinct geometries because the CPU cannot push that many individual `draw` calls without bottlenecking. 

This engine bypasses the CPU overhead using **WebGPU Instanced Rendering**.

Instead of telling the GPU to draw millions of distinct dots, we instruct the GPU to draw **1 generic quad/circle**, but to draw it millions of times simultaneously.

### The `ix` Density Cap
To prevent extreme additive blowouts when looking at the dense Galactic Equator, we implemented a mathematically pure **Density Cap**:
1. In the DuckDB pipeline, every star is sorted by Magnitude and assigned a global `ix` row number.
2. In the WebGPU Vertex Shader, we pass a dynamic `maxIxUniform` that scales based on how zoomed in the camera is.
3. The GPU shader instantly drops any faint stars (`ix > maxIx`) if the density of a zoomed-out region becomes too overwhelmingly bright. As you zoom in, the budget expands, revealing the faint background stars.

---

## ✨ Recent Architectural Evolutions

1. **PMTiles Archive vs. Feather S3:** We moved away from thousands of individual `.feather` files. By packing the Apache Arrow chunks into a single `.pmtiles` file using DuckDB, we leverage HTTP Range Requests. This reduces network overhead, avoids S3 file-count limits, and massively simplifies deployment.
2. **Global Magnitude Sorting:** The DuckDB pipeline now successfully executes an out-of-core window function (`row_number() OVER (ORDER BY magnitude ASC)`) across hundreds of millions of rows. This guarantees that the Root Zoom Level (Z=0) strictly contains the absolute brightest stars in the entire sky.
3. **Sub-Pixel Additive Tuning:** Base opacities have been dropped as low as `0.005` to simulate Deepscatter's extremely faint rendering logic. This effectively diffuses quadtree boundary artifacts and produces smooth, photorealistic Milky Way structure.

---

## ⚠️ Known Challenges & Current Limitations

This is a stress test sandbox, and several major architectural challenges remain unresolved:

- **Global vs. Local Density Spikes:** Because the DuckDB pipeline assigns stars to zoom levels based on a *global* magnitude rank rather than pushing overflow stars down recursively (like Deepscatter's C++ builder), tiles covering the Galactic Equator receive disproportionately massive star payloads. This creates sharp density cutoffs at tile boundaries, which we currently mitigate purely through extreme opacity diffusion.
- **Buffer Reallocation Stalls:** The engine dynamically creates new WebGPU `InstancedBufferAttributes` when loading tiles that exceed expected point counts. This can trigger garbage collection and command queue stalls during rapid zooming.

## 📚 Citing

If you use this software in your work or scientific research, it is important to properly cite it to acknowledge the contribution of the developers. When citing, please include the following metadata:

[Insert Names/Title/Year] [Computer software]. https://github.com/kai-erlenbusch/deepgraph-arrowtiles-sandbox

This citation should include the names of the developers, the year of publication, the title of the software, and the medium (Computer software). The URL should also be included to provide a direct link to the software.

## 📄 Licensing

This project is freely available for non-commercial use under the **Creative Commons Attribution Non Commercial CC BY-NC 4.0** public license. Please note that this license does not permit commercial use of the software. For more information about the limitations of this license, you can refer to the [CC BY-NC 4.0 License Deed](https://creativecommons.org/licenses/by-nc/4.0/).

If you’re planning to use this software commercially, please reach out to us for a Business license.
