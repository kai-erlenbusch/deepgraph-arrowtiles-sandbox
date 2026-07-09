2026-06-07 implementation plan

Goal Description
Upgrade our data generation pipeline to calculate and utilize a true spatial index (ix column) for our dataset. This will allow our WebGPU renderer to use Additive LOD to achieve perfectly smooth, overlapping-free zoom transitions, exactly mimicking the performance and visual quality of deepscatter.

User Review Required
Before we begin writing the complex spatial math for the ix column, we need to decide on the exact algorithm to use. You mentioned earlier that you had an academic paper you wanted to go over.

Open Questions
IMPORTANT

1. The Academic Paper: Do you want to go over the academic paper you mentioned first? That paper might contain the exact indexing algorithm or hierarchical shuffling method we should implement.

2. Execution Environment: Should we try to write the Morton Code (ix) calculation natively in DuckDB SQL (which is blazingly fast for 50M rows), or use Python (NumPy/Pandas) to do the bitwise interleaving before saving to the .arrow files?

Proposed Changes
Algorithm Design
Analyze the deepscatter indexing methodology (and any papers you provide) to understand how to map 2D floating-point coordinates (x,y) to a 1D integer index (ix).
Understand how to "shuffle" or layer the index so that taking the first N elements provides a uniform spatial sample.
Data Generation Pipeline (build_quadtree_ix.py)
[NEW] Create a new Python script that leverages DuckDB to:
Calculate the ix value for all 50,000,000 points.
Order the entire dataset by ix.
Partition the data into quadtree tiles (e.g., 0/0/0, 1/0/0) such that parent tiles contain the lowest ix values and children contain the subsequent ix values.
WebGPU Renderer Updates
[MODIFY] TileManager.ts: Revert back to Additive LOD (since the data will now support it without density overlaps).
[MODIFY] WebGPU Shaders (main.ts or shader files): Introduce a max_ix uniform so the shader can dynamically hide points that belong to deeper zoom levels, enabling smooth cross-fading.
Verification Plan
Manual Verification
Generate a smaller test dataset (e.g., 5 million points) with the new ix index.
Load it into the WebGPU sandbox using <http://localhost:8080/> (or the correct Vite port).
Zoom in and verify that the points interleave perfectly with zero density multipliers and no sharp grid boundaries.
