import fs from 'fs';
let c = fs.readFileSync('src/Scatterplot.ts', 'utf8');
c = c.split("attribute('instanceColor', 'float')").join("float(attribute('instanceColor', 'float'))");
c = c.split("attribute('instanceSize', 'float')").join("float(attribute('instanceSize', 'float'))");
c = c.split("attribute('offsetX', 'float')").join("float(attribute('offsetX', 'float'))");
c = c.split("attribute('offsetY', 'float')").join("float(attribute('offsetY', 'float'))");
c = c.split("attribute('pointIx', 'float')").join("float(attribute('pointIx', 'float'))");
c = c.split("attribute('spawnTime', 'float')").join("float(attribute('spawnTime', 'float'))");
fs.writeFileSync('src/Scatterplot.ts', c);
