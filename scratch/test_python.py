import duckdb
import pyarrow as pa
import numpy as np
import time

def test_python_bucketing():
    print("Loading test chunk into DuckDB...")
    con = duckdb.connect()
    grid_size = 317
    max_zoom = 14
    
    partition_file = "D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/partitions/z3_chunk_id=35/*.parquet"
    
    query = f"""
        SELECT 
            x_norm, y_norm, abs_m,
            FLOOR(x_norm::DOUBLE * {grid_size}) AS vx_0,
            FLOOR(y_norm::DOUBLE * {grid_size}) AS vy_0
        FROM read_parquet('{partition_file}')
        ORDER BY vx_0 ASC, vy_0 ASC, abs_m ASC
    """
    
    t0 = time.time()
    arrow_table = con.execute(query).arrow()
    print(f"DuckDB query and Arrow fetch took {time.time() - t0:.2f}s")
    print(f"Loaded {arrow_table.num_rows} rows into memory.")
    
    t1 = time.time()
    
    x_arr = arrow_table.column('x_norm').to_numpy()
    y_arr = arrow_table.column('y_norm').to_numpy()
    vx0_arr = arrow_table.column('vx_0').to_numpy()
    vy0_arr = arrow_table.column('vy_0').to_numpy()
    
    assigned_z = np.full(len(x_arr), max_zoom, dtype=np.uint8)
    
    occupied = set()
    last_vx0 = -1
    last_vy0 = -1
    
    for j in range(len(x_arr)):
        vx0 = vx0_arr[j]
        vy0 = vy0_arr[j]
        
        if vx0 != last_vx0 or vy0 != last_vy0:
            occupied.clear()
            last_vx0 = vx0
            last_vy0 = vy0
            
        x = x_arr[j]
        y = y_arr[j]
        
        for z in range(max_zoom + 1):
            scale = 1 << z
            vx_z = int(x * grid_size * scale)
            vy_z = int(y * grid_size * scale)
            
            voxel_key = (z, vx_z, vy_z)
            if voxel_key not in occupied:
                occupied.add(voxel_key)
                assigned_z[j] = z
                break
                
    print(f"Python set-based bucketing completed in {time.time() - t1:.2f} seconds.")

if __name__ == "__main__":
    test_python_bucketing()
