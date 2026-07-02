import sys
from pmtiles.tile import zxy_to_tileid
import duckdb

con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
con.execute("LOAD 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")

for z in range(0, 4):
    for x in range(2**z):
        for y in range(2**z):
            # PMTiles TileID
            tid_pm = zxy_to_tileid(z, x, y)
            
            # DuckDB Hilbert
            x_norm = (x + 0.5) / (2**z)
            y_norm = (y + 0.5) / (2**z)
            z_offset = (4**z - 1) // 3
            query = f"SELECT {z_offset} + hilbert_normalized({x_norm}::DOUBLE, {y_norm}::DOUBLE, {z}::UTINYINT)"
            tid_duck = con.execute(query).fetchone()[0]
            
            if tid_pm != tid_duck:
                print(f"Mismatch at z={z}, x={x}, y={y}: PMTiles={tid_pm}, DuckDB={tid_duck}")

print("All matched!")
