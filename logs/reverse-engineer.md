Deepscatter: Reverse Engineering & Architectural Analysis
Based on a static analysis of the nomic-ai/deepscatter repository (v3.0.0-next.51), here is a deep architectural teardown of how it achieves rendering billions of points, and what limitations we must solve in our WebGPU successor.

1. Reconnaissance & Architecture
Deepscatter is a TypeScript library that orchestrates WebGL rendering via the regl library and data streaming via apache-arrow.

Core Stack:

Renderer: regl (a declarative WebGL 1/2 wrapper).
Data Format: Apache Arrow (IPC format / .feather files).
Interactions: d3-zoom, d3-scale, d3-quadtree.
Spatial Index: Custom Quadtree implementation based on Z/X/Y map tiles.
2. Static Analysis: How it Scales to Billions
The magic of deepscatter relies entirely on Tile-Based Arrow Streaming. It does not load all data into memory.

A. The Quadtree Tile System (tile.ts)
Deepscatter divides the scatterplot into a spatial quadtree, similar to Google Maps.

Files are stored on the server as z/x/y.feather (e.g., 0/0/0.feather is the zoomed-out root tile).
As the user zooms in (managed by interaction.ts), the camera's bounding box is calculated.
The Scatterplot checks which tiles intersect the camera frustum and fires asynchronous fetch() requests for the corresponding .feather files.
B. Zero-Copy WebGL Handoff (wrap_arrow.ts & regl_rendering.ts)
When an Arrow tile is downloaded, it is not parsed into JavaScript objects.

Arrow vectors (like x and y coordinates) are essentially raw Float32Array buffers in memory.
Deepscatter extracts these buffers and passes them directly to regl as WebGL vertex attributes.
This entirely bypasses the V8 JavaScript garbage collector, allowing the browser to handle hundreds of megabytes of points without crashing.
3. Identified Limitations (Why we need WebGPU)
While brilliant for static scatterplots (like UMAPs of Wikipedia articles), Deepscatter's architecture fails for interactive network graphs for several reasons:

WARNING

No Topology/Edge Support The quadtree logic strictly assumes points (scatter). If you have an edge connecting a node in tile 1/0/0 to a node in tile 4/3/2, Deepscatter has no topological mechanism to route, render, or chunk that edge.

CAUTION

WebGL Compute Bottleneck WebGL 1/2 can only render. If we want force-directed physics (nodes repelling each other), WebGL cannot easily calculate those forces and update the positions. Deepscatter assumes positions are pre-calculated statically on the server.

NOTE

Label Rendering is DOM-Bound label_rendering.ts relies heavily on rendering HTML/SVG overlays on top of the WebGL canvas. This chokes the main thread if too many labels are visible at once.

4. The Path Forward: Deepgraph WebGPU
By studying Deepscatter, we can build a vastly superior successor:

PMTiles / Arrow for Topology: We must extend the Z/X/Y tile specification to include an Edge buffer (an adjacency list mapping local node indices to global node IDs across tiles).
WebGPU Compute: Instead of just passing Arrow buffers to vertex shaders (like Deepscatter), we will pass them to WebGPU Compute Shaders. The GPU itself will run the force-directed layout on the streaming tiles.
Instanced Rendering: We will drop regl entirely and use Three.js WebGPURenderer (r171+) with InstancedMesh for rendering nodes and LineSegments for edges, all driven by the compute shader's output buffer.
This analysis confirms that your intuition is 100% correct: Deepscatter paved the way for binary streaming, but WebGPU is required to take it to network graphs.