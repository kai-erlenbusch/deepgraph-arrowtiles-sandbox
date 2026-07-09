june 6 2026 Sandbox testing on 50 million points

Sandbox Tiling Method Review
I've conducted a deep review of the deepgraph-webgpu-sandbox codebase. You are encountering severe performance issues and stalling because of three critical bugs in how the Quadtree traversal and GPU memory management are implemented.

Here is the breakdown of why the stress test is failing and how to fix it.

1. Quadtree Traversal Waterfall (The Network Stall)
The Problem: In TileManager.ts, inside getVisibleTiles, you have the following logic:

typescript

if (node.tileData) {
  const shouldSubdivide = dist < nodeSize * 2.5;
  if (shouldSubdivide) {
    // ... add children to queue
  }
}
By placing the shouldSubdivide logic inside the if (node.tileData) block, your quadtree traversal completely halts if a tile is currently loading over the network. If the user zooms into Level 5, the manager will request Level 0 and stop. Once Level 0 loads, it requests Level 1 and stops. This creates a massive network waterfall where it takes N sequential round-trips to reach the target LOD, making the application feel unresponsive and broken.

The Fix: You must decouple Quadtree subdivision from data loading. The quadtree should evaluate shouldSubdivide purely mathematically, regardless of whether the current node's data is loaded:

typescript

// 1. Issue fetch if needed
if (!node.tileData && !this.fetchCache.has(node.key)) {
  this.loadTile(node);
}
// 2. Evaluate LOD mathematically (ALWAYS)
const center = node.box3.getCenter(new THREE.Vector3());
const dist = cameraPos.distanceTo(center);
const shouldSubdivide = dist < (node.bounds.maxX - node.bounds.minX) * 2.5;
if (shouldSubdivide) {
   // Create and queue intersecting children
}
// 3. Render if data is ready
if (node.tileData) {
   node.lastAccessFrame = this.currentFrame;
   visibleTiles.push(node.tileData);
}
2. GPU Buffer Thrashing (The Panning Stutter)
The Problem: In TileManager.ts, you correctly implemented an LRU cache (maxCacheSize = 1000) to keep recently used ArrayBuffers in CPU memory. However, in Scatterplot.ts, you do this:

typescript

const currentKeys = new Set(tiles.map(t => t.key));
for (const [key, mesh] of this.tileMeshes.entries()) {
  if (!currentKeys.has(key)) {
    this.scene.remove(mesh);
    mesh.geometry.dispose(); // <-- DESTROYS GPU BUFFERS
    this.tileMeshes.delete(key);
  }
}
Because tiles only contains tiles that intersect the camera frustum this exact frame, panning the camera even 1 pixel will instantly destroy the GPU buffers of tiles that slide off-screen. When you pan back, Three.js is forced to re-allocate new InstancedBufferGeometry and re-upload the entire 65k point buffer to the GPU over the PCIe bus. This causes massive framerate stuttering and completely defeats the purpose of your TileManager cache.

The Fix: Do not destroy meshes just because they leave the frustum. Instead, simply hide them (mesh.visible = false). Only dispose of geometry when the TileManager explicitly evicts them from its LRU cache.

typescript

// Hide all tiles first
for (const mesh of this.tileMeshes.values()) mesh.visible = false;
// Show or add visible tiles
for (const tile of tiles) {
  if (!this.tileMeshes.has(tile.key)) {
    this.addTile(tile);
  }
  this.tileMeshes.get(tile.key)!.visible = true;
}
// TODO: Add a cleanup loop that removes meshes IF they exceed a threshold (e.g., > 1000)
3. JavaScript Crash on Hover
The Problem: In main.ts inside performCPUPicking, you reference a variable closestTileZ that was never declared:

typescript

let closestTileKey = "";
let closestRowIndex = -1;
let closestDistSq = Infinity;
// MISSING: let closestTileZ = -1;
When hovering over points, this will throw a ReferenceError, silently breaking the rendering loop if the error propagates.

The Fix: Add let closestTileZ = -1; to the variable declarations in performCPUPicking.

Next Steps
These three issues combined explain exactly why the 50 million point stress test is struggling. The network waterfall prevents fast loading, the GPU buffer thrashing freezes the renderer during panning, and the missing variable breaks interaction.

Would you like me to go ahead and patch these files in the sandbox repository?
