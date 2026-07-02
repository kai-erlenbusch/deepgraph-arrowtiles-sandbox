import duckdb
res = duckdb.execute("SELECT MIN(abs_m), MAX(abs_m), COUNT(*) FROM read_parquet('D:/exploratory/duckdb-extension/gaia-deepscatter-study/data/gaia_sampled.parquet') WHERE abs_m <= 0.0").fetchall()
print(res)
