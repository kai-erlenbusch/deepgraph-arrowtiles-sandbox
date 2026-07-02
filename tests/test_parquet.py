import duckdb

con = duckdb.connect()
res = con.execute("SELECT z, count(*) FROM 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered_new.parquet' WHERE final_tile_id = 0 GROUP BY z").fetchall()
print("Z counts for final_tile_id=0:", res)

res2 = con.execute("SELECT MIN(final_tile_id), MAX(final_tile_id) FROM 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered_new.parquet' WHERE z = 1").fetchall()
print("Min/Max final_tile_id for Z=1:", res2)
