import { zxyToTileId } from 'pmtiles';
console.log("Z=1");
console.log("X=0, Y=0 :", zxyToTileId(1, 0, 0));
console.log("X=0, Y=1 :", zxyToTileId(1, 0, 1));
console.log("X=1, Y=0 :", zxyToTileId(1, 1, 0));
console.log("X=1, Y=1 :", zxyToTileId(1, 1, 1));
