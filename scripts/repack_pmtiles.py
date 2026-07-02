import pyarrow.parquet as pq
import pyarrow as pa
from pmtiles.writer import Writer
import os
import numpy as np

def main():
    final_parquet_path = 'duckdb_temp/final_ordered.parquet'
    output_pmtiles = 'public/gaia.pmtiles'
    
    print(f"Opening PMTiles writer at {output_pmtiles}...")
    final_pq = pq.ParquetFile(final_parquet_path)
    schema = final_pq.schema_arrow
    export_schema = schema.remove(schema.get_field_index("final_tile_id")).remove(schema.get_field_index("z"))

    with open(output_pmtiles, "wb") as f:
        writer = Writer(f)
        
        current_tile_id = None
        current_z = None
        current_batches = []

        def flush_tile(z, tid, batches):
            if not batches:
                return
            table = pa.Table.from_batches(batches, schema=schema)
            if table.num_rows == 0: return
            
            final_table = table.drop_columns(["final_tile_id", "z"])
            sink = pa.BufferOutputStream()
            # UNCOMPRESSED IPC STREAM
            with pa.ipc.new_stream(sink, export_schema) as stream_writer:
                stream_writer.write_table(final_table)
            
            writer.write_tile(tid, sink.getvalue().to_pybytes())

        for batch in final_pq.iter_batches(batch_size=500000):
            if batch.num_rows == 0: continue
            
            tile_ids_arr = batch.column("final_tile_id").to_numpy(zero_copy_only=False)
            z_arr = batch.column("z").to_numpy(zero_copy_only=False)
            
            boundaries = np.where((tile_ids_arr[:-1] != tile_ids_arr[1:]) | (z_arr[:-1] != z_arr[1:]))[0] + 1
            split_indices = np.concatenate(([0], boundaries, [len(tile_ids_arr)]))
            
            for i in range(len(split_indices) - 1):
                start_idx, end_idx = split_indices[i], split_indices[i+1]
                tid = int(tile_ids_arr[start_idx])
                z_val = int(z_arr[start_idx])
                
                slice_batch = batch.slice(start_idx, end_idx - start_idx)
                
                if current_tile_id is None:
                    current_tile_id = tid
                    current_z = z_val
                
                if tid != current_tile_id or z_val != current_z:
                    flush_tile(current_z, current_tile_id, current_batches)
                    current_batches.clear()
                    current_tile_id = tid
                    current_z = z_val
                    
                current_batches.append(slice_batch)
                
        flush_tile(current_z, current_tile_id, current_batches)
            
        print("Finalizing PMTiles archive...")
        from pmtiles.tile import Compression, TileType
        header = {
            "min_zoom": 0,
            "max_zoom": 14,
            "min_lon_e7": -1800000000,
            "min_lat_e7": -900000000,
            "max_lon_e7": 1800000000,
            "max_lat_e7": 900000000,
            "center_zoom": 0,
            "center_lon_e7": 0,
            "center_lat_e7": 0,
            "tile_type": TileType.UNKNOWN,
            "tile_compression": Compression.NONE
        }
        metadata = {
            "name": "Gaia Dataset",
            "description": "Gaia 1B subset generated via DuckDB (Uncompressed Arrow)",
            "version": "3",
            "format": "application/vnd.apache-arrow"
        }
        writer.finalize(header, metadata)
        
    print(f"Done! Created {output_pmtiles}")

if __name__ == '__main__':
    main()
