import { zxyToTileId } from 'pmtiles';

console.log("PMTiles JS Z=2 Hilbert IDs:");
for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
        console.log(`X=${x}, Y=${y} : ${zxyToTileId(2, x, y)}`);
    }
}
