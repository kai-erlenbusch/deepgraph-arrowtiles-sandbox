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

Step 1: PMTiles + Arrow Integration (The Node Loader)
Deepscatter's original implementation required generating millions of tiny .feather files, which destroys cloud storage buckets. We will use PMTiles, a single-file archive format that uses HTTP Range Requests.

Action: Implement a TileManager that fetches Apache Arrow RecordBatches from a local .pmtiles archive.
Action: Directly map the Arrow Float32Array buffers to our WebGPU positionStorage compute buffer.
Step 2: The Edge Buffer Architecture
We need a way to stream edges without crippling the GPU.

Action: Create an edgeStorage buffer where each entry is an (int32, int32) pair representing (source_node_index, target_node_index).
Action: Update the WebGPU compute shader to read this edgeStorage and apply Hooke's Law (Spring Force) directly between the connected nodes.
Step 3: Spatial Partitioning (Grid / Barnes-Hut)
To calculate repulsion (nodes pushing away from each other), calculating every node against every other node is O(N 
2
 ) and will crash the GPU instantly at 1 million nodes.

Action: Implement a Compute Shader Grid Partition. The screen is divided into a grid, and nodes only calculate repulsion against other nodes in their cell or adjacent cells, reducing complexity to O(NlogN).
User Review Required
IMPORTANT

To proceed with the PMTiles/Arrow integration (Step 1), we need a dataset to test with. Do you have a small duckdb/feather dataset or a .pmtiles archive generated that we can hook into the dev server? Or should I write a quick Python/Node script to generate a dummy .pmtiles archive filled with Arrow IPC buffers to test the streaming pipeline?