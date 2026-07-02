import duckdb
import time
import os
import psutil

def get_memory_usage():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / (1024 * 1024)

def run_diagnostic():
    print(f"[{time.strftime('%H:%M:%S')}] Connecting to DuckDB to get 5 URLs...")
    conn = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
    conn.execute("INSTALL httpfs;")
    conn.execute("LOAD httpfs;")
    conn.execute("SET s3_region='us-east-1';")
    
    # Get 5 URLs
    res = conn.execute("SELECT file FROM glob('s3://stpubdata/gaia/gaia_dr3/public/hats/gaia/dataset/**/*.parquet') LIMIT 5").fetchall()
    test_urls = [r[0] for r in res]
    
    print(f"Testing with URLs: {test_urls}")
    
    urls_str = ",\n        ".join(f"'{url}'" for url in test_urls)
    
    print(f"[{time.strftime('%H:%M:%S')}] Connecting to DuckDB for tests...")
    conn = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
    conn.execute("INSTALL httpfs;")
    conn.execute("LOAD httpfs;")
    conn.execute("SET s3_region='us-east-1';")
    conn.execute("SET threads=10")
    conn.execute("PRAGMA memory_limit='40GB'")
    # We will load the arrowtiles extension because we use hilbert_normalized in the real pipeline
    conn.execute("LOAD 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")

    query_count = f"""
    SELECT COUNT(*) 
    FROM read_parquet([
        {urls_str}
    ])
    """
    
    print(f"[{time.strftime('%H:%M:%S')}] Test 1: Simple COUNT(*) on 5 files")
    start = time.time()
    res = conn.execute(query_count).fetchall()
    duration_count = time.time() - start
    print(f"Result: {res[0][0]} rows. Time: {duration_count:.2f}s. RAM: {get_memory_usage():.1f} MB")

    query_sort = f"""
    SELECT 
        CAST(source_id AS BIGINT) as source_id,
        ra, dec, phot_g_mean_mag, l, b,
        hilbert_normalized((ra/360.0), ((dec+90.0)/180.0), 14::UTINYINT) AS t14
    FROM read_parquet([
        {urls_str}
    ])
    ORDER BY t14
    """
    
    print(f"[{time.strftime('%H:%M:%S')}] Test 2: ORDER BY query and stream to python on 5 files")
    start = time.time()
    batch_reader = conn.execute(query_sort).fetch_record_batch()
    
    row_count = 0
    batch_count = 0
    fetch_start = time.time()
    for batch in batch_reader:
        if batch_count == 0:
            time_to_first_batch = time.time() - fetch_start
            print(f"Time to first batch: {time_to_first_batch:.2f}s. RAM: {get_memory_usage():.1f} MB")
        row_count += batch.num_rows
        batch_count += 1
        
    duration_sort = time.time() - start
    print(f"Total sorted rows: {row_count} in {batch_count} batches.")
    print(f"Total time for sort and stream: {duration_sort:.2f}s. RAM: {get_memory_usage():.1f} MB")
    
    multiplier = 679 / 5
    print("\n--- Projections for full 679 files ---")
    print(f"Estimated COUNT(*) time: {(duration_count * multiplier) / 60:.2f} minutes")
    print(f"Estimated SORT time: {(duration_sort * multiplier) / 3600:.2f} hours")

if __name__ == "__main__":
    run_diagnostic()
