Goal: Deepgraph WebGPU (Deepscatter Successor)
Build a high-performance network graph visualizer utilizing Three.js WebGPU compute, replacing Deepscatter's static WebGL scatterplots with interactive, force-directed graph layouts capable of streaming billions of nodes and edges.

User Review Required
IMPORTANT

Please review the reverse_engineering_deepscatter.md artifact to see the teardown of the original architecture and why this new approach is necessary. Before we start building, please confirm if you are happy with the name deepgraph-webgpu and the tech stack (Vite + Three.js WebGPU + TypeScript).

Open Questions
WARNING

Should we base the tile format strictly on PMTiles (SQLite/binary archives), or stick to a directory of Apache Arrow .feather files like Deepscatter but with an Edge adjacency list?
Do you want to use a framework like React/Next.js for the UI shell around the Three.js canvas, or keep it as vanilla TypeScript + Vite for maximum performance and portability?
Proposed Changes
Setup Workspace
[NEW] 
package.json
Initialize a new Vite project with TypeScript and Three.js (r171+) for WebGPU support.

[NEW] 
index.html
Basic HTML entry point housing the WebGPU canvas.

Core Architecture
[NEW] 
src/core/Renderer.ts
Wrapper around WebGPURenderer. Sets up the scene, camera, and handles the InstancedMesh for nodes and LineSegments for edges.

[NEW] 
src/core/ComputeController.ts
Orchestrates the WebGPU Compute Shaders (TSL - Three.js Shading Language) that will calculate the force-directed physics layout entirely on the GPU.

[NEW] 
src/data/TileManager.ts
Handles streaming binary chunks of nodes/edges from the server, decoding them (e.g., Apache Arrow IPC), and streaming the raw Float32Array buffers into the WebGPU storage buffers.

Verification Plan
Automated Tests
Scaffold simple unit tests for checking quadtree Z/X/Y intersection mathematics.
Manual Verification
Render a static hard-coded grid of 1,000,000 nodes using WebGPU compute.
Apply a basic compute shader force (e.g., gravity) to ensure the GPU can update node positions at 60 FPS without transferring data back to the CPU.