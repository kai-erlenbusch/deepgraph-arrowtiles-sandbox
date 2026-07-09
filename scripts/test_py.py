import pyarrow as pa
import pyarrow.ipc as ipc
import zstandard as zstd
import base64

def test():
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0.arrow', 'rb') as f:
        compressed_data = f.read()
        
    dctx = zstd.ZstdDecompressor()
    decompressed_data = dctx.decompress(compressed_data, max_output_size=500*1024*1024)
    print(f"Decompressed magic: {decompressed_data[:32].hex()}")
    
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema', 'rb') as f:
        schema_bytes = f.read()
    print(f"Schema bytes: {len(schema_bytes)}")
    
    ipc_buffer = schema_bytes + decompressed_data
    print(f"Combined size: {len(ipc_buffer)}")
    
    with pa.ipc.open_stream(ipc_buffer) as reader:
        print(f"Parsed with prepended schema! Schema: {reader.schema}")
        batches = [b for b in reader]
        print(f"Num batches: {len(batches)}")
        rows = sum(b.num_rows for b in batches)
        print(f"Total rows: {rows}")

if __name__ == '__main__':
    test()
