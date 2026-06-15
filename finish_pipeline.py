import duckdb
import pyarrow.parquet as pq
import pyarrow as pa
import json
import collections
import time
import os
import pmtiles.writer
import numpy as np
import pandas as pd

print("Streaming batches via PyArrow VECTORIZED and assigning Zoom Levels dynamically...")

capacities = collections.defaultdict(int)
total_processed = 0
global_ix = 1
max_zoom = 14
max_capacity = 50000

parquet_file = pq.ParquetFile('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/sorted_base.parquet')

assigned_schema = pa.schema([
    ('x_norm', pa.float32()),
    ('y_norm', pa.float32()),
    ('abs_m', pa.float32()),
    ('bp_rp', pa.float32()),
    ('ix', pa.float32()),
    ('z', pa.uint8()),
    ('final_tile_id', pa.uint64())
])
writer_assigned = pq.ParquetWriter('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/assigned_points_vec.parquet', assigned_schema)

start_time = time.time()
for batch in parquet_file.iter_batches(batch_size=100000):
    if batch.num_rows == 0:
        continue
        
    batch_size = batch.num_rows
    x_norms = batch.column("x_norm").to_numpy()
    y_norms = batch.column("y_norm").to_numpy()
    abs_ms = batch.column("abs_m").to_numpy()
    bp_rps = batch.column("bp_rp").to_numpy()
    
    t_cols = [batch.column(f"t{z}").to_numpy() for z in range(max_zoom + 1)]
    
    out_z = np.full(batch_size, 255, dtype=np.uint8)
    out_tid = np.zeros(batch_size, dtype=np.uint64)
    
    unassigned_mask = np.ones(batch_size, dtype=bool)
    original_indices = np.arange(batch_size)
    
    for z in range(max_zoom + 1):
        if not np.any(unassigned_mask):
            break
            
        current_indices = original_indices[unassigned_mask]
        tids_z = t_cols[z][unassigned_mask]
        
        unique_tids = np.unique(tids_z)
        base_caps_dict = {tid: capacities[(z, tid)] for tid in unique_tids}
        base_caps = pd.Series(tids_z).map(base_caps_dict).values
        
        cumcounts = pd.Series(tids_z).groupby(tids_z).cumcount().values
        
        total_counts = base_caps + cumcounts
        accepted = total_counts < max_capacity
        
        accepted_indices = current_indices[accepted]
        out_z[accepted_indices] = z
        out_tid[accepted_indices] = tids_z[accepted]
        
        accepted_tids = tids_z[accepted]
        if len(accepted_tids) > 0:
            unique_acc, counts_acc = np.unique(accepted_tids, return_counts=True)
            for tid, c in zip(unique_acc, counts_acc):
                capacities[(z, tid)] += c
                
        unassigned_mask[accepted_indices] = False
        
    out_i = np.arange(global_ix, global_ix + batch_size, dtype=np.float32)
    global_ix += batch_size
    
    out_batch = pa.RecordBatch.from_arrays([
        pa.array(x_norms),
        pa.array(y_norms),
        pa.array(abs_ms),
        pa.array(bp_rps),
        pa.array(out_i),
        pa.array(out_z),
        pa.array(out_tid)
    ], schema=assigned_schema)
    writer_assigned.write_batch(out_batch)
    
    total_processed += batch_size
    if total_processed % 1000000 == 0:
        elapsed = time.time() - start_time
        print(f"Assigned {total_processed} points in {elapsed:.2f} seconds...", flush=True)

writer_assigned.close()

print(f"Points assigned! Sorting {total_processed} points by tile_id for PMTiles export...")
con = duckdb.connect(config={'allow_unsigned_extensions': 'true', 'temp_directory': 'duckdb_temp', 'max_memory': '40GB'})
con.execute("COPY (SELECT * FROM read_parquet('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/assigned_points_vec.parquet') ORDER BY final_tile_id) TO 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered.parquet' (FORMAT PARQUET)")

final_pq = pq.ParquetFile('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered.parquet')
schema = final_pq.schema_arrow

print(f"Opening PMTiles writer at gaia.pmtiles...")
output_pmtiles = "gaia.pmtiles"
with open(output_pmtiles, "wb") as f:
    writer = pmtiles.writer.Writer(f)
    
    current_tile_id = None
    current_z = None
    current_batches = []
    
    print("Writing PMTiles archive...")
    for batch in final_pq.iter_batches(batch_size=100000):
        if batch.num_rows == 0:
            continue
            
        final_tile_ids = batch.column("final_tile_id").to_pylist()
        z_vals = batch.column("z").to_pylist()
        
        for i in range(batch.num_rows):
            tid = final_tile_ids[i]
            z = z_vals[i]
            row_data = batch.slice(i, 1)
            
            if current_tile_id is None:
                current_tile_id = tid
                current_z = z
                current_batches.append(row_data)
            elif current_tile_id == tid:
                current_batches.append(row_data)
            else:
                combined_batch = pa.concat_batches(current_batches)
                sink = pa.BufferOutputStream()
                with pa.ipc.new_file(sink, schema) as ipc_writer:
                    ipc_writer.write_batch(combined_batch)
                tile_data = sink.getvalue().to_pybytes()
                
                writer.write_tile(current_z, current_tile_id % (1 << current_z), current_tile_id // (1 << current_z), tile_data)
                
                current_tile_id = tid
                current_z = z
                current_batches = [row_data]

    if len(current_batches) > 0:
        combined_batch = pa.concat_batches(current_batches)
        sink = pa.BufferOutputStream()
        with pa.ipc.new_file(sink, schema) as ipc_writer:
            ipc_writer.write_batch(combined_batch)
        tile_data = sink.getvalue().to_pybytes()
        writer.write_tile(current_z, current_tile_id % (1 << current_z), current_tile_id // (1 << current_z), tile_data)

    metadata = {
        "name": "Gaia DR3 WebGPU ArrowTiles",
        "description": "Full 1.7B stars sorted by magnitude and Hilbert indexed",
        "version": "1.0",
        "type": "overlay",
        "format": "application/vnd.apache.arrow.file"
    }
    writer.finalize(metadata)
print(f"DONE. PMTiles generated successfully at {output_pmtiles}")
