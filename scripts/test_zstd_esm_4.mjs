import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    let ffffIndex = -1;
    for (let i = 0; i < rawData.length - 4; i++) {
        if (rawData[i] === 0xFF && rawData[i+1] === 0xFF && rawData[i+2] === 0xFF && rawData[i+3] === 0xFF) {
            ffffIndex = i;
            break;
        }
    }
    
    const dataSlice = rawData.subarray(ffffIndex);
    
    try {
        const table = tableFromIPC(dataSlice);
        console.log("Self-contained slice parsed! Rows:", table.numRows);
    } catch (e) {
        console.log("Failed to parse self-contained slice:", e.message);
    }
}
run().catch(console.error);
