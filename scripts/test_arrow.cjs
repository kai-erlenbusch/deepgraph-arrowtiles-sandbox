const { PMTiles } = require('pmtiles');
const fs = require('fs');

async function test() {
    class FileAdapter {
        constructor(filename) {
            this.filename = filename;
            this.fd = fs.openSync(filename, 'r');
        }
        async getBytes(offset, length) {
            const buf = Buffer.alloc(length);
            fs.readSync(this.fd, buf, 0, length, offset);
            return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
        }
        getKey() { return this.filename; }
    }

    const p = new PMTiles(new FileAdapter("D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/gaia.arrowtiles"), undefined, async (buffer, compression) => {
        return new Uint8Array(buffer);
    });
    
    const tile = await p.getZxy(0, 0, 0);
    if (!tile) {
        console.log("No tile found at 0/0/0");
        return;
    }
    
    let rawData = new Uint8Array(tile.data);
    fs.writeFileSync('D:/exploratory/duckdb-extension/deepgraph-arrowtiles-sandbox/public/tile_0_0_0.arrow', rawData);
    console.log("Saved raw tile to tile_0_0_0.arrow");
}
test().catch(e => console.error(e));
