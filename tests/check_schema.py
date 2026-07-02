import duckdb
try:
    print(duckdb.execute("DESCRIBE SELECT * FROM read_parquet('s3://stpubdata/gaia/gaia_dr3/public/hats/gaia/dataset/0/0/0.parquet')").df())
except Exception as e:
    print(e)
