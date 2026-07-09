import zstandard as zstd
import struct

def run():
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin', 'rb') as f:
        compressed = f.read()
        
    dctx = zstd.ZstdDecompressor()
    raw_data = dctx.decompress(compressed, max_output_size=50000000)
    
    print("RawData length:", len(raw_data))
    print("First 16 bytes:", raw_data[:16].hex())
    print("First non-zero at:", next((i for i, x in enumerate(raw_data) if x != 0), -1))

if __name__ == "__main__":
    run()
