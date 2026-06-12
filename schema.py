import duckdb
con = duckdb.connect()
con.execute('INSTALL httpfs; LOAD httpfs;')
res = con.execute("DESCRIBE SELECT * FROM read_parquet('hf://datasets/samfatnassi/gaia-dr3/**/*.parquet')").fetchall()
for r in res:
    print(r[0])
