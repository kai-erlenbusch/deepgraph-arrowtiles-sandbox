import duckdb
con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
con.execute('INSTALL httpfs; LOAD httpfs;')
res = con.execute("SELECT ra, dec, x, y, z, abs_m, bp_rp FROM read_parquet('hf://datasets/samfatnassi/gaia-dr3/**/*.parquet') LIMIT 10").fetchall()
for r in res:
    print(r)
