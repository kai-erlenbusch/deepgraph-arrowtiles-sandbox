# Architecture Pivot: Geometric Voxel Bucketing
*Generated on: 2026-06-29 16:52:13-07:00*

This plan addresses your questions regarding the `2026-06-29_entwine_arrowtiles_architecture_review.md` document and outlines the systemic changes required across the `deepgraph-arrowtiles-sandbox` and `duckdb-arrowtiles` projects.

## User Review Required

> [!IMPORTANT]
> **What This Means for the Rust Extension (`duckdb-arrowtiles`)**
> The architecture review is completely correct. By moving to DuckDB Window Functions for geometric pushdown, we no longer need to track global capacities. **This makes the complex, lock-free `DashMap` and the stateful `arrowtiles_assign_tile` UDF we built in Rust completely obsolete.** 
>
> We will NOT delete the Rust extension, however, because we still rely on it for the blazingly fast `hilbert_normalized(x_norm, y_norm, z)` spatial index UDF. We will simply stop using the stateful assignment UDF and rely purely on SQL Window Functions for capacity management. Do you approve this deprecation?

## Proposed Changes

### 1. `deepgraph-arrowtiles-sandbox/generate_pipeline.py`

#### [MODIFY] Dynamic SQL Pipeline Generation
We will completely gut the current `arrowtiles_assign_tile` logic and replace it with a dynamically generated SQL query that chains Common Table Expressions (CTEs) from `Z = 0` to `Z = max_zoom`.

**The Algorithm (Implemented in pure SQL via string formatting in Python):**
1. **Grid Resolution:** We will calculate `grid_size = ceil(sqrt(max_capacity))`. For `100,000`, this yields a `317 x 317` grid per tile.
2. **Recursive Pushdown CTEs:** For each zoom level `Z` from `0` to `max_zoom`:
   - Calculate voxel coordinates: `vx = FLOOR(x_norm * grid_size * (2^Z))`, `vy = FLOOR(y_norm * grid_size * (2^Z))`
   - Rank stars within each voxel: `rnk = ROW_NUMBER() OVER (PARTITION BY vx, vy ORDER BY abs_m ASC)`
   - Stars with `rnk = 1` are assigned to zoom `Z`. We calculate their tile ID using the Rust UDF: `hilbert_normalized(x_norm, y_norm, Z)`.
   - Stars with `rnk > 1` "overflow" into a temporary unassigned pool, which becomes the input for the `Z+1` CTE.
3. **Union and Export:** The final step simply performs a `UNION ALL` across all zoom levels, sorts by `ORDER BY z, final_tile_id`, and writes directly to `final_ordered.parquet`.

### 2. PMTiles and Arrow IPC
As noted in the architecture review, your decision to use **PMTiles + Arrow IPC** is vastly superior to Entwine's JSON/Binary (`EPT`) format due to zero-copy memory mapping on the WebGPU frontend. We will leave the PMTiles packaging logic untouched. It will seamlessly package the newly sorted, voxel-bucketed parquet file.

## Verification Plan

### Automated Tests
- We will execute the new `generate_pipeline.py`.
- Because DuckDB's engine handles window functions (`ROW_NUMBER() OVER`) out-of-core and heavily parallelizes them, we expect this 15-stage CTE query to execute rapidly and safely on the 1.7 Billion stars without OOM errors.

### Manual Verification
- We will verify that the maximum stars per tile mathematically cannot exceed the `grid_size * grid_size` limit.
- You will need to render the resulting `gaia.pmtiles` file in the WebGPU frontend. You should immediately notice the disappearance of the sharp "striping" boundaries, replaced by a smooth, perfectly uniform background sky that accurately reflects magnitude hierarchies.
