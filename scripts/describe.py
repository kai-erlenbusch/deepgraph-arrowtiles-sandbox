import duckdb
con = duckdb.connect()
print(con.execute("DESCRIBE SELECT * FROM read_parquet('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/data/steveberardi/**/*.parquet')").df())
