import zstandard as zstd
with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin', 'rb') as f:
    compressed = f.read()

dctx = zstd.ZstdDecompressor()
# Use stream_reader to decompress all frames
stream_reader = dctx.stream_reader(compressed)
raw_data_stream = stream_reader.read()
print("Stream reader size:", len(raw_data_stream))

# Use simple decompress
raw_data_simple = dctx.decompress(compressed, max_output_size=50000000)
print("Simple decompress size:", len(raw_data_simple))
