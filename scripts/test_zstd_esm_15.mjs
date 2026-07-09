import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    let firstNonZero = -1;
    for (let i = 0; i < rawData.length; i++) {
        if (rawData[i] !== 0) {
            firstNonZero = i;
            break;
        }
    }
    console.log("First non zero:", firstNonZero);
    console.log("Bytes at firstNonZero:", Buffer.from(rawData.buffer, rawData.byteOffset + firstNonZero, 64).toString('hex'));
}
run().catch(console.error);
