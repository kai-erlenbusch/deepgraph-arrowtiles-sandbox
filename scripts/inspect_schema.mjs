import { PMTiles } from 'pmtiles';

async function run() {
    const p = new PMTiles('http://localhost:5173/gaia.pmtiles');
    const meta = await p.getMetadata();
    const binaryString = atob(meta.schema_base64);
    const schemaBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        schemaBytes[i] = binaryString.charCodeAt(i);
    }
    
    // Check if it starts with ARROW1
    const magic = String.fromCharCode(...schemaBytes.slice(0, 6));
    console.log("Magic:", magic);
    
    const dv = new DataView(schemaBytes.buffer, schemaBytes.byteOffset, schemaBytes.byteLength);
    let offset = 8;
    const marker = dv.getUint32(offset, true);
    if (marker === 0xFFFFFFFF) {
        console.log("Found V5 continuation marker!");
        offset += 4;
    }
    
    const messageLength = dv.getInt32(offset, true);
    console.log("Schema message length:", messageLength);
    
    const schemaMessageEnd = offset + 4 + messageLength;
    console.log("Schema message ends at:", schemaMessageEnd);
    console.log("Total schemaBytes length:", schemaBytes.length);
}

run().catch(console.error);
