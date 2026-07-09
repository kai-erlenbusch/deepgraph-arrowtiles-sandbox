import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    const schemaFile = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    
    // We found `01000000` at 1032. Wait, can we pass a schema + buffer?
    const schemaLen = schemaFile.length;
    // We want to combine the schema and the part of rawData starting from 1032
    // BUT what if we try starting from 1032?
    const batchData = rawData.subarray(1032);
    
    const combinedBuffer = new Uint8Array(schemaLen + batchData.length);
    combinedBuffer.set(schemaFile, 0);
    combinedBuffer.set(batchData, schemaLen);
    
    try {
        const table = tableFromIPC(combinedBuffer);
        console.log("SUCCESS! Parsed table with length:", table.numRows);
    } catch(e) {
        console.error("Error with 1032 offset:", e.message);
    }
}
run().catch(console.error);
