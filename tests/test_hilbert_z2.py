import duckdb

con = duckdb.connect()
con.execute("LOAD '../duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")

print("DuckDB Z=2 Hilbert IDs:")
for x in range(4):
    for y in range(4):
        # We pass normalized coordinates corresponding to the center of each tile
        x_norm = (x + 0.5) / 4.0
        y_norm = (y + 0.5) / 4.0
        tid = con.execute(f"SELECT hilbert_normalized({x_norm}, {y_norm}, 2)").fetchone()[0]
        print(f"X={x}, Y={y} : {tid}")
