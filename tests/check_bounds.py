import duckdb
print(duckdb.execute("SELECT MIN(x_norm), MAX(x_norm), MIN(y_norm), MAX(y_norm) FROM read_parquet('data/level_2/*.parquet')").df())
