import zstandard as zstd

def run():
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin', 'rb') as f:
        compressed = f.read()
        
    dctx = zstd.ZstdDecompressor()
    raw_data = dctx.decompress(compressed, max_output_size=50000000)
    
    target = bytes.fromhex('01000000010000000000000000000000010000000100000096000000d8000000')
    idx = raw_data.find(target)
    print("Found 01000000... at index:", idx)

if __name__ == "__main__":
    run()
