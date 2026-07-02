import { PMTiles } from 'pmtiles';

async function test() {
    const p = new PMTiles('http://localhost:5173/gaia.pmtiles');
    try {
        const t = await p.getZxy(3, 1, 6);
        console.log(t ? 'Exists: ' + t.length + ' bytes' : 'Not found');
    } catch(e) {
        console.error(e);
    }
}
test();
