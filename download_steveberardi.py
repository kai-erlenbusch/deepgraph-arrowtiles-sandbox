import urllib.request
import json
import os
import tarfile
import time

API_URL = "https://api.github.com/repos/steveberardi/starplot-gaia-dr3/releases/latest"
DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "steveberardi")

os.makedirs(DATA_DIR, exist_ok=True)

def download_file(url, filepath):
    print(f"Downloading {url} to {filepath}...")
    start_time = time.time()
    
    # We use urllib to stream download
    with urllib.request.urlopen(url) as response, open(filepath, 'wb') as out_file:
        chunk_size = 1024 * 1024 # 1MB
        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0
        last_print = 0
        
        while True:
            chunk = response.read(chunk_size)
            if not chunk:
                break
            out_file.write(chunk)
            downloaded += len(chunk)
            
            # Print progress every 5%
            if total_size > 0:
                progress = downloaded / total_size
                if progress - last_print > 0.05:
                    print(f"  Progress: {progress*100:.1f}% ({downloaded / 1024 / 1024:.1f} MB / {total_size / 1024 / 1024:.1f} MB)")
                    last_print = progress
                    
    print(f"Finished downloading {filepath} in {time.time() - start_time:.1f} seconds.")

def extract_tarball(filepath, dest_dir):
    print(f"Extracting {filepath}...")
    start_time = time.time()
    with tarfile.open(filepath, "r:gz") as tar:
        tar.extractall(path=dest_dir)
    print(f"Finished extracting {filepath} in {time.time() - start_time:.1f} seconds.")
    
def main():
    print(f"Fetching release info from {API_URL}...")
    req = urllib.request.Request(API_URL)
    with urllib.request.urlopen(req) as response:
        release_data = json.loads(response.read().decode())
        
    assets = release_data.get('assets', [])
    tar_assets = [a for a in assets if a['name'].endswith('.tar.gz')]
    
    print(f"Found {len(tar_assets)} tar.gz assets.")
    
    for asset in tar_assets:
        url = asset['browser_download_url']
        filename = asset['name']
        filepath = os.path.join(DATA_DIR, filename)
        
        # Check if already downloaded/extracted
        # the tarballs contain partition directories like `partition=0/part-0.parquet`
        # We can't easily check for exact extracted files, but we can check if tar exists
        if not os.path.exists(filepath):
            download_file(url, filepath)
            extract_tarball(filepath, DATA_DIR)
            print(f"Deleting {filepath} to save space...")
            os.remove(filepath)
        else:
            print(f"Skipping {filename}, tarball already exists.")
            # Even if tar exists, maybe not extracted, so let's extract
            extract_tarball(filepath, DATA_DIR)
            
    print("All assets downloaded and extracted successfully!")

if __name__ == "__main__":
    main()
