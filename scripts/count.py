import duckdb
con = duckdb.connect()
res = con.execute("SELECT count(*) FROM read_parquet('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/data/gaia-dr3/data/*.parquet')").fetchone()
print(f"TOTAL ROWS: {res[0]}")
