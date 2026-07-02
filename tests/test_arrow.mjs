import { PMTiles } from 'pmtiles';
import { tableFromIPC, tableToIPC } from 'apache-arrow';

async function run() {
    const p = new PMTiles('http://localhost:5173/gaia.pmtiles');
    const meta = await p.getMetadata();
    const binaryString = atob(meta.schema_base64);
    const schemaBytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        schemaBytes[i] = binaryString.charCodeAt(i);
    }
    
    // Parse the file to get an empty Table with the correct schema
    const schemaTable = tableFromIPC(schemaBytes);
    console.log("Schema parsed successfully. Fields:", schemaTable.schema.fields.length);
    
    // Serialize it back to a STREAM (tableToIPC uses 'stream' type by default)
    const streamSchemaBytes = tableToIPC(schemaTable, "stream");
    console.log("Stream schema bytes length:", streamSchemaBytes.length);
    
    // Fetch tile
    const tile = await p.getZxy(0, 0, 0);
    const rawData = new Uint8Array(tile.data);
    
    // Prepend the stream schema to rawData
    const fullBuffer = new Uint8Array(streamSchemaBytes.length + rawData.length + 4);
    fullBuffer.set(streamSchemaBytes, 0);
    fullBuffer.set(rawData, streamSchemaBytes.length);
    // last 4 bytes are 0 (EOS)
    
    // Parse it!
    const tileTable = tableFromIPC(fullBuffer);
    console.log("SUCCESS! Parsed tile 0/0/0. Rows:", tileTable.numRows);
    
    const xNorm = tileTable.getChild("x_norm")?.toArray();
    console.log("xNorm length:", xNorm?.length);
}

run().catch(console.error);
