Deepscatter Tiling Architecture: A Deep Dive
Ben Schmidt’s deepscatter (and its tiling engine quadfeather) handles datasets in the billions (like the 1.8B stars of the Gaia mission) by combining spatial quadtrees, progressive subsampling, and zero-copy GPU rendering.

Here is a reverse-engineered architectural breakdown of how this tiling system works.

1. The Core Tiling Philosophy: Progressive Subsampling
The biggest bottleneck in rendering billions of points is that you cannot load them all into memory, nor can you draw them all simultaneously. Traditional web maps tile images (raster) or geometries (vector tiles), but for point clouds, quadfeather uses a different approach.

When processing data, quadfeather builds a spatial Quadtree, but it does NOT push all data down to the leaf nodes. Instead, it utilizes a "reservoir" sampling approach:

Fixed Tile Sizes: Every tile at every level holds a maximum fixed number of points (typically around 65,536, though configurable).
Spilling to Children: When points are inserted into a tile (e.g., the root tile 0/0/0), the tile fills up until it hits its maximum capacity.
Any remaining points are partitioned geographically (Northwest, Northeast, Southwest, Southeast) and "spilled over" into 4 child tiles at zoom level z+1.
Why is this brilliant? Because tile 0/0/0 now contains a perfectly uniform 65k-point random sample of the entire global dataset. When a user first opens the page fully zoomed out, the browser only downloads a single small tile, but sees the shape of the entire galaxy. As the user zooms in, the bounding box intersection dictates loading children (1/x/y, 2/x/y, etc.), seamlessly layering on more detail exactly where the user is looking.

1. File Format: Apache Arrow (Feather)
Deepscatter completely abandons JSON or CSV for web transit. Instead, it compiles tiles into Apache Arrow IPC format (often saved with a .feather extension).

Arrow is a columnar memory format. When the browser downloads 3/2/5.feather:

It does not need to parse strings or objects.
The x and y columns are already tightly packed arrays of Float32.
Deepscatter’s JS engine extracts these binary arrays and passes them directly to WebGL buffers. This "zero-copy" architecture bypasses V8/Javascript's garbage collection and parsing bottlenecks entirely.
3. The tix (Tile Index) Math
In deepscatter/src/tixrixqid.ts, we see how the frontend manages this tree memory efficiently. Rather than dealing with nested JSON objects representing the tree, Deepscatter identifies tiles using a single integer called tix (Tile Index).

The conversion function is:

typescript

export function zxyToTix(z: number, x: number, y: number) {
  return (4 **z - 1) / 3 + y * 2** z + x;
}
This formula flattens a complete quadtree into a 1D array index:

Level 0 (Root): 0/0/0 -> tix: 0
Level 1: 1/0/0 to 1/1/1 -> tix: 1 through 4
Level 2: 2/0/0 to 2/3/3 -> tix: 5 through 20
This allows Deepscatter to iterate over active tiles and calculate parents/children using simple integer arithmetic, maximizing rendering loop performance.

1. The Manifest
Instead of the client guessing which tiles exist (as not all geographic quadrants contain stars), quadfeather generates a manifest.feather file.

This file is downloaded immediately on page load and contains a flattened table of all tiles, providing:

The string key (z/x/y)
Bounding box extents (extent) for frustum culling.
The number of points in the tile.
Min/Max indices.
When the camera moves, Deepscatter checks the camera's bounding box against the manifest's extents. If a tile overlaps the screen and its parent is already rendered, the tile is queued for fetching.

1. Interaction and QIDs
To handle hover events on billions of points, Deepscatter utilizes a Qid (Quadtree ID). A Qid is a Tuple: [Tix, Rix]

Tix: The integer ID of the Tile (which quadtree node).
Rix: The Row Index (the exact index of the point within that Arrow array).
When a user hovers over a star, WebGL performs a fast framebuffer read (color-picking based on internal IDs). The shader returns the Tix and Rix. Deepscatter then looks up the loaded tile via tixToTile(Tix) and grabs the metadata from the Rix-th row in O(1) time without ever doing an expensive geometric search.

Summary
The combination of spatial subsampling (giving immediate global context), Arrow IPC (for zero-parse GPU buffering), and flat integer math (for fast culling and picking) allows Deepscatter to operate at a scale that breaks traditional web-mapping tools.
