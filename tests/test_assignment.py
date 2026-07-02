import sys
import os
import numpy as np

# Add parent directory to path so we can import assignment_utils
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from assignment_utils import fast_assignment

def test_fast_assignment_basic():
    tids_z = np.array([1, 1, 2, 2, 2, 3])
    unique_tids = np.array([1, 2, 3])
    unique_caps = np.array([0, 0, 0], dtype=np.int64)
    max_capacity = 2

    accepted, updated_caps = fast_assignment(tids_z, unique_tids, unique_caps, max_capacity)

    # For tid 1: both accepted (capacity becomes 2)
    # For tid 2: first 2 accepted, 3rd rejected (capacity becomes 2)
    # For tid 3: accepted (capacity becomes 1)
    expected_accepted = np.array([True, True, True, True, False, True])
    expected_caps = np.array([2, 2, 1], dtype=np.int64)
    
    assert np.array_equal(accepted, expected_accepted), f"Expected {expected_accepted}, got {accepted}"
    assert np.array_equal(updated_caps, expected_caps), f"Expected caps {expected_caps}, got {updated_caps}"

def test_fast_assignment_already_full():
    tids_z = np.array([1, 1, 2])
    unique_tids = np.array([1, 2])
    unique_caps = np.array([2, 1], dtype=np.int64)  # tid 1 is already full (2/2)
    max_capacity = 2

    accepted, updated_caps = fast_assignment(tids_z, unique_tids, unique_caps, max_capacity)

    expected_accepted = np.array([False, False, True])
    expected_caps = np.array([2, 2], dtype=np.int64)
    
    assert np.array_equal(accepted, expected_accepted), f"Expected {expected_accepted}, got {accepted}"
    assert np.array_equal(updated_caps, expected_caps), f"Expected caps {expected_caps}, got {updated_caps}"

if __name__ == '__main__':
    import pytest
    pytest.main([__file__])
