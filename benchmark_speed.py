import duckdb
import time

con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
con.execute("LOAD 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")
udf_calls = ',\n'.join([f"hilbert_normalized(x_norm, y_norm, {z}::UTINYINT) AS t{z}" for z in range(15)])

query = f"""
    WITH raw_data AS (
        SELECT ra, dec, magnitude, bv, RADIANS(ra) AS ra_rad, RADIANS(dec) AS dec_rad, RADIANS(192.85948) AS a_g, RADIANS(27.12825) AS d_g, RADIANS(32.93192) AS l_n
        FROM read_parquet('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/s3_cache/batch_000.parquet')
        LIMIT 1000000
    ),
    galactic AS (
        SELECT magnitude, bv, ASIN(SIN(d_g)*SIN(dec_rad) + COS(d_g)*COS(dec_rad)*COS(ra_rad - a_g)) AS b_rad, l_n + ATAN2(COS(dec_rad)*SIN(ra_rad - a_g), COS(d_g)*SIN(dec_rad) - SIN(d_g)*COS(dec_rad)*COS(ra_rad - a_g)) AS l_rad_raw
        FROM raw_data
    ),
    normalized AS (
        SELECT magnitude, bv, b_rad, CASE WHEN l_rad_raw > PI() THEN l_rad_raw - 2*PI() WHEN l_rad_raw < -PI() THEN l_rad_raw + 2*PI() ELSE l_rad_raw END AS l_rad
        FROM galactic
    ),
    gaia_sampled AS (
        SELECT ( ( -2 * sqrt(2) * cos(b_rad) * sin(l_rad / 2) ) / sqrt(1 + cos(b_rad) * cos(l_rad / 2)) + 2.8284271247461903 ) / 5.6568542494923806 AS x_norm, ( ((sqrt(2) * sin(b_rad)) / sqrt(1 + cos(b_rad) * cos(l_rad / 2))) + 1.4142135623730951 ) / 2.8284271247461903 AS y_norm, magnitude, bv
        FROM normalized
    )
    SELECT x_norm, y_norm, CAST(magnitude AS FLOAT) AS abs_m, CAST(bv AS FLOAT) AS bp_rp, {udf_calls}
    FROM gaia_sampled
"""

start = time.time()
con.execute(query).fetchall()
end = time.time()
print(f"Processed 1M rows in {end-start:.2f} seconds")
