import fs from 'fs';

async function run() {
    const pmtiles = await import('pmtiles');
    const f = fs.openSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles', 'r');
    const source = {
        getBytes: async (offset, length) => {
            const buf = new Uint8Array(length);
            fs.readSync(f, buf, 0, length, Number(offset));
            return { data: buf.buffer };
        },
        getKey: () => 'gaia.arrowtiles'
    };
    
    const reader = new pmtiles.PMTiles(source);
    const metadata = await reader.getMetadata();
    console.log("Metadata:", metadata);
    if (metadata.arrow_schema) {
        const schemaBuf = Buffer.from(metadata.arrow_schema, 'base64');
        console.log("Schema size from metadata:", schemaBuf.length);
        fs.writeFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles.schema.NEW', schemaBuf);
    }
}
run().catch(console.error);
