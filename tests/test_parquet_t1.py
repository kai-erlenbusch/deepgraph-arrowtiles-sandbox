import duckdb

con = duckdb.connect()
res = con.execute("SELECT MIN(t1), MAX(t1) FROM 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/sorted_base.parquet'").fetchall()
print("Min/Max t1:", res)
res2 = con.execute("SELECT MIN(t2), MAX(t2) FROM 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/sorted_base.parquet'").fetchall()
print("Min/Max t2:", res2)
