Deepgraph-WebGPU 2D/2.5D Upgrade Summary
We have successfully refactored the original deepgraph-webgpu repository into a polished, high-performance 2D/2.5D static embedding engine. This runs parallel to our newer deepgraph-3d C++ Octree engine!

What We Accomplished
1. Arrow Worker Vectorization
We replaced the slow JavaScript for loop inside ArrowWorker.ts with direct vector access:

typescript

const xArr = xCol.toArray();
const yArr = yCol.toArray();
This skips the V8 engine's .get(i) overhead and directly streams the raw binary columns into our interleaved WebGPU buffer, significantly accelerating the loading of massive tiles.

2. The 1x1 Picking Optimization
Previously, calculating hover tooltips required rendering a full-screen, high-resolution offscreen pass. This caused massive GPU overhead. We implemented a mathematical camera trick in main.ts:

typescript

camera.setViewOffset(window.innerWidth, window.innerHeight, mouse.x, mouse.y, 1, 1);
Now, only a single pixel is rendered on the GPU during the picking pass, stabilizing framerates and saving memory bandwidth!

3. True Frustum Culling (2.5D Support)
The naive tiltBuffer approach failed in 2.5D mode because a 2D bounding box intersection breaks when the camera projects forward toward the horizon. We implemented a mathematically perfect THREE.Frustum check in TileManager.ts, evaluating intersections against an infinitely tall THREE.Box3. This ensures tiles never disappear when tilting the camera into 3D!

4. LOD Overdraw Prevention
We added safety checks to prevent "brightness blowouts" during zoom transitions:

typescript

const intersectingChildren = node.children!.filter(c => c.intersects(frustum));
if (intersectingChildren.length > 0) {
    allIntersectingChildrenLoaded = intersectingChildren.every(c => c.tileData !== null);
}
// Only render parent if children aren't fully ready
if (!allIntersectingChildrenLoaded) {
    visibleTiles.push(node.tileData);
}
How to Test
The server is running locally on port 5178. Open http://localhost:5178/ in your browser to experience the upgraded 2D/2.5D engine!

Visual Verification
Here is a recording from the browser testing agent confirming the 2.5D Frustum Culling and improved picking pass: Preview unavailable