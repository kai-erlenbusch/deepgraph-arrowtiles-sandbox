import duckdb
import time
import pyarrow as pa
import pyarrow.parquet as pq
import base64
import os
import argparse
import numpy as np
import math
import datetime
import glob
import shutil
from pmtiles.writer import Writer
from pmtiles.tile import Compression, TileType
import sys

def format_time(seconds):
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    if h > 0:
        return f"{h}h {m}m {s}s"
    elif m > 0:
        return f"{m}m {s}s"
    return f"{s}s"

def generate_pmtiles(input_parquet: str, output_pmtiles: str, temp_dir: str, max_capacity: int = 50000, max_zoom: int = 14, threads: int = 16, memory_limit: str = '40GB'):
    t_global_start = time.time()
    print(f"Starting pipeline. Input: {input_parquet}")
    os.makedirs(temp_dir, exist_ok=True)
    
    con = duckdb.connect(config={'allow_unsigned_extensions': 'true', 'temp_directory': temp_dir, 'max_memory': memory_limit})
    
    print("Loading arrowtiles extension for hilbert index generation...")
    extension_path = os.path.abspath(os.path.join(os.getcwd(), '..', 'duckdb-arrowtiles', 'target', 'release', 'arrowtiles.duckdb_extension'))
    con.execute(f"LOAD '{extension_path}'")
    con.execute(f"INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1'; SET threads={threads}; PRAGMA preserve_insertion_order=false;")
    con.execute("PRAGMA max_temp_directory_size='400GB'")
    con.execute("PRAGMA enable_progress_bar=true;")

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
                        ra, dec, magnitude, bv,
                        RADIANS(ra) AS ra_rad,
                        RADIANS(dec) AS dec_rad,
                        RADIANS(192.85948) AS a_g,
                        RADIANS(27.12825) AS d_g,
                        RADIANS(32.93192) AS l_n
                    FROM read_parquet('{input_parquet}')
                ),
                galactic AS (
                    SELECT 
                        magnitude, bv,
                        ASIN(SIN(d_g)*SIN(dec_rad) + COS(d_g)*COS(dec_rad)*COS(ra_rad - a_g)) AS b_rad,
                        ATAN2(COS(dec_rad)*SIN(ra_rad - a_g), COS(d_g)*SIN(dec_rad) - SIN(d_g)*COS(dec_rad)*COS(ra_rad - a_g)) AS l_rad_raw,
                        l_n
                    FROM raw_data
                ),
                normalized AS (
                    SELECT
                        magnitude, bv, b_rad,
                        (l_rad_raw + l_n) % (2 * PI()) AS l_rad_mod
                    FROM galactic
                ),
                wrapped AS (
                    SELECT
                        magnitude, bv, b_rad,
                        CASE 
                            WHEN l_rad_mod > PI() THEN l_rad_mod - 2*PI() 
                            WHEN l_rad_mod < -PI() THEN l_rad_mod + 2*PI() 
                            ELSE l_rad_mod 
                        END AS l_rad
                    FROM normalized
                ),
                gaia_sampled AS (
                    SELECT 
                        CAST(( ( -2 * sqrt(2) * cos(b_rad) * sin(l_rad / 2) ) / sqrt(1 + cos(b_rad) * cos(l_rad / 2)) + 2.8284271247461903 ) / 5.6568542494923806 AS FLOAT) AS x_norm,
                        1.0 - CAST(( ((sqrt(2) * sin(b_rad)) / sqrt(1 + cos(b_rad) * cos(l_rad / 2))) + 1.4142135623730951 ) / 2.8284271247461903 AS FLOAT) AS y_norm,
                        CAST(magnitude AS FLOAT) AS abs_m,
                        CAST(bv AS FLOAT) AS bp_rp
                    FROM wrapped
                )
                SELECT 
                    x_norm, y_norm, abs_m, bp_rp,
                    hilbert_normalized(x_norm::DOUBLE, y_norm::DOUBLE, 3::UTINYINT) AS z3_chunk_id
                FROM gaia_sampled
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
    ema_chunk_time = None
    processed_count = 0
    
    for i, chunk_dir in enumerate(chunk_dirs):
        chunk_id = os.path.basename(chunk_dir).split('=')[1]
        chunk_assigned_file = os.path.join(assigned_dir, f'chunk_{chunk_id}.parquet')
        final_assigned_file = chunk_assigned_file.replace('.parquet', '_final.parquet')
        
        if os.path.exists(final_assigned_file):
            print(f"[{i+1}/{total_chunks}] Chunk {chunk_id} already processed. Skipping.")
            processed_count += 1
            continue
            
        t_chunk_start = time.time()
        print(f"[{i+1}/{total_chunks}] Processing chunk {chunk_id} in-memory...", end="", flush=True)
        chunk_input = os.path.join(chunk_dir, '*.parquet')
        exe_ext = '.exe' if sys.platform == 'win32' else ''
        bucketer_path = os.path.abspath(os.path.join(os.getcwd(), '..', 'duckdb-arrowtiles', 'target', 'release', f'arrowtiles_bucketer{exe_ext}'))
        chunk_sorted = os.path.join(assigned_dir, f'chunk_{chunk_id}_sorted.parquet')
        
        # Sort by Z=0 voxel (vx_0, vy_0) and brightness (abs_m ASC)
        con.execute(f"""
            COPY (
                SELECT 
                    x_norm, y_norm, abs_m, bp_rp,
                    FLOOR(x_norm::DOUBLE * {grid_size})::BIGINT AS vx_0,
                    FLOOR(y_norm::DOUBLE * {grid_size})::BIGINT AS vy_0
                FROM read_parquet('{chunk_input}')
                ORDER BY abs_m ASC
            ) TO '{chunk_sorted}' (FORMAT PARQUET)
        """)
        
        t_buck = time.time()
        import subprocess
        subprocess.run([bucketer_path, chunk_sorted, final_assigned_file, str(grid_size), str(max_zoom)], check=True)
        
        chunk_elapsed = time.time() - t_chunk_start
        processed_count += 1
        
        if ema_chunk_time is None:
            ema_chunk_time = chunk_elapsed
        else:
            ema_chunk_time = 0.2 * chunk_elapsed + 0.8 * ema_chunk_time
            
        chunks_left = total_chunks - processed_count
        eta_seconds = chunks_left * ema_chunk_time
        
        print(f" -> {chunk_elapsed:.2f}s | ETA: {format_time(eta_seconds)}")
        
        try:
            os.remove(chunk_sorted)
        except OSError:
            pass

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
    
    exe_ext = '.exe' if sys.platform == 'win32' else ''
    packer_path = os.path.abspath(os.path.join(os.getcwd(), '..', 'duckdb-arrowtiles', 'target', 'release', f'arrowtiles_packer{exe_ext}'))
    print(f"Invoking Rust PMTiles Packer at {packer_path}...")
    
    import subprocess
    t_pack = time.time()
    
    subprocess.run([packer_path, final_parquet_path, output_pmtiles], check=True)
    
    print(f"Success! Rust packer completed in {format_time(time.time() - t_pack)}")
    
    if os.path.exists(output_pmtiles):
        size_mb = os.path.getsize(output_pmtiles) / (1024 * 1024)
        print(f"\n✅ Pipeline Complete! Final archive size: {size_mb:.2f} MB")
    
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
    parser.add_argument("--output", type=str, default="./public/gaia.pmtiles")
    parser.add_argument("--temp_dir", type=str, default=os.path.join(os.getcwd(), 'duckdb_temp'))
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
