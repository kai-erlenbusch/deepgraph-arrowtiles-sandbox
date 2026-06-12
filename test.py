import duckdb
res = duckdb.execute("SELECT COUNT(*) FROM read_parquet('data/gaia-dr3/**/*.parquet')").fetchall()
print(res)
