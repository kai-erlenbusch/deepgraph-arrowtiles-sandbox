import { tableFromIPC } from 'apache-arrow';

self.onmessage = (e) => {
    const { key, buffer } = e.data;
    
    try {
        const rawData = new Uint8Array(buffer);
        const table = tableFromIPC(rawData);
        
        const xNorm = table.getChild("x_norm")?.toArray() as Float32Array;
        const yNorm = table.getChild("y_norm")?.toArray() as Float32Array;
        const colorRaw = table.getChild("bp_rp")?.toArray() as Float32Array;
        const sizeRaw = table.getChild("abs_m")?.toArray() as Float32Array;
        const ixRaw = table.getChild("ix")?.toArray() as Float32Array;

        if (xNorm && yNorm) {
            const numRows = xNorm.length;
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

            // Explicitly copy data into new Float32Arrays to avoid transferring
            // the shared Arrow IPC ArrayBuffer, which would detach it from the worker
            // and break any subsequent accesses to other columns sharing the same block.
            const newX = new Float32Array(xNorm);
            const newY = new Float32Array(yNorm);
            const newColor = new Float32Array(color);
            const newSize = new Float32Array(size);
            const newIx = new Float32Array(ix);

            const transferables = [
                newX.buffer, 
                newY.buffer, 
                newColor.buffer, 
                newSize.buffer,
                newIx.buffer
            ];
            
            self.postMessage({
                key,
                xBuffer: newX,
                yBuffer: newY,
                colorBuffer: newColor,
                sizeBuffer: newSize,
                ixBuffer: newIx,
                numRows: numRows
            }, { transfer: transferables });
        } else {
            self.postMessage({ key, error: "Missing x_norm or y_norm" });
        }
    } catch (error: any) {
        self.postMessage({ key, error: error.message || "Unknown error" });
    }
};
