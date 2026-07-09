import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    // Non zero starts at 1032
    const dataSlice = rawData.subarray(1032);
    
    const magic = Buffer.from('ARROW1\0\0');
    const fileBuffer = new Uint8Array(magic.length + dataSlice.length + magic.length);
    fileBuffer.set(magic, 0);
    fileBuffer.set(dataSlice, magic.length);
    fileBuffer.set(magic, magic.length + dataSlice.length); // ARROW1 at end too
    
    try {
        const table = tableFromIPC(fileBuffer);
        console.log("File parsed! Rows:", table.numRows);
    } catch (e) {
        console.log("Failed to parse as file:", e.message);
    }
}
run().catch(console.error);
