Deepscatter Reverse-Engineering & Architecture Plan
I have successfully cloned and reverse-engineered the core data-streaming architecture of Nomic AI's deepscatter (which powers visualizations like the PubMed Landscape).

This document analyzes how Deepscatter achieves its massive scale and proposes an implementation plan for adapting these concepts into our WebGPU-accelerated force-directed graph successor (deepgraph-webgpu).

How Deepscatter Works (The North Star)
Deepscatter's ability to render billions of points seamlessly in the browser boils down to three brilliant architectural pillars:

1. Columnar Binary Streaming (Apache Arrow)
Instead of JSON or CSV, Deepscatter streams data over the wire using Apache Arrow IPC (Inter-Process Communication) buffers, often saved as .feather files. Arrow is a columnar memory format. When the browser downloads an Arrow chunk, the x and y coordinates are already formatted in a continuous Float32Array. Why it's fast: The browser does zero CPU parsing. It just takes the raw binary array and uploads it straight to the GPU as an attribute buffer.

2. Quadtree Tiling (LOD)
Deepscatter pre-computes the entire dataset into a spatial Quadtree (using zoom levels z/x/y).

Level 0: A low-resolution summary of the entire dataset.
Level 1+: Higher resolution tiles that are only loaded when the user zooms into that specific region.
Culling: The Tile.ts logic constantly calculates the camera's viewport and checks if a tile's bounding box intersects. If it's off-screen, it never downloads.
3. Batched GPU Operations
Once a tile is loaded, it is sent to regl (WebGL) as a single draw call. Instead of managing millions of individual point objects in JS, Deepscatter manages a few hundred Tile objects, each containing up to 65,000 points.

The Gap: From Scatterplot to Network Graph
Deepscatter is magnificent for static point clouds (Scatterplots), but we are building deepgraph-webgpu, a force-directed network graph.

This introduces two massive challenges that Deepscatter doesn't solve:

Nodes Move: In Deepscatter, coordinates are static. In our graph, the GPU compute shader constantly updates the node positions via physics.
Edges Connect Nodes: We need to stream and render millions of lines (edges) connecting the nodes.
Proposed Implementation Plan for deepgraph-webgpu
To build the true successor to Deepscatter, we will fuse its Arrow-streaming philosophy with WebGPU Compute.

1. Data Ingestion & Tiling (Backend)
We need a way to serve the LMSys dataset (2.8M rows) to the client efficiently. We will adopt the Deepscatter approach:

The x_umap and y_umap are already computed.
We will recursively partition the 2D space into a hierarchical quadtree (similar to Deepscatter's quadfeather tool).
For each quadtree node, we store a subset of points (typically max 65,536 points per tile) in Apache Arrow IPC format.
Each tile will contain embedded metadata indicating whether child nodes exist (to allow dynamic traversal without a master index).
We will package these tiles into a single .pmtiles archive (or an equivalent single-file HTTP Range request friendly structure).
DuckDB (via an extension or Python script) will be used to construct the spatial index and generate these Arrow tiles.
2. Tile Streaming Pipeline (Frontend)
Update TileManager.ts to maintain a virtual camera and compute the 2D bounding box of the viewport.
Implement Quadtree traversal: intersect the camera bounding box against loaded nodes, and trigger fetches for children when zoomed in sufficiently.
Implement a .pmtiles / HTTP Range request reader in TypeScript to fetch the binary Arrow tiles.
Parse the Apache Arrow buffers and leverage zero-copy GPU uploads—directly passing the Arrow columnar ArrayBuffers (X, Y, Color) into WebGPU storage buffers without JavaScript iteration overhead.
3. Rendering Enhancements
Currently, ComputeController does physics. We will completely remove the physics compute pass.
We will focus strictly on rendering: point sizes, semantic zooming, coloring based on dataset attributes (like model or labels).
User Review Required
IMPORTANT

To proceed with the PMTiles/Arrow integration (Step 1), we need a dataset to test with. Do you have a small duckdb/feather dataset or a .pmtiles archive generated that we can hook into the dev server? Or should I write a quick Python/Node script to generate a dummy .pmtiles archive filled with Arrow IPC buffers to test the streaming pipeline?