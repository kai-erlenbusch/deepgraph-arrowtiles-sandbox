import os
from huggingface_hub import snapshot_download

def download_dataset():
    # Target directory on your D: drive
    download_dir = os.path.join(os.path.dirname(__file__), "data", "gaia-dr3")
    
    print(f"Starting download to: {download_dir}")
    print("This will download approximately 15.7 GB of Parquet files.")
    print("Do not interrupt this process. Hugging Face caching will resume if stopped.")
    
    # Download the parquet files
    # We ignore the .git folder and other non-data files if any
    snapshot_download(
        repo_id="samfatnassi/gaia-dr3",
        repo_type="dataset",
        local_dir=download_dir,
        allow_patterns="*.parquet",
        max_workers=8 # Parallel downloads for speed
    )
    
    print("Download complete!")

if __name__ == "__main__":
    download_dataset()
