import duckdb
import time
import os
from tqdm import tqdm

def main():
    print("Fetching list of 2017 files from S3...")
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1';")
    res = conn.execute("SELECT file FROM glob('s3://stpubdata/gaia/gaia_dr3/public/hats/gaia/dataset/**/*.parquet')").fetchall()
    urls = [r[0] for r in res]
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cache_dir = os.path.join(base_dir, "..", "s3_cache")
    os.makedirs(cache_dir, exist_ok=True)
    
    batch_size = 50
    total_batches = (len(urls) + batch_size - 1) // batch_size
    
    print(f"Found {len(urls)} files. Processing in {total_batches} batches...")
    
    for i in tqdm(range(total_batches), desc="Downloading Batches", unit="batch"):
        batch_urls = urls[i * batch_size : (i + 1) * batch_size]
        output_file = os.path.join(cache_dir, f"batch_{i:03d}.parquet")
        
        if os.path.exists(output_file):
            tqdm.write(f"Skipping batch {i} (already exists)")
            continue
            
        tqdm.write(f"[{time.strftime('%H:%M:%S')}] Processing batch {i}/{total_batches} ({len(batch_urls)} files)...")
        
        urls_str = ",\n".join(f"'{u}'" for u in batch_urls)
        
        # We explicitly CAST to FLOAT to save space, since precision beyond float32 isn't strictly needed for PMTiles
        # But wait, original script uses RADIANS() on double, so let's keep them as native to not lose precision before Phase 2.
        query = f"""
            COPY (
                SELECT 
                    ra, dec, parallax, phot_g_mean_mag AS magnitude, bp_rp AS bv,
                    pmra, pmdec, radial_velocity, teff_gspphot
                FROM read_parquet([
                    {urls_str}
                ])
                WHERE ra IS NOT NULL AND dec IS NOT NULL AND phot_g_mean_mag IS NOT NULL AND bp_rp IS NOT NULL AND parallax IS NOT NULL
            ) TO '{output_file}' (FORMAT PARQUET)
        """
        
        temp_conn = duckdb.connect()
        temp_conn.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-east-1'; SET threads=16;")
        
        start_time = time.time()
        try:
            temp_conn.execute(query)
            elapsed = time.time() - start_time
            size_mb = os.path.getsize(output_file) / (1024 * 1024)
            tqdm.write(f"  -> Batch {i} completed in {elapsed:.1f}s. File size: {size_mb:.1f} MB")
        except (duckdb.Error, OSError) as e:
            tqdm.write(f"  -> Error in batch {i}: {e}")
            if os.path.exists(output_file):
                os.remove(output_file)
            tqdm.write("  -> Retrying in 5 seconds...")
            time.sleep(5)
            try:
                temp_conn.execute(query)
                elapsed = time.time() - start_time
                size_mb = os.path.getsize(output_file) / (1024 * 1024)
                tqdm.write(f"  -> Batch {i} completed on retry in {elapsed:.1f}s. File size: {size_mb:.1f} MB")
            except (duckdb.Error, OSError) as e2:
                tqdm.write(f"  -> Retry failed: {e2}")

if __name__ == '__main__':
    main()
