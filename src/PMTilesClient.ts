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
    xBuffer?: ArrayBuffer;
    yBuffer?: ArrayBuffer;
    colorBuffer?: ArrayBuffer;
    sizeBuffer?: ArrayBuffer;
    ixBuffer?: ArrayBuffer;
    parallaxBuffer?: ArrayBuffer;
    teffBuffer?: ArrayBuffer;
    pmraBuffer?: ArrayBuffer;
    pmdecBuffer?: ArrayBuffer;
    rvBuffer?: ArrayBuffer;
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
    private workers: Worker[] = [];
    private workerIndex = 0;
    private abortControllers = new Map<string, AbortController>();
    private resolvers = new Map<string, {resolve: Function, reject: Function, t0: number, tNetEnd: number, signal?: AbortSignal, onAbort?: () => void}>();
    private bufferPool: { 
        x: ArrayBuffer[], y: ArrayBuffer[], color: ArrayBuffer[], size: ArrayBuffer[], ix: ArrayBuffer[],
        parallax: ArrayBuffer[], teff: ArrayBuffer[], pmra: ArrayBuffer[], pmdec: ArrayBuffer[], rv: ArrayBuffer[] 
    } = { x: [], y: [], color: [], size: [], ix: [], parallax: [], teff: [], pmra: [], pmdec: [], rv: [] };

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
            worker.onmessage = (e) => this.handleWorkerMessage(e);
            
            if (schemaBuffer) {
                const schemaCopy = schemaBuffer.slice();
                worker.postMessage({ action: 'init_schema', schemaBuffer: schemaCopy }, [schemaCopy.buffer]);
            }
            
            this.workers.push(worker);
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
                    const worker = this.workers[this.workerIndex++ % this.workers.length];
                    const id = `decomp_${Math.random()}`;
                    const listener = (e: MessageEvent) => {
                        if (e.data.action === 'decompress' && e.data.id === id) {
                            worker.removeEventListener('message', listener);
                            if (e.data.error) reject(new Error(e.data.error));
                            else resolve(e.data.buffer);
                        }
                    };
                    worker.addEventListener('message', listener);
                    worker.postMessage({ action: 'decompress', id, buffer: copy }, [copy]);
                });
            }
            throw new Error(`Unsupported compression: ${compression}`);
        };

        this.corePmtiles = new PMTiles(coreUrl, undefined, customDecompress);
        for (const lUrl of layerUrls) {
            this.layerPmtiles.push(new PMTiles(lUrl, undefined, customDecompress));
        }
    }

    private handleWorkerMessage(e: MessageEvent) {
        const data = e.data;
        if (data.action === 'decompress') return; // Handled by inline listener
        
        if (data.error) {
             console.error("Worker error:", data.error);
        }
        if (!data.xBuffer || !data.yBuffer) {
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
                    xBuffer: data.xBuffer,
                    yBuffer: data.yBuffer,
                    colorBuffer: data.colorBuffer,
                    sizeBuffer: data.sizeBuffer,
                    ixBuffer: data.ixBuffer,
                    parallaxBuffer: data.parallaxBuffer,
                    teffBuffer: data.teffBuffer,
                    pmraBuffer: data.pmraBuffer,
                    pmdecBuffer: data.pmdecBuffer,
                    rvBuffer: data.rvBuffer,
                    numRows: numRows,
                    needsUpdate: true
                };
                req.resolve(tileData);
                
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
            if (this.bufferPool.x.length < MAX_POOL_SIZE) {
                if (data.xBuffer) this.bufferPool.x.push(data.xBuffer);
                if (data.yBuffer) this.bufferPool.y.push(data.yBuffer);
                if (data.colorBuffer) this.bufferPool.color.push(data.colorBuffer);
                if (data.sizeBuffer) this.bufferPool.size.push(data.sizeBuffer);
                if (data.ixBuffer) this.bufferPool.ix.push(data.ixBuffer);
                if (data.parallaxBuffer) this.bufferPool.parallax.push(data.parallaxBuffer);
                if (data.teffBuffer) this.bufferPool.teff.push(data.teffBuffer);
                if (data.pmraBuffer) this.bufferPool.pmra.push(data.pmraBuffer);
                if (data.pmdecBuffer) this.bufferPool.pmdec.push(data.pmdecBuffer);
                if (data.rvBuffer) this.bufferPool.rv.push(data.rvBuffer);
            }
        }
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

        // Additive Quadtree: We must fetch all parent tiles from root (Z=0) up to currentZ
        // Automatic Budgeting: We drill as deep as possible for maximum density, 
        // as long as the LOD layer does not require more than 256 tiles on screen.
        let plannedTiles = 0;
        for (let cz = 0; cz <= z; cz++) {
            const numTiles = 1 << cz;
            const width = (this.rootBounds.maxX - this.rootBounds.minX) / numTiles;
            const height = (this.rootBounds.maxY - this.rootBounds.minY) / numTiles;

            const startX = Math.max(0, Math.floor((worldFrustum.minX - this.rootBounds.minX) / width));
            const endX = Math.min(numTiles - 1, Math.floor((worldFrustum.maxX - this.rootBounds.minX) / width));
            const startY = Math.max(0, Math.floor((this.rootBounds.maxY - worldFrustum.maxY) / height));
            const endY = Math.min(numTiles - 1, Math.floor((this.rootBounds.maxY - worldFrustum.minY) / height));

            const countX = endX - startX + 1;
            const countY = endY - startY + 1;
            const tilesInLOD = countX * countY;
            
            // Budget limits: Don't overflow the LRU cache.
            if (plannedTiles + tilesInLOD > this.maxCacheSize - 10) {
                break;
            }
            plannedTiles += tilesInLOD;
            this.currentMaxZ = cz;

            for (let x = startX; x <= endX; x++) {
                for (let y = startY; y <= endY; y++) {
                    const key = `${cz}/${x}/${y}`;
                    this.currentlyVisibleIds.add(key);
                    this.lastSeenTimestamp.set(key, performance.now());
                    
                    if (!this.activeTiles.has(key) && !this.loadingTiles.has(key)) {
                        this.loadingTiles.add(key);
                        // Priority based on distance to camera center! (LOD priority)
                        const centerX = (startX + endX) / 2.0;
                        const centerY = (startY + endY) / 2.0;
                        const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
                        const priority = 1000 - (cz * 100) - dist; // Lower Z and closer to center loads first
                        this.queue.add(() => this.loadTile(cz, x, y, key), { priority }).catch(() => {});
                    }
                }
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
                    const MAX_POOL_SIZE = 50;
                    if (this.bufferPool.x.length < MAX_POOL_SIZE) {
                        if (evictedTile.xBuffer) this.bufferPool.x.push(evictedTile.xBuffer);
                        if (evictedTile.yBuffer) this.bufferPool.y.push(evictedTile.yBuffer);
                        if (evictedTile.colorBuffer) this.bufferPool.color.push(evictedTile.colorBuffer);
                        if (evictedTile.sizeBuffer) this.bufferPool.size.push(evictedTile.sizeBuffer);
                        if (evictedTile.ixBuffer) this.bufferPool.ix.push(evictedTile.ixBuffer);
                        if (evictedTile.parallaxBuffer) this.bufferPool.parallax.push(evictedTile.parallaxBuffer);
                        if (evictedTile.teffBuffer) this.bufferPool.teff.push(evictedTile.teffBuffer);
                        if (evictedTile.pmraBuffer) this.bufferPool.pmra.push(evictedTile.pmraBuffer);
                        if (evictedTile.pmdecBuffer) this.bufferPool.pmdec.push(evictedTile.pmdecBuffer);
                        if (evictedTile.rvBuffer) this.bufferPool.rv.push(evictedTile.rvBuffer);
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
            const onAbort = () => {
                this.resolvers.delete(key);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort);

            this.resolvers.set(key, { resolve, reject, t0, tNetEnd, signal, onAbort });
            
            const copies = dataArray.map(d => d ? d.slice() : null);
            const pooledX = this.bufferPool.x.pop();
            const pooledY = this.bufferPool.y.pop();
            const pooledColor = this.bufferPool.color.pop();
            const pooledSize = this.bufferPool.size.pop();
            const pooledIx = this.bufferPool.ix.pop();
            const pooledParallax = this.bufferPool.parallax.pop();
            const pooledTeff = this.bufferPool.teff.pop();
            const pooledPmra = this.bufferPool.pmra.pop();
            const pooledPmdec = this.bufferPool.pmdec.pop();
            const pooledRv = this.bufferPool.rv.pop();
            
            const transferables = copies.filter(c => c !== null).map(c => c!.buffer);
            if (pooledX) transferables.push(pooledX);
            if (pooledY) transferables.push(pooledY);
            if (pooledColor) transferables.push(pooledColor);
            if (pooledSize) transferables.push(pooledSize);
            if (pooledIx) transferables.push(pooledIx);
            if (pooledParallax) transferables.push(pooledParallax);
            if (pooledTeff) transferables.push(pooledTeff);
            if (pooledPmra) transferables.push(pooledPmra);
            if (pooledPmdec) transferables.push(pooledPmdec);
            if (pooledRv) transferables.push(pooledRv);

            const w = this.workers[this.workerIndex++ % this.workers.length];
            w.postMessage({ 
                action: 'decode', 
                key, 
                buffers: copies,
                pooledX,
                pooledY,
                pooledColor,
                pooledSize,
                pooledIx,
                pooledParallax,
                pooledTeff,
                pooledPmra,
                pooledPmdec,
                pooledRv
            }, { transfer: transferables } as any);
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
            const promises = [this.corePmtiles.getZxy(z, x, y, abortController.signal)];
            for (const layer of this.layerPmtiles) {
                promises.push(layer.getZxy(z, x, y, abortController.signal));
            }
            const tiles = await Promise.all(promises);
            const tNetEnd = performance.now();
            
            if (tiles[0]) {
                const payloads = tiles.map(t => t ? new Uint8Array(t.data) : null);
                
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
