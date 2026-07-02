import duckdb
con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
con.execute("LOAD 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")
print("Z=0 ->", con.execute("SELECT hilbert_normalized(0.5::DOUBLE, 0.5::DOUBLE, 0::UTINYINT)").fetchone()[0])
