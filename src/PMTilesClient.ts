import { PMTiles, Compression } from 'pmtiles';
import PQueue from 'p-queue';
import ArrowWorker from './pmtiles.worker?worker';

export interface BoundingBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface TileData {
    key: string; // "z/x/y"
    columns: Record<string, ArrayBuffer>;
    numRows: number;
    needsUpdate?: boolean;
}

export class PMTilesClient {
    private pmtiles: PMTiles;
    private rootBounds: BoundingBox;
    public cacheChanged: boolean = true;
    private activeTiles = new Map<string, TileData>();
    public onTileLoaded: ((tile: TileData) => void) | null = null;
    public onTileUnloaded: ((tileId: string) => void) | null = null;
    private loadingTiles = new Set<string>();
    private currentlyVisibleIds = new Set<string>();
    private lastSeenTimestamp = new Map<string, number>();
    private maxCacheSize: number;
    private queue = new PQueue({ concurrency: 6 });
    private allWorkers: Worker[] = [];
    private idleWorkers: Worker[] = [];
    private pendingTasks: { payload: any, transfer: any[], abortSignal?: AbortSignal }[] = [];
    private abortControllers = new Map<string, AbortController>();
    private resolvers = new Map<string, {resolve: Function, reject: Function, t0: number, tNetEnd: number, signal?: AbortSignal, onAbort?: () => void}>();
    private decompressResolvers = new Map<string, {resolve: Function, reject: Function}>();

    private dispatchToWorker(payload: any, transfer: any[], abortSignal?: AbortSignal) {
        if (abortSignal?.aborted) return;
        const worker = this.idleWorkers.shift();
        if (worker) {
            worker.postMessage(payload, transfer);
        } else {
            this.pendingTasks.push({ payload, transfer, abortSignal });
        }
    }

    private checkPendingTasks(worker: Worker) {
        while (this.pendingTasks.length > 0) {
            const task = this.pendingTasks.shift()!;
            if (task.abortSignal?.aborted) continue;
            worker.postMessage(task.payload, task.transfer);
            return;
        }
        this.idleWorkers.push(worker);
    }
    private bufferPool: { 
        columns: Map<string, ArrayBuffer[]>,
        rawPayload: ArrayBuffer[]
    } = { columns: new Map(), rawPayload: [] };
    
    private requestedColumns: string[] = ['x_u16', 'y_u16'];

    public setRequestedColumns(cols: string[]) {
        this.requestedColumns = cols;
        this.activeTiles.clear();
        this.cacheChanged = true;
        this.queue.clear();
        this.loadingTiles.clear();
        for (const abort of this.abortControllers.values()) {
            abort.abort();
        }
        this.abortControllers.clear();
    }

    public fetchTelemetry = { net: [] as number[], worker: [] as number[] };

    private corePmtiles: PMTiles;
    private layerPmtiles: PMTiles[] = [];
    private currentMaxZ: number = 0;

    constructor(coreUrl: string, layerUrls: string[], rootBounds: BoundingBox, maxCacheSize: number = 200, schemaBuffer: Uint8Array | null) {
        this.rootBounds = rootBounds;
        this.maxCacheSize = maxCacheSize;
        
        const numWorkers = navigator.hardwareConcurrency ? Math.max(2, navigator.hardwareConcurrency) : 8;
        for (let i = 0; i < numWorkers; i++) {
            const worker = new ArrowWorker();
            worker.onmessage = (e) => this.handleWorkerMessage(e, worker);
            
            if (schemaBuffer) {
                const schemaCopy = schemaBuffer.slice();
                worker.postMessage({ action: 'init_schema', schemaBuffer: schemaCopy }, [schemaCopy.buffer]);
            }
            
            this.allWorkers.push(worker);
            this.idleWorkers.push(worker);
        }

        const customDecompress = async (buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> => {
            if (compression === Compression.None || compression === 1) return buf;
            if (compression === Compression.Gzip || compression === 2) {
                const ds = new DecompressionStream('gzip');
                const response = new Response(buf);
                const decompressedStream = response.body!.pipeThrough(ds);
                return await new Response(decompressedStream).arrayBuffer();
            }
            if (compression === 4) { // Zstd is 4
                const copy = buf.slice(0);
                return new Promise((resolve, reject) => {
                    const id = `decomp_${Math.random()}`;
                    this.decompressResolvers.set(id, { resolve, reject });
                    this.dispatchToWorker({ action: 'decompress', id, buffer: copy }, [copy]);
                });
            }
            throw new Error(`Unsupported compression: ${compression}`);
        };

        this.corePmtiles = new PMTiles(coreUrl, undefined, customDecompress);
        for (const lUrl of layerUrls) {
            this.layerPmtiles.push(new PMTiles(lUrl, undefined, customDecompress));
        }
    }

    private handleWorkerMessage(e: MessageEvent, worker: Worker) {
        const data = e.data;
        if (data.action === 'decompress') {
            const resolver = this.decompressResolvers.get(data.id);
            if (resolver) {
                this.decompressResolvers.delete(data.id);
                if (data.error) resolver.reject(new Error(data.error));
                else resolver.resolve(data.buffer);
            }
            this.checkPendingTasks(worker);
            return;
        }
        
        if (data.error) {
             console.error("Worker error:", data.error);
        }
        if (!data.columns || !data.columns['x_u16'] || !data.columns['y_u16']) {
             console.log("Worker returned missing X or Y buffer for key", data.key);
             const resolver = this.resolvers.get(data.key);
             if (resolver) {
                 this.resolvers.delete(data.key);
                 if (resolver.signal && resolver.onAbort) resolver.signal.removeEventListener('abort', resolver.onAbort);
                 resolver.reject(new Error(data.error || "No xBuffer/yBuffer"));
             }
             return;
        }

        const numRows = data.numRows;

        const req = this.resolvers.get(data.key);
        if (req) {
            this.resolvers.delete(data.key);
            if (req.signal && req.onAbort) req.signal.removeEventListener('abort', req.onAbort);
            if (data.error) {
                req.reject(new Error(data.error));
            } else {
                const tileData: TileData = {
                    key: data.key,
                    columns: data.columns,
                    numRows: numRows,
                    needsUpdate: true
                };
                req.resolve(tileData);
                
                // Push the raw payload buffer(s) back into the pool for recycling
                if (data.rawPayloads) {
                    for (const rawBuf of data.rawPayloads) {
                        if (rawBuf) this.bufferPool.rawPayload.push(rawBuf);
                    }
                }
                
                const tWorkerEnd = performance.now();
                this.fetchTelemetry.net.push(req.tNetEnd - req.t0);
                this.fetchTelemetry.worker.push(tWorkerEnd - req.tNetEnd);
                if (this.fetchTelemetry.net.length > 50) {
                    this.fetchTelemetry.net.shift();
                    this.fetchTelemetry.worker.shift();
                }
            }
        } else {
            // Worker returned data but the request was already aborted/deleted.
            // Put buffers back into the pool to prevent memory leaks!
            const MAX_POOL_SIZE = 50;
            if (data.columns) {
                for (const colName of Object.keys(data.columns)) {
                    let colPool = this.bufferPool.columns.get(colName);
                    if (!colPool) {
                        colPool = [];
                        this.bufferPool.columns.set(colName, colPool);
                    }
                    if (colPool.length < MAX_POOL_SIZE) {
                        colPool.push(data.columns[colName]);
                    }
                }
            }
            if (data.rawPayloads) {
                for (const rawBuf of data.rawPayloads) {
                    if (rawBuf && this.bufferPool.rawPayload.length < MAX_POOL_SIZE) {
                        this.bufferPool.rawPayload.push(rawBuf);
                    }
                }
            }
        }
        this.checkPendingTasks(worker);
    }



    // Convert PMTiles tile ID back to Web Mercator-like bounds to check visibility
    private tileBounds(z: number, x: number, y: number): BoundingBox {
        // Our hilbert_normalized used 0.0 to 1.0 logic, mapped over a 4^z grid.
        // x goes from 0 to 2^z - 1. y goes from 0 to 2^z - 1.
        const width = (this.rootBounds.maxX - this.rootBounds.minX) / Math.pow(2, z);
        const height = (this.rootBounds.maxY - this.rootBounds.minY) / Math.pow(2, z);
        
        return {
            minX: this.rootBounds.minX + x * width,
            maxX: this.rootBounds.minX + (x + 1) * width,
            minY: this.rootBounds.minY + y * height,
            maxY: this.rootBounds.minY + (y + 1) * height
        };
    }

    private isVisible(bounds: BoundingBox, frustum: BoundingBox): boolean {
        return !(bounds.maxX < frustum.minX || 
                 bounds.minX > frustum.maxX || 
                 bounds.maxY < frustum.minY || 
                 bounds.minY > frustum.maxY);
    }

    private visibleTilesBuf: TileData[] = [];

    public getVisibleTiles(worldFrustum: BoundingBox, z: number): TileData[] {
        const frustumBox: BoundingBox = {
             minX: (worldFrustum.minX + 2) / 4.0,
             maxX: (worldFrustum.maxX + 2) / 4.0,
             minY: (1.0 - worldFrustum.maxY) / 2.0,
             maxY: (1.0 - worldFrustum.minY) / 2.0
        };

        this.currentlyVisibleIds.clear();

        // 1. Gather all potentially visible tiles across all LOD levels
        const candidateTiles: { cz: number, x: number, y: number, key: string, score: number }[] = [];
        
        for (let cz = 0; cz <= z; cz++) {
            const numTiles = 1 << cz;
            const width = (this.rootBounds.maxX - this.rootBounds.minX) / numTiles;
            const height = (this.rootBounds.maxY - this.rootBounds.minY) / numTiles;

            const startX = Math.max(0, Math.floor((worldFrustum.minX - this.rootBounds.minX) / width));
            const endX = Math.min(numTiles - 1, Math.floor((worldFrustum.maxX - this.rootBounds.minX) / width));
            const startY = Math.max(0, Math.floor((this.rootBounds.maxY - worldFrustum.maxY) / height));
            const endY = Math.min(numTiles - 1, Math.floor((this.rootBounds.maxY - worldFrustum.minY) / height));

            const centerX = (startX + endX) / 2.0;
            const centerY = (startY + endY) / 2.0;

            for (let x = startX; x <= endX; x++) {
                for (let y = startY; y <= endY; y++) {
                    const key = `${cz}/${x}/${y}`;
                    // Score = DistanceToCenter + (Z_Level * DepthPenalty)
                    // Smaller score = higher priority
                    const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
                    const score = dist + (cz * 0.5); 
                    candidateTiles.push({ cz, x, y, key, score });
                }
            }
        }

        // 2. Sort candidates by score ascending (lowest score = highest priority)
        candidateTiles.sort((a, b) => a.score - b.score);

        // 3. Take the top N tiles up to our budget
        const budget = this.maxCacheSize - 10;
        const selectedTiles = candidateTiles.slice(0, budget);
        this.currentMaxZ = z;

        // 4. Dispatch the selected tiles
        for (let i = 0; i < selectedTiles.length; i++) {
            const { cz, x, y, key } = selectedTiles[i];
            this.currentlyVisibleIds.add(key);
            this.lastSeenTimestamp.set(key, performance.now());
            
            if (!this.activeTiles.has(key) && !this.loadingTiles.has(key)) {
                this.loadingTiles.add(key);
                // Inverse priority for p-queue (higher number = higher priority)
                const queuePriority = budget - i; 
                this.queue.add(() => this.loadTile(cz, x, y, key), { priority: queuePriority }).catch(() => {});
            }
        }

        // Abort any tiles that are currently loading but are no longer visible
        for (const key of this.loadingTiles) {
            if (!this.currentlyVisibleIds.has(key)) {
                this.abortControllers.get(key)?.abort();
                this.abortControllers.delete(key);
                this.loadingTiles.delete(key);
            }
        }

        // Evict LRU off-screen tiles if we exceed max capacity (Zero-allocation O(N) eviction)
        let totalTiles = this.activeTiles.size + this.loadingTiles.size;
        while (totalTiles > this.maxCacheSize) {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            
            for (const key of this.activeTiles.keys()) {
                if (!this.currentlyVisibleIds.has(key)) {
                    const time = this.lastSeenTimestamp.get(key) || 0;
                    if (time < oldestTime) {
                        oldestTime = time;
                        oldestKey = key;
                    }
                }
            }
            
            if (oldestKey) {
                const evictedTile = this.activeTiles.get(oldestKey);
                if (evictedTile) {
                    const MAX_POOL_SIZE = this.maxCacheSize;
                    if (evictedTile.columns) {
                        for (const colName of Object.keys(evictedTile.columns)) {
                            let colPool = this.bufferPool.columns.get(colName);
                            if (!colPool) {
                                colPool = [];
                                this.bufferPool.columns.set(colName, colPool);
                            }
                            if (colPool.length < MAX_POOL_SIZE) {
                                colPool.push(evictedTile.columns[colName]);
                            }
                        }
                    }
                }
                this.activeTiles.delete(oldestKey);
                this.lastSeenTimestamp.delete(oldestKey);
                if (this.onTileUnloaded) this.onTileUnloaded(oldestKey);
                totalTiles--;
            } else {
                break; // No more off-screen tiles to evict
            }
        }

        this.visibleTilesBuf.length = 0;
        for (const key of this.currentlyVisibleIds) {
            const tile = this.activeTiles.get(key);
            if (tile) this.visibleTilesBuf.push(tile);
        }
        return this.visibleTilesBuf;
    }

    private parseArrowInWorker(key: string, dataArray: (Uint8Array | null)[], t0: number, tNetEnd: number, signal: AbortSignal): Promise<TileData> {
        return new Promise((resolve, reject) => {
            let timeoutId: ReturnType<typeof setTimeout>;

            const cleanup = () => {
                clearTimeout(timeoutId);
                this.resolvers.delete(key);
            };

            const onAbort = () => {
                cleanup();
                reject(new DOMException('Aborted', 'AbortError'));
            };
            
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort);

            // Timeout after 15 seconds to prevent memory leaks from hung workers
            timeoutId = setTimeout(() => {
                signal.removeEventListener('abort', onAbort);
                cleanup();
                reject(new Error(`Worker decode timeout for tile ${key}`));
            }, 15000);

            const wrappedResolve = (val: any) => { clearTimeout(timeoutId); resolve(val); };
            const wrappedReject = (err: any) => { clearTimeout(timeoutId); reject(err); };

            this.resolvers.set(key, { resolve: wrappedResolve, reject: wrappedReject, t0, tNetEnd, signal, onAbort });
            
            const rawPayloadsToTransfer: ArrayBuffer[] = [];
            const copies = dataArray.map(d => {
                if (!d) return null;
                // Zero-Allocation Buffer Pooling
                let buf = this.bufferPool.rawPayload.pop();
                if (!buf || buf.byteLength !== d.byteLength) {
                    buf = new ArrayBuffer(d.byteLength);
                }
                
                let sourceData: Uint8Array;
                if (d instanceof Uint8Array) {
                    sourceData = d;
                } else if ((d as any).buffer !== undefined) {
                    sourceData = new Uint8Array((d as any).buffer, (d as any).byteOffset, (d as any).byteLength);
                } else {
                    sourceData = new Uint8Array(d as ArrayBuffer);
                }
                
                new Uint8Array(buf).set(sourceData);
                
                rawPayloadsToTransfer.push(buf);
                return buf;
            });
            const pooledColumns: Record<string, ArrayBuffer> = {};
            for (const col of this.requestedColumns) {
                const p = this.bufferPool.columns.get(col)?.pop();
                if (p) pooledColumns[col] = p;
            }
            
            const transferables = [...rawPayloadsToTransfer];
            for (const col of Object.keys(pooledColumns)) {
                transferables.push(pooledColumns[col]);
            }

            const payload = { 
                action: 'decode', 
                key, 
                buffers: copies,
                requestedColumns: this.requestedColumns,
                pooledColumns: pooledColumns
            };
            this.dispatchToWorker(payload, transferables, signal);
        });
    }

    private async loadTile(z: number, x: number, y: number, key: string) {
        // If it's no longer visible AND we are over capacity, drop the network request
        if (!this.currentlyVisibleIds.has(key) && (this.activeTiles.size + this.loadingTiles.size) >= this.maxCacheSize) {
            this.loadingTiles.delete(key);
            this.abortControllers.delete(key);
            return;
        }

        const abortController = new AbortController();
        this.abortControllers.set(key, abortController);

        try {
            const t0 = performance.now();
            const swallowAbort = (e: any) => { if (e.name !== 'AbortError') console.error(e); return undefined; };
            const promises = [this.corePmtiles.getZxy(z, x, y, abortController.signal).catch(swallowAbort)];
            for (const layer of this.layerPmtiles) {
                promises.push(layer.getZxy(z, x, y, abortController.signal).catch(swallowAbort));
            }
            const tiles = await Promise.all(promises);
            const tNetEnd = performance.now();
            
            if (tiles[0]) {
                const payloads = tiles.map(t => t ? t.data : null);
                
                const tileData = await this.parseArrowInWorker(key, payloads, t0, tNetEnd, abortController.signal);
                this.activeTiles.set(key, tileData);
                this.cacheChanged = true;
                if (this.onTileLoaded) this.onTileLoaded(tileData);
            }
        } catch (e: any) {
            if (e.name === 'AbortError') {
                return; // Silently ignore aborted requests
            }
            console.error(`Failed to load tile ${key}`, e);
        } finally {
            this.loadingTiles.delete(key);
            this.abortControllers.delete(key);
        }
    }
}
