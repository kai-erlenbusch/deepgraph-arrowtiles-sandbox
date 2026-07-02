import duckdb

query = """
SELECT 
    l, b,
    RADIANS(CASE WHEN l > 180 THEN l - 360 ELSE l END) AS lambda,
    RADIANS(b) AS phi,
    sqrt(1 + cos(RADIANS(b)) * cos(RADIANS(CASE WHEN l > 180 THEN l - 360 ELSE l END) / 2)) AS z,
    (2 * sqrt(2) * cos(RADIANS(b)) * sin(RADIANS(CASE WHEN l > 180 THEN l - 360 ELSE l END) / 2)) / sqrt(1 + cos(RADIANS(b)) * cos(RADIANS(CASE WHEN l > 180 THEN l - 360 ELSE l END) / 2)) AS h_x,
    (sqrt(2) * sin(RADIANS(b))) / sqrt(1 + cos(RADIANS(b)) * cos(RADIANS(CASE WHEN l > 180 THEN l - 360 ELSE l END) / 2)) AS h_y
FROM (
    SELECT 0 AS l, 0 AS b
    UNION ALL SELECT 180, 0
    UNION ALL SELECT 359.99, 0
    UNION ALL SELECT 0, 90
    UNION ALL SELECT 0, -90
) t
"""
res = duckdb.execute(query).fetchall()
for r in res:
    print(r)
