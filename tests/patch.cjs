const fs = require('fs'); 
let c = fs.readFileSync('src/Scatterplot.ts', 'utf8'); 
c = c.replace(/const rawColor = attribute\('instanceColor', 'float'\);/g, "const rawColor = float(attribute('instanceColor', 'float'));"); 
c = c.replace(/const rawMag = attribute\('instanceSize', 'float'\);/g, "const rawMag = float(attribute('instanceSize', 'float'));"); 
c = c.replace(/const offsetX = attribute\('offsetX', 'float'\);/g, "const offsetX = float(attribute('offsetX', 'float'));"); 
c = c.replace(/const offsetY = attribute\('offsetY', 'float'\);/g, "const offsetY = float(attribute('offsetY', 'float'));"); 
c = c.replace(/const pointIx = attribute\('pointIx', 'float'\);/g, "const pointIx = float(attribute('pointIx', 'float'));"); 
c = c.replace(/const spawnTime = attribute\('spawnTime', 'float'\);/g, "const spawnTime = float(attribute('spawnTime', 'float'));"); 
fs.writeFileSync('src/Scatterplot.ts', c);
