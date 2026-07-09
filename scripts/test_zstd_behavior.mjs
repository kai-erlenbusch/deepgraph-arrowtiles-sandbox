import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    // Decompress
    const uncompressed = zstdDecoder.decode(new Uint8Array(compressed));
    console.log("Returned size:", uncompressed.length);
    console.log("Memory buffer size:", zstdDecoder.memory.buffer.byteLength);
}
run().catch(console.error);
