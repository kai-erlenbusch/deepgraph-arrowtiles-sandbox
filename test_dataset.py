import duckdb
con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
con.execute('INSTALL httpfs; LOAD httpfs;')
res = con.execute("SELECT COUNT(*), MIN(ra), MAX(ra), MIN(dec), MAX(dec) FROM read_parquet('hf://datasets/samfatnassi/gaia-dr3/**/*.parquet')").fetchall()
print(res)
