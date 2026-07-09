import fs from 'fs';
import { RecordBatchReader } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    let globalSchemaBuffer = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    
    let schemaToUse = globalSchemaBuffer;
    if (schemaToUse.length >= 4) {
        const last4 = schemaToUse.subarray(schemaToUse.length - 4);
        if (last4[0] === 0 && last4[1] === 0 && last4[2] === 0 && last4[3] === 0) {
            schemaToUse = schemaToUse.subarray(0, schemaToUse.length - 4);
        }
    }

    const ipcBuffer = new Uint8Array(schemaToUse.length + rawData.length);
    ipcBuffer.set(schemaToUse, 0);
    ipcBuffer.set(rawData, schemaToUse.length);

    console.log("ipcBuffer size:", ipcBuffer.length);

    try {
        const arrowRecordBatchReader = RecordBatchReader.from(ipcBuffer);
        const batches = [...arrowRecordBatchReader];
        console.log("Got batches:", batches.length);
        if (batches.length > 0) {
            console.log("First batch rows:", batches[0].numRows);
        }
    } catch (e) {
        console.log("Failed:", e.message);
    }
}
run().catch(console.error);
