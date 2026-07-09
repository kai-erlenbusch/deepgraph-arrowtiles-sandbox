import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    const globalSchemaBuffer = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    
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
    
    let schemaBytesStripped = globalSchemaBuffer;
    if (globalSchemaBuffer.length >= 4) {
        const last4 = globalSchemaBuffer.subarray(globalSchemaBuffer.length - 4);
        if (last4[0] === 0 && last4[1] === 0 && last4[2] === 0 && last4[3] === 0) {
            schemaBytesStripped = globalSchemaBuffer.subarray(0, globalSchemaBuffer.length - 4);
        }
    }
    
    const ipcBuffer = new Uint8Array(schemaBytesStripped.length + dataSlice.length);
    ipcBuffer.set(schemaBytesStripped, 0);
    ipcBuffer.set(dataSlice, schemaBytesStripped.length);
    
    try {
        const table = tableFromIPC(ipcBuffer);
        console.log("SUCCESS!!! Rows:", table.numRows);
    } catch (e) {
        console.log("Failed:", e.message);
    }
}
run().catch(console.error);
