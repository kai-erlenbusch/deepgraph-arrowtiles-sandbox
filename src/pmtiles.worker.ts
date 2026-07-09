import { tableFromIPC } from 'apache-arrow';
import { init as initZstd, decompress as zstdDecompress } from '@bokuweb/zstd-wasm';

let zstdInitPromise: Promise<void> | null = null;
let globalSchemaBuffer: Uint8Array | null = null;

self.onmessage = async (e) => {
    if (!zstdInitPromise) {
        zstdInitPromise = initZstd({ defaultHeapSize: 1024 * 1024 * 64 });
    }
    try {
        await zstdInitPromise;
    } catch (err) {
        self.postMessage({ error: "Failed to initialize Zstd WASM", key: e.data.key || e.data.id });
        return;
    }
    
    const data = e.data;
    
    if (data.action === 'init_schema') {
        globalSchemaBuffer = new Uint8Array(data.schemaBuffer);
        return;
    }
    
    if (data.action === 'decompress') {
        try {
            const decompressed = zstdDecompress(new Uint8Array(data.buffer));
            const outBuf = decompressed.slice().buffer;
            self.postMessage({ 
                id: data.id, 
                action: 'decompress', 
                buffer: outBuf 
            }, { transfer: [outBuf] } as any);
        } catch (error: any) {
            self.postMessage({ id: data.id, action: 'decompress', error: error.stack || error.message || "Unknown error" });
        }
        return;
    }

    // Main data parsing
    const { key, buffers, pooledX, pooledY, pooledColor, pooledSize, pooledIx, pooledParallax, pooledTeff, pooledPmra, pooledPmdec, pooledRv } = data;
    if (!key || !buffers) return; // Skip if this doesn't look like a tile decode request
    
    try {
        const tables = buffers.map((buffer: ArrayBuffer | null) => {
            if (!buffer) return null;
            let rawData = new Uint8Array(buffer);
            
            if (rawData.length >= 4 && rawData[0] === 0x28 && rawData[1] === 0xB5 && rawData[2] === 0x2F && rawData[3] === 0xFD) {
                rawData = zstdDecompress(rawData);
            }
            
            let table: any = null;
            try {
                table = tableFromIPC(rawData);
            } catch (e) {
                // Ignore initial parse failure
            }

            if (!table || table.numRows === 0) {
                if (globalSchemaBuffer) {
                    try {
                        console.log("Worker: Fallback parsing with globalSchemaBuffer, length:", globalSchemaBuffer.length, "rawData length:", rawData.length);
                        // The schema might end with a 4-byte EOS token (0x00000000). Strip it before appending RecordBatches.
                        let schemaToUse = globalSchemaBuffer;
                        const ipcBuffer = new Uint8Array(schemaToUse.length + rawData.length);
                        ipcBuffer.set(schemaToUse, 0);
                        ipcBuffer.set(rawData, schemaToUse.length);
                        const table2 = tableFromIPC(ipcBuffer);
                        if (table2 && table2.numRows > 0) {
                            table = table2;
                            console.log("Worker: Fallback parsing SUCCEEDED! rows:", table.numRows);
                        } else {
                            console.log("Worker: Fallback parsing produced empty table?");
                        }
                    } catch (e2) {
                        console.error("Worker: Fallback parsing failed", e2);
                    }
                } else {
                    console.log("Worker: NO globalSchemaBuffer available!");
                }
            }
            return table;
        }).filter((t: any) => t !== null && t.numRows > 0);

        if (tables.length === 0) {
            throw new Error("No tables found");
        }
        
        const getCol = (name: string) => {
            for (const table of tables) {
                const child = table.getChild(name);
                if (child) return child.toArray();
            }
            return null;
        };

        const xU16 = getCol("x_u16") as Uint16Array;
        const yU16 = getCol("y_u16") as Uint16Array;
        
        if (xU16 && yU16) {
            const numRows = xU16.length;
            
            const getUint16Col = (raw: Uint16Array, pooled: ArrayBuffer | undefined) => {
                let buf: Uint16Array;
                if (pooled && pooled.byteLength >= numRows * 2) {
                    buf = new Uint16Array(pooled, 0, numRows);
                } else {
                    buf = new Uint16Array(numRows);
                }
                // Arrow buffers might be shared views into a giant IPC block, so we .set() them into our pooled transferable buffers natively in C++ via V8
                buf.set(raw.subarray(0, numRows));
                return buf;
            };

            const newX = getUint16Col(xU16, pooledX);
            const newY = getUint16Col(yU16, pooledY);

            const getFloat32Col = (name: string, pooled: ArrayBuffer | undefined, defaultVal: number | null) => {
                const raw = getCol(name) as Float32Array;
                let buf: Float32Array;
                if (pooled && pooled.byteLength >= numRows * 4) {
                    buf = new Float32Array(pooled, 0, numRows);
                } else {
                    buf = new Float32Array(numRows);
                }
                if (raw) {
                    buf.set(raw);
                } else if (defaultVal !== null) {
                    buf.fill(defaultVal);
                } else {
                    for (let i = 0; i < numRows; i++) buf[i] = i;
                }
                return buf;
            };

            const newColor = getFloat32Col("bp_rp", pooledColor, 1.0);
            const newSize = getFloat32Col("abs_m", pooledSize, 1.0);
            const newIx = getFloat32Col("ix", pooledIx, null);
            const newParallax = getFloat32Col("parallax", pooledParallax, 0.0);
            const newTeff = getFloat32Col("teff_gspphot", pooledTeff, 0.0);
            const newPmra = getFloat32Col("pmra", pooledPmra, 0.0);
            const newPmdec = getFloat32Col("pmdec", pooledPmdec, 0.0);
            const newRv = getFloat32Col("radial_velocity", pooledRv, 0.0);

            const transferables = [
                newX.buffer,
                newY.buffer,
                newColor.buffer, 
                newSize.buffer,
                newIx.buffer,
                newParallax.buffer,
                newTeff.buffer,
                newPmra.buffer,
                newPmdec.buffer,
                newRv.buffer
            ];
            
            self.postMessage({
                key,
                xBuffer: newX.buffer,
                yBuffer: newY.buffer,
                colorBuffer: newColor.buffer,
                sizeBuffer: newSize.buffer,
                ixBuffer: newIx.buffer,
                parallaxBuffer: newParallax.buffer,
                teffBuffer: newTeff.buffer,
                pmraBuffer: newPmra.buffer,
                pmdecBuffer: newPmdec.buffer,
                rvBuffer: newRv.buffer,
                numRows: numRows
            }, { transfer: transferables });
        } else {
            self.postMessage({ key, error: "Missing x_u16 or y_u16" });
        }
    } catch (error: any) {
        self.postMessage({ key, error: error.stack || error.message || "Unknown error" });
    }
};
