import duckdb
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1';")
try:
    res = con.execute("DESCRIBE SELECT * FROM read_parquet('s3://stpubdata/gaia/gaia_dr3/public/hats/gaia/dataset/Norder=2/Dir=0/Npix=0.parquet')").fetchall()
    for r in res:
        print(f"{r[0]}: {r[1]}")
except Exception as e:
    print(e)
