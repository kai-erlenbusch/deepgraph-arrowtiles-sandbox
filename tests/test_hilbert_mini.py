import duckdb
con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
con.execute("LOAD 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")
print("Z=1 (0.25, 0.25) ->", con.execute("SELECT hilbert_normalized(0.25::DOUBLE, 0.25::DOUBLE, 1::UTINYINT)").fetchone()[0])
print("Z=1 (0.75, 0.25) ->", con.execute("SELECT hilbert_normalized(0.75::DOUBLE, 0.25::DOUBLE, 1::UTINYINT)").fetchone()[0])
print("Z=1 (0.25, 0.75) ->", con.execute("SELECT hilbert_normalized(0.25::DOUBLE, 0.75::DOUBLE, 1::UTINYINT)").fetchone()[0])
print("Z=1 (0.75, 0.75) ->", con.execute("SELECT hilbert_normalized(0.75::DOUBLE, 0.75::DOUBLE, 1::UTINYINT)").fetchone()[0])
