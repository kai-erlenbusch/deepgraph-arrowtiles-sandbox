import { PMTiles } from 'pmtiles';

async function run() {
    const p = new PMTiles('file://D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.pmtiles');
    const header = await p.getHeader();
    console.log("Header:", header);
    
    // Attempt to get root directory
    const dir = await p.getZxy(0, 0, 0);
    console.log("Z=0 X=0 Y=0 tile:", dir);
}

run().catch(console.error);
