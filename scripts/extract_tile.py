from pmtiles.reader import Reader
import zlib
import json

def get_tile():
    f = open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles', 'rb')
    reader = Reader(f)
    print("Header:", reader.header())
    print("Metadata:", reader.metadata())
    
    # get tile Z=0, X=0, Y=0
    tile_data = reader.get(0, 0, 0)
    if not tile_data:
        print("No tile data found for 0/0/0")
        return
        
    print(f"Tile 0/0/0 length: {len(tile_data)} bytes")
    
    # Save the tile data to a file so we can analyze it
    with open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0.arrow', 'wb') as out_f:
        out_f.write(tile_data)
    print("Tile saved to public/tile_0_0_0.arrow")

get_tile()
