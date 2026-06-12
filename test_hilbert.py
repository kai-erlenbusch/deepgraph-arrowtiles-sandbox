import duckdb
con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
con.execute("LOAD '../duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")
res = con.execute("""
    SELECT 
        x, y, 
        hilbert_normalized(x::DOUBLE, y::DOUBLE, 1::UTINYINT) as h 
    FROM (
        VALUES 
        (0.25, 0.25), (0.75, 0.25), 
        (0.25, 0.75), (0.75, 0.75)
    ) t(x, y)
    ORDER BY h
""").fetchall()
for r in res:
    print(r)
