import sqlite3
import struct
import zlib
import json

def get_tile():
    f = open('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles', 'rb')
    f.seek(0)
    magic = f.read(2)
    if magic != b'PM':
        print("Not a PMTiles file")
        return
    
    f.seek(0)
    data = f.read(1024 * 1024) # Read first 1MB
    idx = data.find(b'\xff\xff\xff\xff')
    if idx == -1:
        print("No arrow IPC magic found in first 1MB!")
        # Let's search for Zstd magic: 28 B5 2F FD -> FD 2F B5 28
        idx_zstd = data.find(b'\x28\xb5\x2f\xfd')
        if idx_zstd != -1:
            print(f"Found Zstd magic at {idx_zstd}!")
        else:
            print("No Zstd magic found either.")
        return
    print(f"Found Arrow IPC magic at offset {idx}")
    print(data[idx:idx+32].hex())
    
get_tile()
