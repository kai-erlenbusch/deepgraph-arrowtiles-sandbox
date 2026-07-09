Deepgraph WebGPU: Handoff Document
1. Project Vision & Goal
We are building a WebGPU-first successor to Nomic AI's Deepscatter. Deepscatter handles 2D point clouds exceptionally well by bypassing V8 garbage collection and piping Apache Arrow buffers directly to the GPU.

Our goal is to take this concept further and build Deepgraph: a network-graph visualization engine capable of rendering and simulating millions of nodes and edges. Because standard WebGL pipelines cannot efficiently read-back physics calculations (requiring FBO ping-ponging), we have transitioned to a WebGPU Compute Shader architecture. This allows us to calculate node repulsion (N-body) and spring forces directly on the GPU using shared Storage Buffers.

Eventually, this rendering engine will be paired with a DuckDB extension to serve graph topologies dynamically.

2. Chosen Architecture
We have established a foundational prototype in the D:\exploratory\duckdb-extension\deepgraph-webgpu directory.

Tech Stack:

Three.js (r171+): Using the bleeding-edge WebGPU renderer and TSL (Three.js Shading Language) for compute shaders.
Vite: For fast HMR and development bundling.
Vanilla TypeScript: No React/framework overhead to ensure maximum performance and easiest integration with Apache Arrow later.
Core Components:

src/core/Renderer.ts: Initializes the WebGPURenderer and scene.
src/core/ComputeController.ts: The most critical file. This houses the TSL compute shader logic. It defines the WebGPU StorageInstancedBufferAttribute for node positions and StorageBufferAttribute for edge definitions and forces. It contains two passes:
Pass 1 (Edge Logic): Calculates spring forces between connected nodes and uses atomicAdd to accumulate forces in a shared forceBuffer.
Pass 2 (Node Logic): Reads the accumulated forces, applies a center gravity, updates the node positions, and resets the forces using atomicStore.
src/core/TileManager.ts: (Stubbed) Will eventually handle streaming PMTiles/Arrow buffers directly into the pre-allocated WebGPU ring buffers.
src/main.ts: Orchestrates the simulation, mocking 10,000 nodes and 20,000 edges to test the compute shader physics.
3. Current Status & Roadblocks
We are currently stuck trying to get the WebGPU Compute Shader to successfully render the mocked graph.

The Vite dev server is running on http://localhost:5173/, but currently displays a gray screen without the expected green nodes.

We have resolved several strict WGSL compilation errors related to TSL:

Renderer Initialization: We corrected the WebGPURenderer import, pulling it from three/webgpu instead of the default THREE namespace.
Storage Buffer Typing: StorageBufferAttribute and StorageInstancedBufferAttribute were correctly imported from three/webgpu.
Atomic Operations: WGSL requires strict typing for concurrent access. We updated the forceBuffer declaration using .toAtomic().
Casting Atomic Values: WGSL does not allow direct casting of atomic<i32> to f32. We implemented a standard workaround, loading the values first via atomicAdd(ptr, 0) before casting them to float() in TSL.
Despite resolving the console errors, the scene is still not visualizing.

4. Instructions for the Next Agent
Debug the Rendering Pipeline: Start by inspecting main.ts and Renderer.ts. Ensure the MeshBasicNodeMaterial is correctly attached to the instanced mesh and that the camera/scene are being rendered properly in the animation loop.
Simplify the Compute Shader: If the rendering pipeline is correct, the Compute Shader logic in ComputeController.ts might be freezing or producing NaN positions. I recommend temporarily bypassing the physics calculations (just assign a static position to every instance) to verify that the WebGPU rendering pipeline is actually functional.
Validate WebGPU Support: Ensure the browser environment actually supports WebGPU and isn't falling back or failing silently.
Implement Apache Arrow: Once you have proven the physics engine by getting the mocked nodes to bounce and settle on-screen, move on to TileManager.ts to implement the binary data streaming from PMTiles or DuckDB.