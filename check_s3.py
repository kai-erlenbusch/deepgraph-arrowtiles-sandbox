import duckdb

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1';")
con.execute("CREATE SECRET s3 (TYPE S3, PROVIDER CREDENTIAL_CHAIN, ANON true);")

try:
    files = con.execute("SELECT * FROM glob('s3://stpubdata/gaia/*')").fetchall()
    print("Files found in s3://stpubdata/gaia/:")
    for f in files:
        print(f[0])
except Exception as e:
    print(f"Error checking S3: {e}")
