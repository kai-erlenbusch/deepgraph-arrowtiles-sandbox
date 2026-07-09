# Code Review Implementation Plan
*Date: 2026-06-28 17:03:33-07:00*

This plan details the changes required to address the issues raised in the code review, prioritized by severity.

## Proposed Changes

---
### TypeScript Type Fixes

#### [MODIFY] [PMTilesClient.ts](file:///D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/src/PMTilesClient.ts)
- Update `TileData` interface: `xBuffer` and `yBuffer` will be typed as `Float32Array`.
- In `loadTile`, change the casts from `table.getChild(...)?.toArray() as Float64Array` to `Float32Array` to accurately reflect the data structure passed from Arrow IPC and WebGPU.

---
### Render Loop Memory Optimization

#### [MODIFY] [Scatterplot.ts](file:///D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/src/Scatterplot.ts)
- Move `const vp = new THREE.Matrix4()` out of the `updateCamera(camera)` method. 
- Declare it as a private class member `private vpMatrix = new THREE.Matrix4();` to prevent allocating a new object every frame, alleviating Garbage Collection stuttering.
- Extract magic numbers (e.g., `30.0` for Nomic tokens, `21.0` for Gaia size) into clearly named constants at the top of the file for easier tweaking.

---
### Python Vectorization & Hardcoded Paths

#### [MODIFY] [generate_pipeline.py](file:///D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/generate_pipeline.py)
- Replace all absolute paths (`D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/...`) with relative paths (e.g., `./duckdb_temp/...`) so the pipeline is portable.
- Replace the extension load path with a relative or configurable path.
- **Port Vectorization**: Replace the slow Python `for` loop that iterates over PyArrow batches with the highly optimized NumPy vectorized approach currently found in `finish_pipeline.py`.

#### [DELETE] [finish_pipeline.py](file:///D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/finish_pipeline.py)
- Since the vectorization logic will be merged into `generate_pipeline.py`, this script will be obsolete.

#### [MODIFY] [download_s3.py](file:///D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/download_s3.py)
- Restrict `except Exception as e:` to catch `duckdb.Error` or `duckdb.IOException` where applicable to avoid swallowing system-exiting signals like KeyboardInterrupt.

---
### Tile Boundaries

#### [MODIFY] [PMTilesClient.ts](file:///D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/src/PMTilesClient.ts)
- Add a small epsilon value (`0.0001`) to the bounding box calculations in `getVisibleTiles` to ensure floating-point inaccuracies don't cull tiles that are exactly on the boundary edge of the screen.

## Verification Plan

### Automated Tests
- Run `npm run build` to ensure TypeScript compiles without errors after the type changes.
- Ensure Vite server still successfully loads the application.

### Manual Verification
- Pan and zoom around the visualization in the browser to verify the micro-stutters are gone.
- Run `python generate_pipeline.py` (dry run or on a small dataset) to ensure the relative paths and NumPy vectorization work smoothly.
