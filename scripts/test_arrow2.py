import pyarrow as pa
import pyarrow.ipc as ipc
import zstandard as zstd
import json

def test():
    # 1. Read the tile bytes
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0.arrow', 'rb') as f:
        compressed_data = f.read()
        
    print(f"Compressed size: {len(compressed_data)}")
    
    # 2. Decompress Zstd
    dctx = zstd.ZstdDecompressor()
    decompressed_data = dctx.decompress(compressed_data, max_output_size=500*1024*1024)
    print(f"Decompressed size: {len(decompressed_data)}")
    
    # 3. Print first 32 bytes of decompressed data
    print(f"Decompressed magic: {decompressed_data[:32].hex()}")
    
    # 4. Try parsing it as an Arrow IPC stream
    try:
        with pa.ipc.open_stream(decompressed_data) as reader:
            schema = reader.schema
            print(f"Parsed with native schema! Schema: {schema}")
            batches = [b for b in reader]
            print(f"Num batches: {len(batches)}")
            rows = sum(b.num_rows for b in batches)
            print(f"Total rows: {rows}")
    except Exception as e:
        print(f"Failed to parse with native schema: {e}")
        
    # 5. Load the embedded schema and prepend it
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles', 'rb') as f:
        schema_b64 = '/////3gCAAAQAAAAAAAKAAwACgAJAAQACgAAABAAAAAAAQQACAAIAAAABAAIAAAABAAAAAoAAADsAQAArAEAAGgBAAA4AQAACAEAANAAAACYAAAAYAAAADAAAAAEAAAAiP7//xAAAAAUAAAAAAABAhAAAACq////CAAAAAAAAAABAAAAegAAALD+//8QAAAAFAAAAAAAAQIQAAAA0v///xAAAAAAAAAABQAAAHlfdTE2AAAAoP7//xgAAAAcAAAAAAABAhgAAAAAAAYACAAEAAYAAAAQAAAAAAAAAAUAAAB4X3UxNgAAABD///8QAAAAFAAAAAAAAQMQAAAAwv7//wAAAQAAAAAADAAAAHRlZmZfZ3NwcGhvdAAAAABE////EAAAABQAAAAAAAEDEAAAAPb+//8AAAEAAAAAAA8AAAByYWRpYWxfdmVsb2NpdHkAeP///xAAAAAUAAAAAAABAxAAAAAq////AAABAAAAAAAFAAAAcG1kZWMAAACk////EAAAABQAAAAAAAEDEAAAAFb///8AAAEAAAAAAAQAAABwbXJhAAAAAND///8QAAAAFAAAAAAAAQMQAAAAgv///wAAAQAAAAAACAAAAHBhcmFsbGF4AAAAABAAFAAQAA4ADwAEAAAACAAQAAAAEAAAABQAAAAAAAEDEAAAAML///8AAAEAAAAAAAUAAABicF9ycAAAABAAFgAQAA4ADwAEAAAACAAQAAAAGAAAABwAAAAAAAEDGAAAAAAABgAIAAYABgAAAAAAAQAAAAAABQAAAGFic19tAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
        import base64
        schema_bytes = base64.b64decode(schema_b64)
        print(f"Loaded schema bytes: {len(schema_bytes)}")
        
        ipc_buffer = schema_bytes + decompressed_data
        try:
            with pa.ipc.open_stream(ipc_buffer) as reader:
                schema = reader.schema
                print(f"Parsed with prepended schema! Schema: {schema}")
                batches = [b for b in reader]
                print(f"Num batches: {len(batches)}")
                rows = sum(b.num_rows for b in batches)
                print(f"Total rows: {rows}")
        except Exception as e:
            print(f"Failed to parse with prepended schema: {e}")

if __name__ == '__main__':
    test()
