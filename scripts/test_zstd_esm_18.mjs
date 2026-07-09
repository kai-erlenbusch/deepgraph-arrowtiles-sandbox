import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    // We can inject console.log to see the size
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    console.log("Decompressed Size:", rawData.length);
    
    // Now let's combine schema and the part starting at 8411919
    const schemaFile = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    const offset = 8411919;
    const batchData = rawData.subarray(offset);
    
    const combinedBuffer = new Uint8Array(schemaFile.length + batchData.length);
    combinedBuffer.set(schemaFile, 0);
    combinedBuffer.set(batchData, schemaFile.length);
    
    try {
        const { tableFromIPC } = await import('apache-arrow');
        const table = tableFromIPC(combinedBuffer);
        console.log("SUCCESS! Parsed table with length:", table.numRows);
    } catch(e) {
        console.error("Error:", e.message);
    }
}
run().catch(console.error);
