import duckdb
import time
import os
import argparse
import sys
import subprocess
import glob
import math
import shutil
import concurrent.futures
import threading
import json

def format_time(seconds):
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}h {m}m {s}s"
    elif m > 0:
        return f"{m}m {s}s"
    return f"{s}s"

def generate_pmtiles(input_parquet: str, output_pmtiles: str, temp_dir: str, max_capacity: int = 100000, max_zoom: int = 14, threads: int = 16, memory_limit: str = '40GB'):
    t_global_start = time.time()
    print(f"Starting pipeline. Input: {input_parquet}")
    os.makedirs(temp_dir, exist_ok=True)
    
    con = duckdb.connect(config={'allow_unsigned_extensions': 'true', 'temp_directory': temp_dir, 'max_memory': memory_limit})
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    ext_path = os.path.abspath(os.path.join(base_dir, '..', 'duckdb-arrowtiles', 'target', 'release', 'arrowtiles.duckdb_extension')).replace('\\', '/')
    
    grid_size = 1 << int(math.ceil(math.log2(math.sqrt(max_capacity))))
    print(f"Max capacity {max_capacity} yields voxel grid size of {grid_size}x{grid_size} per tile.")

    # Partition the data into Z=3 tiles (64 chunks)
    partition_dir = os.path.join(temp_dir, 'partitions')
    if not os.path.exists(partition_dir):
        print("\n--- Stage 1: Spatial Partitioning ---")
        t_s1 = time.time()
        os.makedirs(partition_dir, exist_ok=True)
        
        con.execute(f"""
            COPY (
                WITH raw_data AS (
                    SELECT 
                        ra, dec, magnitude, bv, parallax, pmra, pmdec, radial_velocity, teff_gspphot,
                        RADIANS(ra) AS ra_rad,
                        RADIANS(dec) AS dec_rad,
                        RADIANS(192.85948) AS a_g,
                        RADIANS(27.12825) AS d_g,
                        RADIANS(122.93192) AS l_ncp
                    FROM read_parquet('{input_parquet}')
                ),
                galactic AS (
                    SELECT 
                        magnitude, bv, parallax, pmra, pmdec, radial_velocity, teff_gspphot,
                        ASIN(SIN(d_g)*SIN(dec_rad) + COS(d_g)*COS(dec_rad)*COS(ra_rad - a_g)) AS b_rad,
                        l_ncp - ATAN2(
                            COS(dec_rad)*SIN(ra_rad - a_g), 
                            COS(d_g)*SIN(dec_rad) - SIN(d_g)*COS(dec_rad)*COS(ra_rad - a_g)
                        ) AS l_rad_raw
                    FROM raw_data
                ),
                wrapped AS (
                    SELECT
                        magnitude, bv, parallax, pmra, pmdec, radial_velocity, teff_gspphot, b_rad,
                        -- Robustly wrap to [-PI, PI]
                        ((l_rad_raw + 5*PI()) % (2*PI())) - PI() AS l_rad
                    FROM galactic
                    WHERE ra IS NOT NULL 
                      AND dec IS NOT NULL 
                      AND phot_g_mean_mag IS NOT NULL
                ),
                proj AS (
                    SELECT 
                        *,
                        (ra / 360.0) AS x_norm,
                        ((dec + 90.0) / 180.0) AS y_norm
                    FROM raw
                )
                SELECT 
                    x_norm,
                    y_norm,
                    (FLOOR(x_norm * 8.0)::BIGINT + FLOOR(y_norm * 8.0)::BIGINT * 8) AS z3_chunk_id,
                    * EXCLUDE (x_norm, y_norm)
                FROM proj
            ) TO '{partition_dir}' (FORMAT PARQUET, PARTITION_BY z3_chunk_id)
        """)
        print(f"Stage 1 completed in {format_time(time.time() - t_s1)}")
    else:
        print("Stage 1 partitions already exist, skipping...")
        
    print("\n--- Stage 2: In-Memory Voxel Bucketing (Chunked) ---")
    t_s2 = time.time()
    
    assigned_dir = os.path.join(temp_dir, 'assigned_chunks')
    os.makedirs(assigned_dir, exist_ok=True)
    
    chunk_dirs = glob.glob(os.path.join(partition_dir, 'z3_chunk_id=*'))
    total_chunks = len(chunk_dirs)
    
    print(f"Discovered {total_chunks} macro-chunks from Stage 1.")
    
    def process_chunk(chunk_dir):
        chunk_id = os.path.basename(chunk_dir).split('=')[1]
        chunk_assigned_file = os.path.join(assigned_dir, f'chunk_{chunk_id}.parquet')
        final_assigned_file = chunk_assigned_file.replace('.parquet', '_final.parquet')
        
        if os.path.exists(final_assigned_file):
            return 0, chunk_id, True
            
        t_chunk_start = time.time()
        chunk_input = os.path.join(chunk_dir, '*.parquet')
        
        base_dir = os.path.dirname(os.path.abspath(__file__))
        exe_ext = '.exe' if sys.platform == 'win32' else ''
        engine_path = os.path.abspath(os.path.join(base_dir, '..', 'duckdb-arrowtiles', 'target', 'release', f'arrowtiles_engine{exe_ext}'))
        chunk_sorted = os.path.join(assigned_dir, f'chunk_{chunk_id}_sorted.parquet')
        
        local_con = duckdb.connect(config={'allow_unsigned_extensions': 'true', 'temp_directory': temp_dir})
        local_con.execute("SET threads=2;")
        
        local_con.execute(f"""
            COPY (
                SELECT 
                    x_norm, y_norm, abs_m, bp_rp, parallax, pmra, pmdec, radial_velocity, teff_gspphot,
                    FLOOR(x_norm::DOUBLE * {grid_size})::BIGINT AS vx_0,
                    FLOOR(y_norm::DOUBLE * {grid_size})::BIGINT AS vy_0
                FROM read_parquet('{chunk_input}')
                ORDER BY abs_m ASC
            ) TO '{chunk_sorted}' (FORMAT PARQUET)
        """)
        
        subprocess.run([engine_path, '--bucketer', chunk_sorted, final_assigned_file, str(grid_size), str(max_zoom)], check=True)
        local_con.close()
        
        try:
            os.remove(chunk_sorted)
        except OSError:
            pass
            
        chunk_elapsed = time.time() - t_chunk_start
        return chunk_elapsed, chunk_id, False

    from tqdm import tqdm
    
    max_workers = 2 # Hardcapped to 2 to prevent 8 parallel DuckDB connections from starving 40GB RAM limit and causing thrashing
    print(f"Processing with {max_workers} parallel workers to conserve RAM...")
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_chunk, chunk_dir): chunk_dir for chunk_dir in chunk_dirs}
        
        for future in tqdm(concurrent.futures.as_completed(futures), total=total_chunks, desc="Processing Buckets", unit="chunk"):
            chunk_elapsed, chunk_id, skipped = future.result()

    print(f"Stage 2 completed globally in {format_time(time.time() - t_s2)}")
    
    print("\n--- Stage 3: PMTiles Export ---")
    t_pack = time.time()
    
    final_parquet_path = os.path.join(temp_dir, 'final_ordered.parquet')
    
    print("Sorting all consolidated chunk points globally by z and final_tile_id...")
    con.execute(f"""
        COPY (
            SELECT * FROM read_parquet('{assigned_dir}/*_final.parquet')
            ORDER BY z ASC, final_tile_id ASC, abs_m ASC
        ) TO '{final_parquet_path}' (FORMAT PARQUET)
    """)
    
    print("Skipping 1.8B row metadata scan to prevent disk thrashing. Using hardcoded Gaia bounds...")
    metadata_json = {
        "abs_m": [-10.0, 20.0],
        "bp_rp": [-2.0, 6.0],
        "parallax": [-10.0, 100.0],
        "teff_gspphot": [2000.0, 15000.0],
        "radial_velocity": [-200.0, 200.0]
    }
    
    with open(output_pmtiles + ".metadata.json", "w") as f:
        json.dump(metadata_json, f)
    
    exe_ext = '.exe' if sys.platform == 'win32' else ''
    engine_path = os.path.abspath(os.path.join(base_dir, '..', 'duckdb-arrowtiles', 'target', 'release', f'arrowtiles_engine{exe_ext}'))
    print(f"Invoking Rust PMTiles Packer at {engine_path}...")
    
    t_pack = time.time()
    output_schema = output_pmtiles + ".schema"
    env_copy = os.environ.copy(); env_copy["TMPDIR"] = temp_dir; env_copy["TEMP"] = temp_dir; env_copy["TMP"] = temp_dir; subprocess.run([engine_path, '--packer', final_parquet_path, output_pmtiles, output_schema], env=env_copy, check=True)
    
    print(f"Success! Rust packer completed in {format_time(time.time() - t_pack)}")
    
    if os.path.exists(output_pmtiles):
        size_mb = os.path.getsize(output_pmtiles) / (1024 * 1024)
        print(f"\nPipeline Complete! Final archive size: {size_mb:.2f} MB")
    
    print(f"Total Pipeline Execution Time: {format_time(time.time() - t_global_start)}")
    
    try:
        shutil.rmtree(partition_dir)
        shutil.rmtree(assigned_dir)
        os.remove(final_parquet_path)
    except OSError:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, default="D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/s3_cache/**/*.parquet")
    parser.add_argument("--output", type=str, default="./public/gaia.arrowtiles")
    parser.add_argument("--temp_dir", type=str, default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'duckdb_temp'))
    parser.add_argument("--max_capacity", type=int, default=100000)
    parser.add_argument("--max_zoom", type=int, default=14)
    parser.add_argument("--threads", type=int, default=16)
    parser.add_argument("--memory-limit", type=str, default="40GB")
    
    args = parser.parse_args()
    
    generate_pmtiles(
        input_parquet=args.input, 
        output_pmtiles=args.output, 
        temp_dir=args.temp_dir,
        max_capacity=args.max_capacity,
        max_zoom=args.max_zoom,
        threads=args.threads, 
        memory_limit=args.memory_limit
    )
