import duckdb
import numpy as np
import time

def test_numpy_bucketing():
    print("Loading test chunk into DuckDB...")
    con = duckdb.connect()
    
    # We stopped at chunk 36, let's grab the completed chunk 35 which is very dense
    chunk_file = "D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/assigned_chunks/chunk_35.parquet"
    
    # But wait, the assigned_chunks were already processed by Stage 2. We need the RAW partition!
    # Stage 1 partitions are in duckdb_temp/partitions/z3_chunk_id=X/
    # Let's find partition 35.
    partition_file = "D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/partitions/z3_chunk_id=35/*.parquet"
    
    query = f"SELECT x_norm, y_norm, abs_m FROM '{partition_file}' ORDER BY abs_m ASC"
    
    try:
        df = con.execute(query).fetchdf()
    except Exception as e:
        print(f"Error loading chunk 35: {e}")
        return

    print(f"Loaded {len(df)} rows into memory. Starting Numpy bucketing...")
    
    start_time = time.time()
    
    x = df['x_norm'].values
    y = df['y_norm'].values
    
    assigned_z = np.full(len(df), 15, dtype=np.int8)
    unassigned_mask = np.ones(len(df), dtype=bool)
    
    for z in range(15):
        grid_multiplier = 256 * (2 ** z)
        
        # Calculate voxel coordinates only for unassigned stars
        vx = (x[unassigned_mask] * grid_multiplier).astype(np.int64)
        vy = (y[unassigned_mask] * grid_multiplier).astype(np.int64)
        
        # Unique voxel ID
        voxel_id = (vx << 32) | vy
        
        # Find the first occurrence of each voxel_id. Since the original dataframe 
        # is sorted by abs_m ASC, the first occurrence is always the brightest star.
        _, unique_indices = np.unique(voxel_id, return_index=True)
        
        # Map unique_indices back to the original array indices
        original_indices = np.nonzero(unassigned_mask)[0][unique_indices]
        
        # Assign zoom level
        assigned_z[original_indices] = z
        
        # Update unassigned mask
        unassigned_mask[original_indices] = False
        
        print(f"Z={z} assigned {len(unique_indices)} stars. Remaining unassigned: {unassigned_mask.sum()}")
        
        if unassigned_mask.sum() == 0:
            break
            
    print(f"Numpy bucketing completed in {time.time() - start_time:.3f} seconds.")

if __name__ == "__main__":
    test_numpy_bucketing()
