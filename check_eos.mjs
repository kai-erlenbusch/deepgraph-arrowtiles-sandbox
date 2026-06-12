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
    const schemaTable = tableFromIPC(schemaBytes);
    const streamSchemaBytes = tableToIPC(schemaTable, "stream");
    
    // Check last 8 bytes
    console.log("Last 8 bytes:", Array.from(streamSchemaBytes.slice(-8)));
}

run().catch(console.error);
