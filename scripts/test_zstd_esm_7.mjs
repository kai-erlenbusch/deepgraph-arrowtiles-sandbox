import fs from 'fs';
import { RecordBatchReader } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    const dataSlice = rawData.subarray(1032);
    
    try {
        const reader = RecordBatchReader.from(dataSlice);
        reader.open();
        console.log("Reader opened! Schema:", reader.schema !== null);
        let rows = 0;
        for await (const batch of reader) {
            rows += batch.numRows;
            console.log("Got batch with rows:", batch.numRows);
        }
        console.log("Total rows:", rows);
    } catch(e) {
        console.log("Failed reader:", e.stack);
    }
}
run().catch(console.error);
