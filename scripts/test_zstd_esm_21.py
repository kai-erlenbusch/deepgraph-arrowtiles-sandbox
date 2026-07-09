import zstandard as zstd
with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin', 'rb') as f:
    data = f.read()

try:
    print("Frame size:", zstd.get_frame_parameters(data).content_size)
except Exception as e:
    print("Error:", e)
