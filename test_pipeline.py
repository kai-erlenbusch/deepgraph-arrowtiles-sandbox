import duckdb
import time

def run():
    print("Generating 1M row test parquet...")
    con = duckdb.connect()
    # test dataset uses ra=0-360 and dec=-90 to 90 to simulate gaia scale before normalization
    con.execute("COPY (SELECT random()*360 as ra, (random()*180)-90 as dec, random()*20 as phot_g_mean_mag, (random()-0.5)*10 as bp_rp FROM generate_series(1, 1000000)) TO 'test_data.parquet'")
    print("Test parquet generated.")

if __name__ == '__main__':
    run()
