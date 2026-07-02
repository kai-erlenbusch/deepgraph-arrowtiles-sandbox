import duckdb
import time
import os

def main():
    print("Fetching list of 2017 files from S3...")
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1';")
    res = conn.execute("SELECT file FROM glob('s3://stpubdata/gaia/gaia_dr3/public/hats/gaia/dataset/**/*.parquet')").fetchall()
    urls = [r[0] for r in res]
    
    os.makedirs("s3_cache", exist_ok=True)
    
    batch_size = 50
    total_batches = (len(urls) + batch_size - 1) // batch_size
    
    print(f"Found {len(urls)} files. Processing in {total_batches} batches...")
    
    for i in range(total_batches):
        batch_urls = urls[i * batch_size : (i + 1) * batch_size]
        output_file = f"s3_cache/batch_{i:03d}.parquet"
        
        if os.path.exists(output_file):
            print(f"Skipping batch {i} (already exists)")
            continue
            
        print(f"[{time.strftime('%H:%M:%S')}] Processing batch {i}/{total_batches} ({len(batch_urls)} files)...")
        
        urls_str = ",\n".join(f"'{u}'" for u in batch_urls)
        
        # We explicitly CAST to FLOAT to save space, since precision beyond float32 isn't strictly needed for PMTiles
        # But wait, original script uses RADIANS() on double, so let's keep them as native to not lose precision before Phase 2.
        query = f"""
            COPY (
                SELECT 
                    ra, dec, phot_g_mean_mag AS magnitude, bp_rp AS bv
                FROM read_parquet([
                    {urls_str}
                ])
                WHERE ra IS NOT NULL AND dec IS NOT NULL AND phot_g_mean_mag IS NOT NULL AND bp_rp IS NOT NULL
            ) TO '{output_file}' (FORMAT PARQUET)
        """
        
        temp_conn = duckdb.connect()
        temp_conn.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1'; SET threads=16;")
        
        start_time = time.time()
        try:
            temp_conn.execute(query)
            elapsed = time.time() - start_time
            size_mb = os.path.getsize(output_file) / (1024 * 1024)
            print(f"  -> Batch {i} completed in {elapsed:.1f}s. File size: {size_mb:.1f} MB")
        except (duckdb.Error, OSError) as e:
            print(f"  -> Error in batch {i}: {e}")
            if os.path.exists(output_file):
                os.remove(output_file)
            print("  -> Retrying in 5 seconds...")
            time.sleep(5)
            try:
                temp_conn.execute(query)
                elapsed = time.time() - start_time
                size_mb = os.path.getsize(output_file) / (1024 * 1024)
                print(f"  -> Batch {i} completed on retry in {elapsed:.1f}s. File size: {size_mb:.1f} MB")
            except (duckdb.Error, OSError) as e2:
                print(f"  -> Retry failed: {e2}")

if __name__ == '__main__':
    main()
