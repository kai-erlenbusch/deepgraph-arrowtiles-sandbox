import fs from 'fs';
import { ZstdDec } from './node_modules/zstddec/dist/zstddec.esm.js';

async function run() {
    const fd = fs.openSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles', 'r');
    const tileData = new Uint8Array(1024 * 1024); // read 1MB roughly
    const bytesRead = fs.readSync(fd, tileData, 0, 1024*1024, 0);
    // Actually we need the REAL tile. Let me just read it using PMTiles.
}
