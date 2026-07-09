import fs from 'fs';
import { ZstdDec } from './node_modules/zstddec/dist/zstddec.esm.js';

async function run() {
    const decoder = new ZstdDec();
    await decoder.init();
    
    const compressed = fs.readFileSync('public/tile_0_0_0.arrow');
    const decompressed = decoder.decode(compressed);
    
    console.log('Decompressed length:', decompressed.length);
    console.log('First 16 bytes:', Buffer.from(decompressed.buffer, decompressed.byteOffset, 16).toString('hex'));
    console.log('Last 16 bytes:', Buffer.from(decompressed.buffer, decompressed.byteOffset + decompressed.length - 16, 16).toString('hex'));
}
run().catch(console.error);
