import fs from 'fs';

async function run() {
    const compressed = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0_NEW_COMPRESSED.bin');
    
    const zstddec = await import('zstddec');
    const zstdDecoder = new zstddec.ZSTDDecoder();
    await zstdDecoder.init();
    
    const wasmExports = zstdDecoder._init ? zstdDecoder._init.instance?.exports : null;
    
    // We can't access internals easily, let's just log what we can.
    console.log("Raw Data Length:", zstdDecoder.decode(new Uint8Array(compressed)).length);
}
run().catch(console.error);
