# Gaia DR3 & DR4 Multidimensional Data Mapping

This document provides a comprehensive mapping of the European Space Agency's Gaia DR3 (and upcoming DR4) catalogs, datasets, and specific columns required to visualize 10 multidimensional data points of the Milky Way. It also details the estimated data volume and proposes a multi-file `.arrowtiles` schema strategy for efficient GPU rendering.

> [!NOTE]
> Gaia DR3 was released in 2022 with ~10 TB of total data. Gaia DR4 is scheduled for December 2026 and will dramatically increase the total volume to ~400–500 TB due to the inclusion of full epoch (time-series) data. However, extracting only the specific columns listed below will reduce the necessary storage for visualization to a highly manageable ~150 GB uncompressed.

---

## 1. Multidimensional Data Points Mapping

### a. Stellar Motion
*   **Catalog:** `gaiadr3.gaia_source`
*   **Columns Required:** (All 6 phase-space coordinates required for 3D trajectory projection)
    *   `ra`, `dec` (Current 2D position)
    *   `parallax` (For calculating distance and converting to 3D)
    *   `pmra`, `pmdec` (Proper motion in right ascension and declination)
    *   `radial_velocity` (For calculating line-of-sight acceleration/deceleration)
    *   `pmra_error`, `pmdec_error` (Optional: for uncertainty rendering)
*   **Reference / Source Code:** [ESA Star Trails](https://www.cosmos.esa.int/web/gaia/edr3-startrails), [agabrown/gaiaedr3-proper-motion-visualizations](https://github.com/agabrown/gaiaedr3-proper-motion-visualizations)
*   **Data Volume:** ~15 GB for 1.8 billion sources (when extracted as columnar Float32).

### b. Stellar Age
*   **Catalog:** `gaiadr3.astrophysical_parameters`
*   **Columns Required:** 
    *   `age_flame` (Age of the star from FLAME pipeline)
    *   `age_flame_lower`, `age_flame_upper` (Confidence intervals)
*   **Data Volume:** ~4 GB (Not all sources have age derived; available for several hundred million sources).

### c. Brightnesses & Interstellar Dust
*   **Catalog:** `gaiadr3.gaia_source` (for brightness) & `gaiadr3.astrophysical_parameters` (for dust)
*   **Columns Required:** 
    *   *Brightness:* `phot_g_mean_mag`, `phot_bp_mean_mag`, `phot_rp_mean_mag`
    *   *Dust:* `ebpminrp_gspphot` (Color excess / reddening)
*   **Data Volume:** ~20 GB (brightness) + ~8 GB (dust).

### d. Variable Stars
*   **Catalog:** `gaiadr3.vari_summary` (and `vari_classifier_result`)
*   **Columns Required:** 
    *   `best_class_name` (Variable classification)
    *   `best_class_score`
*   **Data Volume:** ~2 GB (Extracted from the broader ~40 GB variability dataset, covering ~10.5 million variable sources).

### e. Stellar Extinction
*   **Catalog:** `gaiadr3.astrophysical_parameters`
*   **Columns Required:** 
    *   `ag_gspphot` (Extinction in the G band)
    *   `azero_gspphot` (Monochromatic extinction)
*   **Data Volume:** ~8 GB.

### f. Interstellar Medium
*   **Catalog:** `gaiadr3.astrophysical_parameters` (Note: Higher density available in Gaia Focused Product Release / DR4)
*   **Columns Required:** 
    *   `dibew_gspspec` (Equivalent width of Diffuse Interstellar Band at 862 nm)
    *   `dib_gspspec_lambda` (Central wavelength)
*   **Data Volume:** ~2 GB (Currently ~476,000 to a few million sources, will expand in DR4).

### g. Radial Velocities
*   **Catalog:** `gaiadr3.gaia_source`
*   **Columns Required:** 
    *   `radial_velocity`
    *   `radial_velocity_error`
*   **Data Volume:** ~1 GB (~33.8 million sources with radial velocities in DR3; DR4 will significantly expand this).

### h. Chemical Map / Stellar Composition
*   **Catalog:** `gaiadr3.astrophysical_parameters`
*   **Columns Required:** 
    *   `mh_gspphot`, `mh_gspspec` (Metallicity)
    *   `alphafe_gspspec` (Alpha-element abundances)
*   **Data Volume:** ~12 GB.

### i. Three-Dimensional Stellar Motion Map
*   **Catalog:** `gaiadr3.gaia_source`
*   **Columns Required:** 
    *   `ra`, `dec` (Coordinates)
    *   `parallax` (Distance indicator)
    *   `pmra`, `pmdec` (Proper motions)
    *   `radial_velocity` (Line-of-sight velocity)
*   **Data Volume:** ~35 GB (This combines spatial and motion columns for full 6D phase space).

### j. Sky in Colour
*   **Catalog:** `gaiadr3.gaia_source`
*   **Columns Required:** 
    *   `bp_rp` (BP - RP color index)
    *   `phot_bp_mean_mag`, `phot_rp_mean_mag`
*   **Data Volume:** ~15 GB.

---

## 2. Multi-File `.arrowtiles` Schema Strategy

To efficiently visualize this data utilizing GPU compute, the data must be sharded into spatial tiles and stored columnarly. By strictly enforcing that the records in every auxiliary tile match the exact order of the core tile, we eliminate the need for costly database `JOIN` operations on the GPU.

> [!TIP]
> Use Morton Coding (Z-order curve) or HEALPix spatial indexing to partition the stars into chunks (e.g., 2–5 million stars per tile). Ensure that within each tile, rows are sorted strictly by `source_id`.

### The Core Tile (Spatial Index)
**`gaia_core.arrowtiles`**
Acts as the backbone. It is always loaded to place stars in 3D space.
*   `source_id` (Int64)
*   `ra` (Float64)
*   `dec` (Float64)
*   `parallax` (Float32) - *Required for Z-depth.*
*   `healpix_id` / `morton_code` (Int32)

### Auxiliary Tiles (Supplemental Data)
These tiles are loaded dynamically on demand depending on what the user wants to visualize. They contain identical row counts and row ordering as `gaia_core.arrowtiles`.

**`gaia_motion.arrowtiles`**
*   `pmra` (Float32)
*   `pmdec` (Float32)
*   `radial_velocity` (Float32)

**`gaia_photometry.arrowtiles`**
*   `phot_g_mean_mag` (Float32)
*   `phot_bp_mean_mag` (Float32)
*   `phot_rp_mean_mag` (Float32)
*   `bp_rp` (Float32)

**`gaia_astrophysics.arrowtiles`**
*   `age_flame` (Float32)
*   `mh_gspphot` (Float32)
*   `ag_gspphot` (Float32)
*   `dibew_gspspec` (Float32)

**`gaia_variability.arrowtiles`**
*   `best_class_name` (Dictionary/Categorical Int8)
*   `best_class_score` (Float32)

---

## 3. Current Data Acquisition (Ben Schmidt Benchmark)

Based on a review of `download_s3.py`, the ongoing S3 batch download query fetches:
`ra`, `dec`, `parallax`, `phot_g_mean_mag AS magnitude`, `bp_rp AS bv`, `pmra`, `pmdec`, `radial_velocity`, `teff_gspphot`

Of the 10 dimensions listed above, we are **currently acquiring**:
*   ✅ **a. Stellar Motion:** We have `pmra` and `pmdec`.
*   ✅ **c. Brightnesses:** We have `phot_g_mean_mag` (but NOT dust).
*   ✅ **g. Radial Velocities:** We have `radial_velocity`.
*   ✅ **i. Three-Dimensional Stellar Motion Map:** We have `ra`, `dec`, `parallax`, `pmra`, `pmdec`, and `radial_velocity`.
*   ✅ **j. Sky in Colour:** We have `bp_rp` (color index).

We are **NOT currently acquiring**:
*   ❌ **b. Stellar Age:** Requires `age_flame` from `astrophysical_parameters` catalog.
*   ❌ **c. Interstellar Dust:** Requires `ebpminrp_gspphot` from `astrophysical_parameters` catalog.
*   ❌ **d. Variable Stars:** Requires `best_class_name` from `vari_summary` catalog.
*   ❌ **e. Stellar Extinction:** Requires `ag_gspphot` from `astrophysical_parameters` catalog.
*   ❌ **f. Interstellar Medium:** Requires `dibew_gspspec` from `astrophysical_parameters` catalog.
*   ❌ **h. Chemical Map:** Requires `mh_gspphot` / `alphafe_gspspec` from `astrophysical_parameters` catalog.

Because the current download is isolated strictly to the core `gaiadr3.gaia_source` catalog files hosted on S3 (via Ben Schmidt's pipeline), any data relying on the `astrophysical_parameters` or `variability` catalogs is completely missing from this download!

---

## 4. Deep Dives

### i. Stellar Motion (Proper Motion Visualizations)

Based on a review of the [ESA Star Trails Press Release](https://www.cosmos.esa.int/web/gaia/edr3-startrails) and Anthony Brown's [GitHub Repository](https://github.com/agabrown/gaiaedr3-proper-motion-visualizations/), animating proper motion into the future requires accurate astrometric modeling.

### Mathematical Requirements for Star Trails
A naive visualization might simply move stars in a 2D line using `pmra` and `pmdec`. However, to achieve realistic trails out to 400,000+ years, one must account for the fact that stars move in 3D space. 

As a star moves radially toward the solar system, its apparent velocity across the sky accelerates; as it moves away, it decelerates. Furthermore, spherical projection effects alter the path over long time horizons.

By reviewing the core animation script [`star-trails-animation.py`](https://github.com/agabrown/gaiaedr3-proper-motion-visualizations/blob/main/star-trail-animation/star-trails-animation.py) from the repository, we confirmed that all **6 phase-space coordinates** are required to use the `pygaia.astrometry.coordinates.EpochPropagation` module, which mathematically projects the curved orbits:
1. `ra`, `dec` (Current 2D position)
2. `parallax` (Used to calculate distance `d = 1/parallax`, converting 2D to 3D)
3. `pmra`, `pmdec` (Transverse velocity across the sky)
4. `radial_velocity` (Velocity along the line of sight toward or away from Earth)

### Implementation in Arrowtiles (WebGPU)
Because our ongoing S3 batch download *already* fetches `ra`, `dec`, `parallax`, `pmra`, `pmdec`, and `radial_velocity`, we have the **complete set of variables** necessary to reproduce the official ESA Star Trails animation dynamically in a WebGPU vertex shader. The vertex shader can be fed a uniform `time_delta_years` (e.g., +400,000) and it will push every star along its true 3D vector at 60 frames per second.

### All-Sky Average Proper Motion Maps
The repository also contains Python scripts ([`proper-motion-map.py`](https://github.com/agabrown/gaiaedr3-proper-motion-visualizations/blob/main/all-sky-average-proper-motions/proper-motion-map.py)) and Jupyter notebooks (`AllSkyProperMotionMap.ipynb`, `ExpectedKinematicSkyMaps.ipynb`) that generate static visual maps of the Milky Way's kinematics. These work by dividing the sky into HEALPix bins and calculating `avg(pmra)` and `avg(pmdec)` using a simple `GROUP BY` SQL query (or PySpark/Pandas equivalents) from the Gaia archive. This is another visualization we can easily achieve natively with Arrowtiles by aggregating our columns over the HEALPix bins we already generate in DuckDB.