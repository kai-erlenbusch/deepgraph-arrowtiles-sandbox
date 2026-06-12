import { PMTiles } from 'pmtiles';

async function run() {
    const p = new PMTiles('http://localhost:5173/gaia.pmtiles');
    const header = await p.getHeader();
    console.log("Root offset:", header.rootDirOffset, "Root length:", header.rootDirLength);
    
    // PMTiles exports a function to parse directories if you bypass the class,
    // but a hacky way is to just use getZxy(0,0,0) and observe the network.
    // Instead, let's just loop over all tiles at Z=10 to find ONE that exists!
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            const t = await p.getZxy(4, x, y);
            if (t) {
                console.log("FOUND TILE at Z=4:", x, y, t.data.byteLength);
            }
        }
    }
    console.log("Done checking Z=4.");
}

run().catch(console.error);
