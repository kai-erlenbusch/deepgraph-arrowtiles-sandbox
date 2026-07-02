import duckdb
duckdb.execute("COPY (SELECT * FROM read_parquet('s3_cache/**/*.parquet') LIMIT 100000) TO 'test_input.parquet' (FORMAT PARQUET)")
