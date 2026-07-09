import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    // Find FFFFFFFF
    let ffffIndex = -1;
    for (let i = 0; i < rawData.length - 4; i++) {
        if (rawData[i] === 0xFF && rawData[i+1] === 0xFF && rawData[i+2] === 0xFF && rawData[i+3] === 0xFF) {
            ffffIndex = i;
            break;
        }
    }
    
    console.log("FFFFFFFF at:", ffffIndex);
    
    if (ffffIndex === -1) throw new Error("No FFFFFFFF found");
    
    const globalSchemaBuffer = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    
    const dataSlice = rawData.subarray(ffffIndex);
    
    const ipcBuffer = new Uint8Array(globalSchemaBuffer.length + dataSlice.length);
    ipcBuffer.set(globalSchemaBuffer, 0);
    ipcBuffer.set(dataSlice, globalSchemaBuffer.length);
    
    try {
        const table = tableFromIPC(ipcBuffer);
        console.log("Sliced + Schema parsed perfectly! Rows:", table.numRows);
    } catch (e) {
        console.log("Failed to parse sliced data directly:", e.message);
    }
}
run().catch(console.error);
