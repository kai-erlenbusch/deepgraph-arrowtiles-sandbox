import pyarrow as pa
import zstandard as zstd

def run():
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin', 'rb') as f:
        compressed = f.read()
        
    dctx = zstd.ZstdDecompressor()
    raw_data = dctx.decompress(compressed, max_output_size=50000000)
    
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema', 'rb') as f:
        schema_bytes = f.read()
        
    combined = schema_bytes + raw_data
    
    # Try reading as IPC stream
    try:
        with pa.ipc.open_stream(combined) as reader:
            table = reader.read_all()
            print("Successfully read table via pyarrow stream!")
            print("Rows:", table.num_rows)
            return
    except Exception as e:
        print("Failed to read as IPC stream:", e)
        
    # Try reading as IPC file
    try:
        magic = b'ARROW1\0\0'
        file_combined = magic + raw_data + magic
        with pa.ipc.open_file(file_combined) as reader:
            table = reader.read_all()
            print("Successfully read table via pyarrow file!")
            print("Rows:", table.num_rows)
            return
    except Exception as e:
        print("Failed to read as IPC file:", e)

if __name__ == "__main__":
    run()
