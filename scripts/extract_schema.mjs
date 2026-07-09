import { PMTiles, FileSource } from 'pmtiles';
import fs from 'fs';

async function extract() {
    const p = new PMTiles(new FileSource('public/gaia.arrowtiles'));
    const metadata = await p.getMetadata();
    
    fs.writeFileSync('public/gaia.arrowtiles.metadata.json', JSON.stringify(metadata, null, 2));
    console.log("Wrote metadata.json");
    
    if (metadata.arrow_schema) {
        const buf = Buffer.from(metadata.arrow_schema, 'base64');
        fs.writeFileSync('public/gaia.arrowtiles.schema', buf);
        console.log(`Wrote ${buf.length} bytes to schema file`);
    } else {
        console.log("No arrow_schema found in metadata!");
    }
}

extract().catch(console.error);
