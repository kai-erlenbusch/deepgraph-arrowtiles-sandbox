import fs from 'fs'; import { PMTiles } from 'pmtiles'; import { tableFromIPC } from 'apache-arrow';
class LocalFileSource {
  constructor(path) { this.fd = fs.openSync(path, 'r'); }
  async getBytes(offset, length) {
    const buffer = Buffer.alloc(length);
    fs.readSync(this.fd, buffer, 0, length, offset);
    return { data: buffer.buffer };
  }
  getKey() { return 'local'; }
}
async function run() {
  const p = new PMTiles(new LocalFileSource('public/gaia.pmtiles'));
  const z0_data = await p.getZxy(0, 0, 0);
  if (z0_data) {
    const table = tableFromIPC(new Uint8Array(z0_data.data));
    const xU16 = table.getChild('x_u16').toArray();
    const yU16 = table.getChild('y_u16').toArray();
    let minX = 65535, maxX = 0, minY = 65535, maxY = 0;
    for (let i = 0; i < xU16.length; i++) {
        if (xU16[i] < minX) minX = xU16[i];
        if (xU16[i] > maxX) maxX = xU16[i];
        if (yU16[i] < minY) minY = yU16[i];
        if (yU16[i] > maxY) maxY = yU16[i];
    }
    console.log('x_u16 range:', minX, maxX);
    console.log('y_u16 range:', minY, maxY);
  }
}
run();
