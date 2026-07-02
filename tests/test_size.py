import duckdb
import urllib.request
import concurrent.futures

conn = duckdb.connect()
conn.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1';")
res = conn.execute("SELECT file FROM glob('s3://stpubdata/gaia/gaia_dr3/public/hats/gaia/dataset/**/*.parquet') LIMIT 50").fetchall()
urls = [r[0].replace('s3://stpubdata/', 'https://stpubdata.s3.amazonaws.com/') for r in res]

def get_sz(u):
    try:
        return int(urllib.request.urlopen(urllib.request.Request(u, method='HEAD')).headers.get('Content-Length', 0))
    except Exception:
        return 0

with concurrent.futures.ThreadPoolExecutor(10) as ex:
    total = sum(ex.map(get_sz, urls))

print(f"Avg size: {total/(1024*1024*50):.2f} MB")
print(f"Est Total for 2017 files: {(total/50)*2017/(1024*1024*1024):.2f} GB")
