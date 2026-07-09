import fs from 'fs';
import { tableFromIPC } from 'apache-arrow';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    let schemaToUse = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    
    // STRIP ALL ZEROES FROM THE END
    let trailingZeros = 0;
    while (schemaToUse[schemaToUse.length - 1 - trailingZeros] === 0) {
        trailingZeros++;
    }
    console.log("Trailing zeros in schema:", trailingZeros);
    
    if (trailingZeros > 0) {
        schemaToUse = schemaToUse.subarray(0, schemaToUse.length - trailingZeros);
    }
    
    // ALSO, what about rawData? 
    // Does it start with 1032 zeros? Yes! So those zeros are EOS markers too!
    // We must skip leading zeroes in rawData!
    let leadingZeros = 0;
    while (rawData[leadingZeros] === 0) {
        leadingZeros++;
    }
    console.log("Leading zeros in rawData:", leadingZeros);
    const dataSlice = rawData.subarray(leadingZeros);
    
    const ipcBuffer = new Uint8Array(schemaToUse.length + dataSlice.length);
    ipcBuffer.set(schemaToUse, 0);
    ipcBuffer.set(dataSlice, schemaToUse.length);
    
    try {
        const table = tableFromIPC(ipcBuffer);
        console.log("Successfully parsed! Rows:", table.numRows);
    } catch (e) {
        console.log("Failed:", e.message);
    }
}
run().catch(console.error);
