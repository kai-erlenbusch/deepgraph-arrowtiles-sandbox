import sys
from pmtiles.reader import Reader, MmapSource

def run():
    with open(r'D:\exploratory\duckdb-extension\deepgraph-arrowtiles-sandbox\public\gaia.arrowtiles', 'r+b') as f:
        source = MmapSource(f)
        reader = Reader(source)
        tile_data = reader.get(0, 0, 0)
        
        if tile_data:
            with open(r'D:\exploratory\duckdb-extension\deepgraph-arrowtiles-sandbox\public\tile_0_0_0_NEW_COMPRESSED.bin', 'wb') as out:
                out.write(tile_data)
            print(f"Wrote {len(tile_data)} compressed bytes")
        else:
            print("Tile not found")

if __name__ == "__main__":
    run()
