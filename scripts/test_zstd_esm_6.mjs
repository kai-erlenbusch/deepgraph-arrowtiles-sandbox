import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    for (let i = 0; i < rawData.length - 8; i++) {
        if (rawData[i] === 0xFF && rawData[i+1] === 0xFF && rawData[i+2] === 0xFF && rawData[i+3] === 0xFF) {
            console.log("FFFFFFFF at:", i, "next 4 bytes:", Buffer.from(rawData.buffer, rawData.byteOffset + i + 4, 4).toString('hex'));
        }
    }
}
run().catch(console.error);
