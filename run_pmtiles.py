import pyarrow.parquet as pq
import pyarrow as pa
import pmtiles.writer
import numpy as np

print(f"Opening PMTiles writer at gaia.pmtiles...")
output_pmtiles = "D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/gaia.pmtiles"
final_pq = pq.ParquetFile('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered_new.parquet')
schema = final_pq.schema_arrow

with open(output_pmtiles, "wb") as f:
    writer = pmtiles.writer.Writer(f)
    
    current_tile_id = None
    current_z = None
    current_batches = []
    
    print("Writing PMTiles archive...")
    total_processed = 0
    for batch in final_pq.iter_batches(batch_size=1000000):
        if batch.num_rows == 0:
            continue
            
        total_processed += batch.num_rows
        if total_processed % 10000000 == 0:
            print(f"Processed {total_processed} rows into PMTiles...")
            
        tids = batch.column("final_tile_id").to_numpy()
        zs = batch.column("z").to_numpy()
        
        # Find indices where tid changes
        change_indices = np.where(tids[:-1] != tids[1:])[0] + 1
        split_indices = np.concatenate(([0], change_indices, [batch.num_rows]))
        
        for i in range(len(split_indices) - 1):
            start = split_indices[i]
            end = split_indices[i+1]
            
            tid = int(tids[start])
            z = int(zs[start])
            
            row_data = batch.slice(start, end - start)
            
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
                
                # PMTiles requires a 1D tile_id (Hilbert/Z-Order index)
                writer.write_tile(int(current_tile_id), tile_data)
                
                current_tile_id = tid
                current_z = z
                current_batches = [row_data]

    if len(current_batches) > 0:
        combined_batch = pa.concat_batches(current_batches)
        sink = pa.BufferOutputStream()
        with pa.ipc.new_file(sink, schema) as ipc_writer:
            ipc_writer.write_batch(combined_batch)
        tile_data = sink.getvalue().to_pybytes()
        writer.write_tile(int(current_tile_id), tile_data)

    metadata = {
        "name": "Gaia DR3 WebGPU ArrowTiles",
        "description": "Full 1.54B stars sorted by magnitude and Hilbert indexed",
        "version": "1.0",
        "type": "overlay",
        "format": "application/vnd.apache.arrow.file"
    }
    from pmtiles.tile import Compression, TileType
    header = {
        "tile_compression": Compression.NONE,
        "tile_type": TileType.UNKNOWN
    }
    writer.finalize(header, metadata)
print(f"DONE. PMTiles generated successfully at {output_pmtiles}")
