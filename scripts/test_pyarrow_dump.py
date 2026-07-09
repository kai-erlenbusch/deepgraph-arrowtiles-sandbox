import zstandard as zstd
import pyarrow as pa

with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin', 'rb') as f:
    compressed = f.read()

dctx = zstd.ZstdDecompressor()
raw_data = dctx.decompress(compressed, max_output_size=50000000)

print("PY first 16 bytes:", " ".join(f"{b:02x}" for b in raw_data[:16]))
print("PY 1032-1048 bytes:", " ".join(f"{b:02x}" for b in raw_data[1032:1048]))
