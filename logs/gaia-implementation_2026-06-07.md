implementation plan 2026-06-07

GAIA Dataset Integration for Sandbox Stress Testing
This plan outlines the migration from our randomly generated mock datasets to the official deepscatter GAIA dataset from the European Space Agency for our local sandbox stress testing.

Background
Currently, we are using Python scripts to generate random mock datasets (build_quadtree_stress.py, generate_stress_dataset.py, mock_stress.parquet). While useful for initial sanity checks, these randomly distributed datasets do not adequately stress-test the quadtree logic, rendering performance, and density management of a real-world, highly-clustered dataset.

The /browser subagent has successfully traced the network activity of benschmidt.org and identified the production endpoint for the GAIA dataset.

Proposed Changes
We will transition the sandbox to stream directly from the GAIA production tiles.

1. Update Sandbox Initialization
Update the source_url parameter in our deepgraph-webgpu sandbox instantiation to point to the GAIA dataset.

[MODIFY] [Sandbox Main Application File]
Change the source_url from the local mock_stress endpoint to <https://files.benschmidt.org/tiles/gaia/>
Ensure our parser can read the schema format of 0/0/0.feather natively without requiring external tiles.json metadata.
2. Deprecate Mock Generators
We will mark the old random generators as deprecated (or delete them if preferred) to reduce repository clutter.

[DELETE]
build_quadtree_stress.py
[DELETE]
generate_stress_dataset.py
[DELETE]
mock_stress.parquet
User Review Required
IMPORTANT

The GAIA dataset is hosted remotely. If you are developing locally without an internet connection, or if you are concerned about bandwidth usage or CORS issues when requesting benschmidt.org from localhost, we may need to write a script to scrape and mirror the first few zoom levels locally. Do you want to stream directly from the remote URL, or would you prefer a local mirror of the top quadtree levels?

Open Questions
Schema Mismatch: The GAIA dataset contains galactic coordinates and specific column names. Will our current renderer gracefully handle these column names, or do we need to implement a column-mapping feature in the Sandbox?
Deletion: Should we fully delete the mock scripts as proposed, or keep them around for offline CI/CD testing?
Verification Plan
Launch the local sandbox.
Verify network requests are successfully fetching <https://files.benschmidt.org/tiles/gaia/0/0/0.feather>.
Visually confirm the Milky Way rendering and Additive LOD behavior when zooming.
