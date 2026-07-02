import { tableFromIPC } from 'apache-arrow';

self.onmessage = (e) => {
    const { key, buffer } = e.data;
    
    try {
        const rawData = new Uint8Array(buffer);
        const table = tableFromIPC(rawData);
        
        const xU16 = table.getChild("x_u16")?.toArray() as Uint16Array;
        const yU16 = table.getChild("y_u16")?.toArray() as Uint16Array;
        const colorRaw = table.getChild("bp_rp")?.toArray() as Float32Array;
        const sizeRaw = table.getChild("abs_m")?.toArray() as Float32Array;
        const ixRaw = table.getChild("ix")?.toArray() as Float32Array;

        if (xU16 && yU16) {
            const numRows = xU16.length;
            const color = colorRaw || new Float32Array(numRows).fill(1.0);
            const size = sizeRaw || new Float32Array(numRows).fill(1.0);
            const ix = ixRaw || new Float32Array(numRows);

            // If ix was missing, auto-generate local brightness rank 
            // (since the pmtiles are pre-sorted by abs_m ASC)
            if (!ixRaw) {
                for (let i = 0; i < numRows; i++) {
                    ix[i] = i;
                }
            }

            // Explicitly copy data into new arrays to avoid transferring
            // the shared Arrow IPC ArrayBuffer, which would detach it from the worker
            // and break any subsequent accesses to other columns sharing the same block.
            const xyFloat = new Float32Array(numRows * 2);
            for (let i = 0; i < numRows; i++) {
                xyFloat[i * 2] = xU16[i] / 65535.0;
                xyFloat[i * 2 + 1] = yU16[i] / 65535.0;
            }
            
            const newColor = new Float32Array(color);
            const newSize = new Float32Array(size);
            const newIx = new Float32Array(ix);

            const transferables = [
                xyFloat.buffer, 
                newColor.buffer, 
                newSize.buffer,
                newIx.buffer
            ];
            
            self.postMessage({
                key,
                xyBuffer: xyFloat,
                colorBuffer: newColor,
                sizeBuffer: newSize,
                ixBuffer: newIx,
                numRows: numRows
            }, { transfer: transferables });
        } else {
            self.postMessage({ key, error: "Missing x_u16 or y_u16" });
        }
    } catch (error: any) {
        self.postMessage({ key, error: error.message || "Unknown error" });
    }
};
