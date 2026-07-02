from numba import njit
import numpy as np

@njit
def fast_assignment(tids_z, unique_tids, unique_caps, max_capacity):
    accepted = np.zeros(len(tids_z), dtype=np.bool_)
    updated_caps = unique_caps.copy()
    
    for i in range(len(tids_z)):
        tid = tids_z[i]
        
        idx = np.searchsorted(unique_tids, tid)
        
        if idx < len(unique_tids) and unique_tids[idx] == tid and updated_caps[idx] < max_capacity:
            accepted[i] = True
            updated_caps[idx] += 1
            
    return accepted, updated_caps
