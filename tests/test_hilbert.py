import pmtiles.tile
import duckdb
import os

def run_test():
    con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
    ext_path = 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'
    con.execute(f"LOAD '{ext_path}'")
    
    import numpy as np
    z = 3
    offset = (4**z - 1) // 3
    
    mismatches = 0
    
    for i in range(1000):
        x = np.random.random()
        y = np.random.random()
        
        duckdb_id = con.execute(f"SELECT hilbert_normalized({x}::DOUBLE, {y}::DOUBLE, {z}::UTINYINT)").fetchone()[0]
        
        pmtiles_x = int(x * (1 << z))
        pmtiles_y = int(y * (1 << z))
        pmtiles_id = pmtiles.tile.zxy_to_tileid(z, pmtiles_x, pmtiles_y)
        
        local_pmtiles_id = pmtiles_id - offset
        if duckdb_id != local_pmtiles_id:
            mismatches += 1
            print(f"Mismatch for x={x}, y={y}: DuckDB={duckdb_id}, PMTiles={local_pmtiles_id}, tile=({pmtiles_x}, {pmtiles_y})")
            
    print(f"Mismatches out of 1000 random points: {mismatches}")

if __name__ == '__main__':
    run_test()
