import duckdb
res = duckdb.execute("SELECT count(*), count(bp_rp), count(abs_m) FROM read_parquet('data/gaia-dr3/**/*.parquet')").fetchall()
print(res)
