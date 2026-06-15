import duckdb
import traceback
import sys

print("Starting DuckDB sorting phase...")
try:
    con = duckdb.connect(config={'allow_unsigned_extensions': 'true', 'temp_directory': 'duckdb_temp', 'max_memory': '35GB'})
    print("Executing COPY...")
    con.execute("COPY (SELECT * FROM read_parquet('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/assigned_points_vec.parquet') ORDER BY final_tile_id) TO 'D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/duckdb_temp/final_ordered_new.parquet' (FORMAT PARQUET)")
    print("COPY finished successfully!")
except Exception as e:
    print(f"Exception caught: {e}")
    traceback.print_exc()
    sys.exit(1)
