import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    
    const target = Buffer.from('ARROW1');
    let idx = -1;
    for (let i = 0; i < rawData.length - target.length; i++) {
        let match = true;
        for (let j = 0; j < target.length; j++) {
            if (rawData[i+j] !== target[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            idx = i;
            break;
        }
    }
    
    console.log("ARROW1 found at:", idx);
    if (idx !== -1) {
        console.log("Bytes at ARROW1:", Buffer.from(rawData.buffer, rawData.byteOffset + idx, 16).toString('hex'));
    }
}
run().catch(console.error);
