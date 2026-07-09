import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    console.log("Compressed length:", compressed.length);
    
    // We only have ZSTDDecoder in pmtiles.worker.ts, but let's see what zstddec exports.
    // In pmtiles.worker.ts it imports ZSTDDecoder from 'zstddec'.
    // Let's use the exact package!
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const rawData = zstdDecoder.decode(new Uint8Array(compressed));
    console.log("RawData length:", rawData.length);
    
    const view = new DataView(rawData.buffer, rawData.byteOffset);
    if (rawData.length >= 8) {
        console.log("First 8 bytes hex:", Buffer.from(rawData.buffer, rawData.byteOffset, 8).toString('hex'));
        console.log("First 4 bytes uint32:", view.getUint32(0, true).toString(16));
    } else {
        console.log("rawData is too short!");
    }
}
run().catch(console.error);
