import fs from 'fs';

const schema = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
console.log("Schema length:", schema.length);
console.log("First 8 bytes:", schema.subarray(0, 8).toString('hex'));
