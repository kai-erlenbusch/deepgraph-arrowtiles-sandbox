import collections
import time
import numpy as np

np.random.seed(42)
batch_size = 100000
max_zoom = 15
max_capacity = 1000

t_cols = [np.random.randint(0, 1000, size=batch_size, dtype=np.uint64).tolist() for _ in range(max_zoom + 1)]
x_norms = np.random.rand(batch_size).tolist()

capacities_loop = collections.defaultdict(int)
start = time.time()
out_x, out_y, out_m, out_c, out_i, out_z, out_tid = [], [], [], [], [], [], []
for i in range(batch_size):
    for z in range(max_zoom + 1):
        tid = t_cols[z][i]
        if capacities_loop[(z, tid)] < max_capacity:
            capacities_loop[(z, tid)] += 1
            out_x.append(x_norms[i])
            out_y.append(x_norms[i])
            out_m.append(x_norms[i])
            out_c.append(x_norms[i])
            out_i.append(x_norms[i])
            out_z.append(z)
            out_tid.append(tid)
            break
end = time.time()
print(f"Slow loop with appends and lists: {end-start:.3f} seconds")
