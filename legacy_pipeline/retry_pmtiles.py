import os
import time
import base64
import pyarrow as pa
import pyarrow.parquet as pq
from pmtiles.writer import Writer
from pmtiles.tile import Compression, TileType
import tempfile

# ---------------------------------------------------------
# C: DRIVE FIX
# pmtiles.writer uses tempfile to buffer writes. Force it to D: drive
# ---------------------------------------------------------
duckdb_temp = os.path.abspath("duckdb_temp")
os.makedirs(duckdb_temp, exist_ok=True)
tempfile.tempdir = duckdb_temp

def generate_pmtiles():
    start_time = time.time()
    output_pmtiles = "./public/gaia.pmtiles"
    
    final_pq = pq.ParquetFile('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered.parquet')
    schema = final_pq.schema_arrow
    export_schema = schema.remove(schema.get_field_index("final_tile_id"))

    t_pack = time.time()
    print(f"Opening PMTiles writer at {output_pmtiles}...")
    with open(output_pmtiles, "wb") as f:
        writer = Writer(f)
        
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, export_schema) as stream_writer:
            pass
        schema_bytes = sink.getvalue().to_pybytes()
        schema_base64 = base64.b64encode(schema_bytes).decode("utf-8")
        metadata = {
            "format": "arrow_ipc", 
            "compression": "none", 
            "schema_base64": schema_base64
        }
        
        current_tile_id = None
        current_z = None
        current_batches = []
        rows_exported = 0

        def flush_tile(z, tid, batches):
            if not batches:
                return
            
            combined = pa.Table.from_batches(batches, schema=schema).combine_chunks()
            if len(combined.to_batches()) == 0:
                return
            
            # Drop final_tile_id to save space on disk
            final_table = combined.drop(["final_tile_id"])
            batch = final_table.to_batches()[0]
            
            sink = pa.BufferOutputStream()
            with pa.ipc.new_stream(sink, export_schema) as stream_writer:
                stream_writer.write_batch(batch)
            tile_bytes = sink.getvalue().to_pybytes()
            
            writer.write_tile(tid, tile_bytes)

        for batch in final_pq.iter_batches(batch_size=100000):
            tile_ids = batch.column("final_tile_id").to_pylist()
            z_levels = batch.column("z").to_pylist()
            
            start_idx = 0
            for i in range(len(tile_ids)):
                tid = tile_ids[i]
                z_val = z_levels[i]
                if tid is None:
                    continue
                
                if current_tile_id is None:
                    current_tile_id = tid
                    current_z = z_val
                
                if tid != current_tile_id or z_val != current_z:
                    if i > start_idx:
                        slice_batch = batch.slice(start_idx, i - start_idx)
                        current_batches.append(slice_batch)
                    
                    flush_tile(current_z, current_tile_id, current_batches)
                    current_batches = []
                    current_tile_id = tid
                    current_z = z_val
                    start_idx = i
                    
            if start_idx < batch.num_rows and current_tile_id is not None:
                current_batches.append(batch.slice(start_idx, batch.num_rows - start_idx))
                
            rows_exported += batch.num_rows
            
        if current_tile_id is not None and current_batches:
            flush_tile(current_z, current_tile_id, current_batches)
            
        # Write metadata dictionary and blank header dictionary for PMTiles v3
        header = {
            "tile_compression": Compression.NONE,
            "tile_type": TileType.UNKNOWN
        }
        writer.finalize(header, metadata)
        
    print(f"Success! Exported {rows_exported} rows in {time.time() - start_time:.2f} seconds total.")
    print(f"[Profiling] PMTiles packing completed in {time.time() - t_pack:.2f}s")

if __name__ == "__main__":
    generate_pmtiles()
