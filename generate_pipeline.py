import duckdb
import time
import pyarrow as pa
import pyarrow.parquet as pq
import base64
import json
import collections
import os
from pmtiles.writer import Writer

def generate_pmtiles(input_parquet: str, output_pmtiles: str, max_capacity: int = 50000, max_zoom: int = 14):
    print(f"Starting pipeline. Input: {input_parquet}")
    os.makedirs('duckdb_temp', exist_ok=True)
    con = duckdb.connect(config={'allow_unsigned_extensions': 'true', 'temp_directory': 'duckdb_temp'})
    
    print("Loading arrowtiles extension...")
    con.execute("LOAD 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1'; SET threads=16; PRAGMA memory_limit='40GB';")

    print("Reading from local s3_cache...")
    start_time = time.time()
    
    # 1. Base Query for projection and generating all 15 tile IDs upfront
    udf_calls = ",\n".join([f"hilbert_normalized(x_norm, y_norm, {z}::UTINYINT) AS t{z}" for z in range(max_zoom + 1)])
    
    query = f"""
        WITH raw_data AS (
            SELECT 
                ra, dec, magnitude, bv,
                RADIANS(ra) AS ra_rad,
                RADIANS(dec) AS dec_rad,
                RADIANS(192.85948) AS a_g,
                RADIANS(27.12825) AS d_g,
                RADIANS(32.93192) AS l_n
            FROM read_parquet('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/s3_cache/*.parquet')
            ORDER BY magnitude ASC
        ),
        galactic AS (
            SELECT
                magnitude, bv,
                ASIN(SIN(d_g)*SIN(dec_rad) + COS(d_g)*COS(dec_rad)*COS(ra_rad - a_g)) AS b_rad,
                l_n + ATAN2(COS(dec_rad)*SIN(ra_rad - a_g), COS(d_g)*SIN(dec_rad) - SIN(d_g)*COS(dec_rad)*COS(ra_rad - a_g)) AS l_rad_raw
            FROM raw_data
        ),
        normalized AS (
            SELECT
                magnitude, bv, b_rad,
                CASE 
                    WHEN l_rad_raw > PI() THEN l_rad_raw - 2*PI() 
                    WHEN l_rad_raw < -PI() THEN l_rad_raw + 2*PI() 
                    ELSE l_rad_raw 
                END AS l_rad
            FROM galactic
        ),
        gaia_sampled AS (
            SELECT 
                ( ( -2 * sqrt(2) * cos(b_rad) * sin(l_rad / 2) ) / sqrt(1 + cos(b_rad) * cos(l_rad / 2)) + 2.8284271247461903 ) / 5.6568542494923806 AS x_norm,
                ( ((sqrt(2) * sin(b_rad)) / sqrt(1 + cos(b_rad) * cos(l_rad / 2))) + 1.4142135623730951 ) / 2.8284271247461903 AS y_norm,
                magnitude, bv
            FROM normalized
        )
        SELECT 
            x_norm, y_norm, CAST(magnitude AS FLOAT) AS abs_m, CAST(bv AS FLOAT) AS bp_rp,
            {udf_calls}
        FROM gaia_sampled
    """

    print("Executing query and dumping to sorted_base.parquet (Sorting Data ONCE)...")
    con.execute(f"COPY ({query}) TO 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/sorted_base.parquet' (FORMAT PARQUET)")
    
    print("Streaming batches via PyArrow and assigning Zoom Levels dynamically...")
    capacities = collections.defaultdict(int)
    total_processed = 0
    global_ix = 1
    
    parquet_file = pq.ParquetFile('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/sorted_base.parquet')
    
    # Setup PyArrow writer for the assigned points
    assigned_schema = pa.schema([
        ('x_norm', pa.float32()),
        ('y_norm', pa.float32()),
        ('abs_m', pa.float32()),
        ('bp_rp', pa.float32()),
        ('ix', pa.float32()),
        ('z', pa.uint8()),
        ('final_tile_id', pa.uint64())
    ])
    writer_assigned = pq.ParquetWriter('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/assigned_points.parquet', assigned_schema)
    
    for batch in parquet_file.iter_batches(batch_size=100000):
        if batch.num_rows == 0:
            continue
            
        # Cast to float32 safely here so our output buffer matches WebGPU strictly
        x_norms = batch.column("x_norm").cast(pa.float32()).to_pylist()
        y_norms = batch.column("y_norm").cast(pa.float32()).to_pylist()
        abs_ms = batch.column("abs_m").cast(pa.float32()).to_pylist()
        bp_rps = batch.column("bp_rp").cast(pa.float32()).to_pylist()
        
        t_cols = [batch.column(f"t{z}").to_pylist() for z in range(max_zoom + 1)]
        
        out_x, out_y, out_m, out_c, out_i, out_z, out_tid = [], [], [], [], [], [], []
        
        for i in range(batch.num_rows):
            current_ix = global_ix
            global_ix += 1
            for z in range(max_zoom + 1):
                tid = t_cols[z][i]
                if capacities[(z, tid)] < max_capacity:
                    capacities[(z, tid)] += 1
                    out_x.append(x_norms[i])
                    out_y.append(y_norms[i])
                    out_m.append(abs_ms[i])
                    out_c.append(bp_rps[i])
                    out_i.append(float(current_ix))
                    out_z.append(z)
                    out_tid.append(tid)
                    break
        
        if len(out_x) > 0:
            out_batch = pa.RecordBatch.from_arrays([
                pa.array(out_x, type=pa.float32()),
                pa.array(out_y, type=pa.float32()),
                pa.array(out_m, type=pa.float32()),
                pa.array(out_c, type=pa.float32()),
                pa.array(out_i, type=pa.float32()),
                pa.array(out_z, type=pa.uint8()),
                pa.array(out_tid, type=pa.uint64())
            ], schema=assigned_schema)
            
            writer_assigned.write_batch(out_batch)
            
        total_processed += batch.num_rows
        if total_processed % 1000000 < batch.num_rows:
            print(f"Assigned {total_processed} points in Python loop...")
            
    writer_assigned.close()
            
    if total_processed == 0:
        print("ERROR: Zero points were streamed. The reader was empty.")
        return

    print(f"Points assigned! Sorting {total_processed} points by tile_id for PMTiles export...")
    # This is the 2nd (and final) database sort
    con.execute("COPY (SELECT * FROM read_parquet('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/assigned_points.parquet') ORDER BY final_tile_id) TO 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered.parquet' (FORMAT PARQUET)")
    
    final_pq = pq.ParquetFile('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered.parquet')
    schema = final_pq.schema_arrow

    print(f"Opening PMTiles writer at {output_pmtiles}...")
    with open(output_pmtiles, "wb") as f:
        writer = Writer(f)
        
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, schema) as stream_writer:
            pass
        schema_bytes = sink.getvalue().to_pybytes()
        schema_base64 = base64.b64encode(schema_bytes).decode("utf-8")
        metadata = {
            "format": "arrow_ipc", 
            "compression": "none", 
            "schema_base64": schema_base64
        }
        
        current_tile_id = None
        current_batches = []
        rows_exported = 0

        def flush_tile(tid, batches):
            if not batches:
                return
            
            combined = pa.Table.from_batches(batches, schema=schema).combine_chunks()
            if len(combined.to_batches()) == 0:
                return
            batch = combined.to_batches()[0]
            
            sink = pa.BufferOutputStream()
            with pa.ipc.new_stream(sink, schema) as stream_writer:
                stream_writer.write_batch(batch)
            tile_bytes = sink.getvalue().to_pybytes()
            
            writer.write_tile(tid, tile_bytes)

        for batch in final_pq.iter_batches(batch_size=100000):
            tile_ids = batch.column("final_tile_id").to_pylist()
            
            start_idx = 0
            for i in range(len(tile_ids)):
                tid = tile_ids[i]
                if tid is None:
                    continue
                
                if current_tile_id is None:
                    current_tile_id = tid
                
                if tid != current_tile_id:
                    if i > start_idx:
                        slice_batch = batch.slice(start_idx, i - start_idx)
                        current_batches.append(slice_batch)
                    
                    flush_tile(current_tile_id, current_batches)
                    current_batches = []
                    current_tile_id = tid
                    start_idx = i
                    
            if start_idx < batch.num_rows and current_tile_id is not None:
                current_batches.append(batch.slice(start_idx, batch.num_rows - start_idx))
                
            rows_exported += batch.num_rows
            
        if current_tile_id is not None and current_batches:
            flush_tile(current_tile_id, current_batches)
            
        # Write metadata dictionary and blank header dictionary for PMTiles v3
        writer.finalize({}, metadata)
        
    print(f"Success! Exported {rows_exported} rows in {time.time() - start_time:.2f} seconds.")

if __name__ == "__main__":
    INPUT_DATA = "s3://stpubdata/gaia/gaia_dr3/public/hats/gaia/dataset/**/*.parquet" 
    OUTPUT_FILE = "D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.pmtiles"
    
    generate_pmtiles(INPUT_DATA, OUTPUT_FILE)
