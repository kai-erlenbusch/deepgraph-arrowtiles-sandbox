Progress as of June 6, 2026

Deepgraph-WebGPU Architecture Review
I've conducted a deep review of your custom WebGPU successor to Deepscatter (deepgraph-webgpu). Building on top of Three.js's bleeding-edge WebGPU renderer and TSL (Three Shading Language) is a fantastic approach for modernizing the stack.

However, scaling to 50 million+ points (especially under stress tests) will expose several fundamental architectural bottlenecks in the current implementation. Here is a breakdown of the critical issues and how they can be addressed.

1. The Interactivity Bottleneck: O(N) CPU Picking
The Problem: In main.ts, performCPUPicking() fires on mousemove. It loops through every single active tile and iterates over every point (for (let i = 0; i < t.numRows; i++)) to calculate the distance to the mouse cursor. If your LOD system decides to render 10 million points on screen at once (e.g., 150 tiles * 65k points), your Javascript main thread is doing 10 million Math.sqrt and distance calculations every time the mouse moves a single pixel. This will completely freeze the browser and crash the framerate.

The Fix: You must move picking off the CPU.

Option A (GPU Color Picking): Re-implement Deepscatter's approach. Render the scene to an off-screen render target where the RGB value of each point represents its unique Qid (Tile ID + Row ID). When the mouse moves, read a single 1x1 pixel from the GPU framebuffer using readRenderTargetPixelsAsync(). This is O(1) and entirely immune to dataset size.
Option B (Spatial Indexing on CPU): If you must keep CPU picking, you cannot iterate linearly. You need a fast spatial index (like an internal KD-tree or a grid hash) for the loaded tiles so you only test the few hundred points immediately surrounding the mouse.
2. Scene Graph Overhead: 1 Mesh = 1 Tile
The Problem: In Scatterplot.ts, every time a tile loads, you create a new THREE.Mesh and add it to the scene:

typescript

const mesh = new THREE.Mesh(instancedGeometry, this.material);
this.scene.add(mesh);
With maxCacheSize = 1000, you could easily have 500-1000 active meshes in your scene. Even though WebGPU reduces draw call overhead significantly compared to WebGL, Three.js still has to traverse the scene graph, calculate world matrices, and sort these meshes on the CPU every frame.

The Fix:

Grouping or Instanced rendering of tiles. While each tile is an InstancedBufferGeometry of points, you can use a unified buffer system where multiple tiles share a single massive geometry buffer, updating specific byte-ranges (bufferSubData).
Alternatively, disable matrix auto-updates for the tiles (mesh.matrixAutoUpdate = false) since they never move in world space.
3. Worker Parsing Overhead
The Problem: In ArrowWorker.ts, you fetch the Arrow IPC file and then loop over the rows to repack the data into new Float32Array buffers:

typescript

for (let i = 0; i < numRows; i++) {
    geomBuffer[i * 3 + 0] = xCol[i];
    // ...
While Web Workers prevent this from blocking the main thread, this memory repacking uses excessive CPU cycles and doubles the memory footprint before transfer.

The Fix: Apache Arrow buffers can be passed directly to the GPU. Instead of repacking x, y, z into a single interleaved Float32Array, you can pass the raw contiguous Float32Array of the x column, y column, etc., directly into separate THREE.InstancedBufferAttribute instances. This achieves true "Zero-Copy" processing from network to GPU.

1. Unbounded Additive LOD
The Problem: In TileManager.ts, your LOD split condition is based purely on spatial distance:

typescript

const shouldSubdivide = dist < nodeSize * 1.5;
For a 50 million point dataset, if a user zooms out slightly, this mathematical threshold might aggressively trigger subdivision across the entire screen, suddenly queuing hundreds of tiles and bursting GPU memory limits.

The Fix: You need a "Budget-Constrained LOD". Instead of purely spatial checks, maintain a hard limit on the total number of points allowed on screen (e.g., max 5 million points).

Score every tile based on its distance/size relative to the camera (Screen Space Error).
Sort a priority queue of tiles by this score.
Keep subdividing the highest-priority tiles only until you hit your memory/point budget. This guarantees the app will never crash regardless of the dataset size.
Next Steps
These issues explain why your stress tests are failing. Once you share the sandbox in the next prompt, we can begin implementing these fixes directly into the code.
