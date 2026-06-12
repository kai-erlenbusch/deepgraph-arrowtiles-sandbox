import duckdb
import time

def generate_pmtiles(input_parquet: str, output_pmtiles: str):
    print(f"Starting pipeline. Input: {input_parquet}")
    con = duckdb.connect(config={'allow_unsigned_extensions': 'true'})
    
    # Load our custom ArrowTiles extension
    print("Loading arrowtiles extension...")
    con.execute("LOAD 'D:/exploratory/duckdb-extension/duckdb-arrowtiles/target/release/arrowtiles.duckdb_extension'")
    
    print("Installing and Loading httpfs extension...")
    con.execute("INSTALL httpfs; LOAD httpfs;")

    start_time = time.time()
    
    query = f"""
    CREATE TABLE tiles AS
    SELECT * FROM arrowtiles_export(
        '
        WITH dataset_stats AS (
            SELECT count(*) as total_rows FROM read_parquet(''{input_parquet}'')
        ),
        raw_data AS (
            SELECT 
                ra, dec, magnitude, bv,
                RADIANS(ra) AS ra_rad,
                RADIANS(dec) AS dec_rad,
                RADIANS(192.85948) AS a_g,
                RADIANS(27.12825) AS d_g,
                RADIANS(32.93192) AS l_n
            FROM read_parquet(''{input_parquet}'')
            WHERE ra IS NOT NULL AND dec IS NOT NULL AND magnitude IS NOT NULL AND bv IS NOT NULL
        ),
        sorted_data AS (
            SELECT *,
                   row_number() OVER (ORDER BY magnitude ASC) AS ix
            FROM raw_data
        ),
        galactic AS (
            SELECT
                magnitude, bv, ix,
                ASIN(
                    SIN(d_g)*SIN(dec_rad) + 
                    COS(d_g)*COS(dec_rad)*COS(ra_rad - a_g)
                ) AS b_rad,
                l_n + ATAN2(
                    COS(dec_rad)*SIN(ra_rad - a_g), 
                    COS(d_g)*SIN(dec_rad) - SIN(d_g)*COS(dec_rad)*COS(ra_rad - a_g)
                ) AS l_rad_raw
            FROM sorted_data
        ),
        normalized AS (
            SELECT
                magnitude, bv, ix, b_rad,
                CASE 
                    WHEN l_rad_raw > PI() THEN l_rad_raw - 2*PI() 
                    WHEN l_rad_raw < -PI() THEN l_rad_raw + 2*PI() 
                    ELSE l_rad_raw 
                END AS l_rad
            FROM galactic
        ),
        gaia_sampled AS (
            SELECT 
                -- Negate the X term so that positive Longitude (left of center) goes negative X (which maps to -1 to 0 in WebGPU, i.e. Left side)
                ( ( -2 * sqrt(2) * cos(b_rad) * sin(l_rad / 2) ) / sqrt(1 + cos(b_rad) * cos(l_rad / 2)) + 2.8284271247461903 ) / 5.6568542494923806 AS x_norm,
                -- Do not subtract from 1.0 so positive latitude (North) increases y_norm (mapping to top of screen)
                ( ((sqrt(2) * sin(b_rad)) / sqrt(1 + cos(b_rad) * cos(l_rad / 2))) + 1.4142135623730951 ) / 2.8284271247461903 AS y_norm,
                CAST(magnitude AS FLOAT) AS abs_m,
                CAST(bv AS FLOAT) AS bp_rp,
                CAST(ix AS FLOAT) AS ix
            FROM normalized
        )
        SELECT 
            x_norm,
            y_norm,
            abs_m,
            bp_rp,
            ix,
            zoom::UTINYINT as z,
            hilbert_normalized(x_norm, y_norm, zoom::UTINYINT) AS tile_id
        FROM gaia_sampled
        CROSS JOIN UNNEST(generate_series(0, 14)) AS t(zoom)
        WHERE 
            ix <= power(4.0, zoom) * 50000.0
            AND (
                zoom = 0 OR 
                ix > power(4.0, zoom - 1) * 50000.0
            )
        ORDER BY tile_id
        ',
        '{output_pmtiles}'
    );
    """
    
    print("Executing query (this will take a while)...")
    try:
        con.execute(query)
        print(f"Success! Finished in {time.time() - start_time:.2f} seconds.")
    except Exception as e:
        print(f"Pipeline failed: {e}")

if __name__ == "__main__":
    INPUT_DATA = "D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/data/steveberardi/**/*.parquet" 
    OUTPUT_FILE = "D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.pmtiles"
    
    generate_pmtiles(INPUT_DATA, OUTPUT_FILE)
