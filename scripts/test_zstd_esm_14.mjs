import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    // Find ffffffff38020000
    for (let i = 0; i < rawData.length - 8; i++) {
        if (rawData[i] === 0xff && rawData[i+1] === 0xff && rawData[i+2] === 0xff && rawData[i+3] === 0xff &&
            rawData[i+4] === 0x38 && rawData[i+5] === 0x02 && rawData[i+6] === 0x00 && rawData[i+7] === 0x00) {
            console.log("Found Arrow IPC start at:", i);
            break;
        }
    }
}
run().catch(console.error);
