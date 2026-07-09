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
    
    print("Combined size:", len(combined))
    
    # Read messages one by one
    reader = pa.ipc.open_stream(combined)
    print("Schema:", reader.schema)
    
    # Let's inspect the flatbuffers sizes!
    pos = len(schema_bytes)
    print("Data starts at:", pos)
    
    # Let's read raw bytes
    import struct
    
    while pos < len(combined):
        if pos + 4 > len(combined):
            break
        marker = struct.unpack('<I', combined[pos:pos+4])[0]
        if marker == 0xFFFFFFFF:
            if pos + 8 > len(combined):
                break
            msg_len = struct.unpack('<I', combined[pos+4:pos+8])[0]
            print(f"Message at {pos}, length {msg_len}")
            pos += 8 + msg_len
        elif marker == 0:
            print(f"Zero marker (EOS?) at {pos}")
            # Count how many zeroes
            zeros = 0
            while pos < len(combined) and combined[pos] == 0:
                zeros += 1
                pos += 1
            print(f"Found {zeros} zeroes, now at {pos}")
        else:
            print(f"Unknown marker at {pos}: {marker}")
            break

if __name__ == "__main__":
    run()
