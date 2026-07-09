import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    const schemaFile = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    // We pass 50MB as uncompressedSize!
    const rawData = zstdDecoder.decode(new Uint8Array(compressed), 50 * 1024 * 1024);
    
    const combinedBuffer = new Uint8Array(schemaFile.length + rawData.length);
    combinedBuffer.set(schemaFile, 0);
    combinedBuffer.set(rawData, schemaFile.length);

    console.log("Reading...");
    try {
        const table = tableFromIPC(combinedBuffer);
        console.log("SUCCESS! Parsed table with length:", table.numRows);
    } catch (e) {
        console.error("Reader failed:", e.message);
    }
}
run().catch(console.error);
