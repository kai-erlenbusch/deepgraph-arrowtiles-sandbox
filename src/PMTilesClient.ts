import { PMTiles, Compression } from 'pmtiles';
import { decompress as zstdDecompress } from 'fzstd';

async function customDecompress(buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
    if (compression === Compression.None || compression === 1) return buf;
    if (compression === Compression.Gzip || compression === 2) {
        const ds = new DecompressionStream('gzip');
        const response = new Response(buf);
        const decompressedStream = response.body!.pipeThrough(ds);
        return await new Response(decompressedStream).arrayBuffer();
    }
    if (compression === 4) { // Zstd is 4
        return zstdDecompress(new Uint8Array(buf)).buffer;
    }
    throw new Error(`Unsupported compression: ${compression}`);
}
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
    xyBuffer: Uint16Array;
    colorBuffer: Float32Array;  // bp_rp
    hoverBuffer?: Int32Array;
    sizeBuffer: Float32Array;   // abs_m
    ixBuffer?: Float32Array;
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
    private schemaBytes: Uint8Array | null = null;
    private queue = new PQueue({ concurrency: 6 });
    private worker = new ArrowWorker();
    private abortControllers = new Map<string, AbortController>();
    private resolvers = new Map<string, {resolve: Function, reject: Function, t0: number, tNetEnd: number}>();

    constructor(url: string, rootBounds: BoundingBox, maxCacheSize: number = 400) {
        this.pmtiles = new PMTiles(url, undefined, customDecompress);
        this.rootBounds = rootBounds;
        this.maxCacheSize = maxCacheSize;
        
        this.worker.onmessage = (e) => {
            const data = e.data;
            const req = this.resolvers.get(data.key);
            if (req) {
                this.resolvers.delete(data.key);
                if (data.error) {
                    req.reject(new Error(data.error));
                } else {
                    const tileData: TileData = {
                        key: data.key,
                        xyBuffer: data.xyBuffer ? new Uint16Array(data.xyBuffer) : null as any,
                        colorBuffer: data.colorBuffer ? new Float32Array(data.colorBuffer) : null as any,
                        sizeBuffer: data.sizeBuffer,
                        ixBuffer: data.ixBuffer,
                        numRows: data.numRows
                    };
                    req.resolve(tileData);
                    
                    const tWorkerEnd = performance.now();
                    const w = window as any;
                    w.fetchTelemetry = w.fetchTelemetry || { net: [], worker: [] };
                    w.fetchTelemetry.net.push(req.tNetEnd - req.t0);
                    w.fetchTelemetry.worker.push(tWorkerEnd - req.tNetEnd);
                    if (w.fetchTelemetry.net.length > 50) {
                        w.fetchTelemetry.net.shift();
                        w.fetchTelemetry.worker.shift();
                    }
                }
            }
        };
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
            
            if (plannedTiles + tilesInLOD > this.maxCacheSize - 10) {
                break;
            }
            plannedTiles += tilesInLOD;

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
                        this.queue.add(() => this.loadTile(cz, x, y, key), { priority });
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

    private parseArrowInWorker(key: string, data: Uint8Array, t0: number, tNetEnd: number): Promise<TileData> {
        return new Promise((resolve, reject) => {
            this.resolvers.set(key, { resolve, reject, t0, tNetEnd });
            // Copy the data so we can safely Transfer it without breaking PMTiles' internal block cache if it's sharing an ArrayBuffer
            // data.slice() invokes V8's native C++ memory copy instead of iterating byte-by-byte on the JS thread
            const copy = data.slice();
            this.worker.postMessage({ key, buffer: copy.buffer }, [copy.buffer]);
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
            const tile = await this.pmtiles.getZxy(z, x, y, abortController.signal);
            const tNetEnd = performance.now();
            if (tile) {
                const tileData = await this.parseArrowInWorker(key, new Uint8Array(tile.data), t0, tNetEnd);
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
