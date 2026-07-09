import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    // Check first non-zero byte
    let start = -1;
    for (let i = 0; i < rawData.length; i++) {
        if (rawData[i] !== 0) {
            start = i;
            break;
        }
    }
    
    console.log("Non-zero starts at:", start);
    
    // It's probably a message! An IPC message starts with Continuation 0xFFFFFFFF unless it's the old version.
    // BUT what if the first 4 bytes are message length, and it's V4?
    // Let's just try tableFromIPC on the raw data starting from `start`
    
    const dataSlice = rawData.subarray(start);
    try {
        const table = tableFromIPC(dataSlice);
        console.log("Parsed from start:", table.numRows);
    } catch(e) {
        console.log("Failed to parse from start:", e.message);
    }
}
run().catch(console.error);
