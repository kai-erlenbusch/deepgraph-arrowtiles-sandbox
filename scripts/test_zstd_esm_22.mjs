import fs from 'fs';
import { RecordBatchReader, tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    // We pass uncompressedSize to zstdDecoder.decode if we know it, otherwise it uses ZSTD_findDecompressedSize
    // Let's pass 13705992 (from python length) - wait, python raw_data was 13210426
    const python_raw_data_length = 13210426; // hardcode what we saw in Python
    const rawData = zstdDecoder.decode(new Uint8Array(compressed), python_raw_data_length);
    
    console.log("Decoding with exact uncompressed size:", rawData.length);
    
    const schemaFile = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    const combinedBuffer = new Uint8Array(schemaFile.length + rawData.length);
    combinedBuffer.set(schemaFile, 0);
    combinedBuffer.set(rawData, schemaFile.length);
    
    try {
        const table = tableFromIPC(combinedBuffer);
        console.log("SUCCESS! Parsed table with length:", table.numRows);
    } catch(e) {
        console.error("Error with exact size:", e.message);
    }
}
run().catch(console.error);
