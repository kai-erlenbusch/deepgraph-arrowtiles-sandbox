import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    // Search for FFFFFFFF38020000
    const target = Buffer.from("FFFFFFFF38020000", "hex");
    let index = -1;
    for (let i = 0; i < rawData.length - 8; i++) {
        let match = true;
        for (let j = 0; j < 8; j++) {
            if (rawData[i+j] !== target[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            index = i;
            break;
        }
    }
    console.log("Found FFFFFFFF38020000 at:", index);
    
    const bytesBefore = Buffer.from(rawData.buffer, rawData.byteOffset + index - 16, 16).toString('hex');
    const bytesAfter = Buffer.from(rawData.buffer, rawData.byteOffset + index, 64).toString('hex');
    console.log("Bytes before:", bytesBefore);
    console.log("Bytes after:", bytesAfter);
}
run().catch(console.error);
