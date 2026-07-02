import { PMTiles } from 'pmtiles';
import { tableFromIPC } from 'apache-arrow';

async function test() {
    const p = new PMTiles('http://localhost:5173/gaia.pmtiles');
    try {
        const t = await p.getZxy(3, 1, 6);
        if (t) {
            console.log('Tile 3/1/6 size:', t.byteLength);
            // We need to decompress using fzstd, but we can't in this simple script easily
            // let's just log the size
        } else {
            console.log('Tile 3/1/6 not found');
        }
    } catch(e) {
        console.error(e);
    }
}
test();
