import { tableFromIPC } from 'apache-arrow';
import { init as initZstd, decompress as zstdDecompress } from '@bokuweb/zstd-wasm';

let zstdInitPromise: Promise<void> | null = null;
let globalSchemaBuffer: Uint8Array | null = null;

self.onmessage = async (e) => {
    if (!zstdInitPromise) {
        zstdInitPromise = initZstd().catch((err: any) => {
            zstdInitPromise = null;
            throw err;
        });
    }
    try {
        await zstdInitPromise;
    } catch (err: any) {
        self.postMessage({ error: `Failed to initialize Zstd WASM: ${err.message}`, key: e.data.key || e.data.id });
        return;
    }
    
    const data = e.data;
    
    if (data.action === 'init_schema') {
        globalSchemaBuffer = new Uint8Array(data.schemaBuffer);
        return;
    }
    
    if (data.action === 'decompress') {
        try {
            const decompressed = zstdDecompress(new Uint8Array(data.buffer), { defaultHeapSize: 1024 * 1024 * 32 });
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
    const { key, buffers, requestedColumns, pooledColumns } = data;
    if (!key || !buffers) return; // Skip if this doesn't look like a tile decode request
    
    try {
        const tables = buffers.map((buffer: ArrayBuffer | null, idx: number) => {
            if (!buffer) return null;
            let rawData = new Uint8Array(buffer);
            
            if (rawData.length >= 4 && rawData[0] === 0x28 && rawData[1] === 0xB5 && rawData[2] === 0x2F && rawData[3] === 0xFD) {
                rawData = zstdDecompress(rawData, { defaultHeapSize: 1024 * 1024 * 32 });
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
                        let schemaToUse = globalSchemaBuffer;
                        const ipcBuffer = new Uint8Array(schemaToUse.length + rawData.length);
                        ipcBuffer.set(schemaToUse, 0);
                        ipcBuffer.set(rawData, schemaToUse.length);
                        const table2 = tableFromIPC(ipcBuffer);
                        if (table2 && table2.numRows > 0) {
                            table = table2;
                        }
                    } catch (e2) {
                        console.error("Worker: Fallback parsing failed", e2);
                    }
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
            const columns: Record<string, ArrayBuffer> = {};
            const transferables: ArrayBuffer[] = [];
            
            const getFloat32ColFromU16 = (raw: Uint16Array, pooled: ArrayBuffer | undefined) => {
                let buf: Float32Array;
                if (pooled && pooled.byteLength >= numRows * 4) {
                    buf = new Float32Array(pooled, 0, numRows);
                } else {
                    buf = new Float32Array(numRows);
                }
                for (let i = 0; i < numRows; i++) {
                    buf[i] = raw[i] / 65535.0;
                }
                return buf.buffer;
            };

            const getFloat32Col = (name: string, pooled: ArrayBuffer | undefined) => {
                const raw = getCol(name);
                
                let buf: Float32Array;
                if (pooled && pooled.byteLength >= numRows * 4) {
                    buf = new Float32Array(pooled, 0, numRows);
                } else {
                    buf = new Float32Array(numRows);
                }
                
                if (raw) {
                    if (raw instanceof Float32Array) {
                        buf.set(raw.subarray(0, numRows));
                    } else {
                        for (let i = 0; i < numRows; i++) {
                            buf[i] = raw[i];
                        }
                    }
                } else {
                    buf.fill(0.0); // Safe fallback
                }
                return buf.buffer;
            };
            
            const reqCols = requestedColumns || ['x_u16', 'y_u16'];
            
            for (const col of reqCols) {
                let buf: ArrayBuffer;
                const pooled = (pooledColumns && pooledColumns[col]) ? pooledColumns[col] : undefined;
                
                if (col === 'x_u16') {
                    buf = getFloat32ColFromU16(xU16, pooled);
                } else if (col === 'y_u16') {
                    buf = getFloat32ColFromU16(yU16, pooled);
                } else {
                    buf = getFloat32Col(col, pooled);
                }
                
                columns[col] = buf;
                transferables.push(buf);
            }

            const rawPayloads = buffers.filter((b: any) => b !== null);
            transferables.push(...rawPayloads);
            
            console.log(`Worker sending ${numRows} rows for tile ${key}`);
            self.postMessage({
                key,
                columns,
                numRows: numRows,
                rawPayloads: rawPayloads
            }, { transfer: transferables });
        } else {
            self.postMessage({ key, error: "Missing x_u16 or y_u16" });
        }
    } catch (error: any) {
        self.postMessage({ key, error: error.stack || error.message || "Unknown error" });
    }
};
