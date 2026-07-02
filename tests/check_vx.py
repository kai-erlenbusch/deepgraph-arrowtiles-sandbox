import pyarrow.parquet as pq
import numpy as np
import duckdb

path = 'D:/exploratory/duckdb-extension/gaia-deepscatter-study/data/gaia_sampled.parquet'
table = pq.read_table(path)
x = table.column('x_norm').to_numpy()
grid_size = 512
vx_0_py = (x * grid_size).astype(np.int64)

vx_0_duck = duckdb.execute("SELECT FLOOR(x_norm::DOUBLE * 512)::BIGINT FROM read_parquet('" + path + "')").df().iloc[:,0].to_numpy()

mismatches = np.sum(vx_0_py != vx_0_duck)
print('Mismatches:', mismatches)
if mismatches > 0:
    idx = np.where(vx_0_py != vx_0_duck)[0][0]
    print('First mismatch at idx', idx)
    print('x_norm:', x[idx])
    print('Python vx_0:', vx_0_py[idx])
    print('DuckDB vx_0:', vx_0_duck[idx])
