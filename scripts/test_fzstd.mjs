import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';
import fzstd from 'fzstd';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    const schemaFile = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    
    console.log("Decompressing with fzstd...");
    const rawData = fzstd.decompress(new Uint8Array(compressed));
    console.log("Decompressed length:", rawData.length);
    
    const combinedBuffer = new Uint8Array(schemaFile.length + rawData.length);
    combinedBuffer.set(schemaFile, 0);
    combinedBuffer.set(rawData, schemaFile.length);

    console.log("Reading with apache-arrow...");
    try {
        const table = tableFromIPC(combinedBuffer);
        console.log("SUCCESS! Parsed table with length:", table.numRows);
    } catch (e) {
        console.error("Reader failed:", e.message);
    }
}
run().catch(console.error);
