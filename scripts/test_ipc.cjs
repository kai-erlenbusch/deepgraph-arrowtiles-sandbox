const fs = require('fs');
const fzstd = require('fzstd');
const { tableFromIPC } = require('apache-arrow');

async function test() {
    const schemaBytes = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema');
    const compressedBytes = fs.readFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0.arrow');
    
    // ZSTD decompress with fzstd
    const decompressed = fzstd.decompress(new Uint8Array(compressedBytes));
    console.log("Decompressed size:", decompressed.byteLength);
    
    // Search for the actual start of data!
    let nonZeroStart = -1;
    for (let i = 0; i < decompressed.length; i++) {
        if (decompressed[i] !== 0) {
            nonZeroStart = i;
            break;
        }
    }
    console.log("First non-zero byte at index:", nonZeroStart);
    if (nonZeroStart !== -1) {
        const dView = new Uint32Array(decompressed.buffer, decompressed.byteOffset + nonZeroStart, 4);
        console.log("Bytes at nonZeroStart (Uint32):", dView);
    }
    
    // Strip the last 4 bytes (EOS token) from schemaBytes(0x00000000)
    // Strip the last 4 bytes (EOS token) from schemaBytes
    const schemaBytesStripped = schemaBytes.slice(0, schemaBytes.length - 4);

    const combined = new Uint8Array(schemaBytesStripped.length + decompressed.length);
    combined.set(schemaBytesStripped, 0);
    combined.set(decompressed, schemaBytesStripped.length);
    
    console.log('Combined size:', combined.length);
    try {
        const table = tableFromIPC(combined);
        console.log('Table parsed successfully.');
        console.log('Table numRows:', table.numRows);
    } catch (e) {
        console.error('Error parsing table:', e);
    }
}

test().catch(console.error);
