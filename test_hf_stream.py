from datasets import load_dataset
import duckdb

ds = load_dataset("samfatnassi/gaia-dr3", split="train", streaming=True)
res = duckdb.execute("SELECT count(*) FROM ds").fetchall()
print(res)
