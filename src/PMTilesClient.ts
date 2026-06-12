import { PMTiles } from 'pmtiles';
import { tableFromIPC, tableToIPC, Table } from 'apache-arrow';

export interface BoundingBox {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

export interface TileData {
    key: string; // "z/x/y"
    xBuffer: Float64Array;
    yBuffer: Float64Array;
    colorBuffer: Float32Array;  // bp_rp
    sizeBuffer: Float32Array;   // abs_m
    ixBuffer?: Float32Array;
    numRows: number;
    needsUpdate?: boolean;
    hoverBuffer?: Int32Array;
}

export class PMTilesClient {
    private pmtiles: PMTiles;
    private rootBounds: BoundingBox;
    private activeTiles = new Map<string, TileData>();
    public onTileLoaded: ((tile: TileData) => void) | null = null;
    public onTileUnloaded: ((tileId: string) => void) | null = null;
    private loadingTiles = new Set<string>();
    private schemaBytes: Uint8Array | null = null;

    constructor(url: string, rootBounds: BoundingBox) {
        this.pmtiles = new PMTiles(url);
        this.rootBounds = rootBounds;
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

    public getVisibleTiles(frustum: BoundingBox, z: number): TileData[] {
        const visibleIds = new Set<string>();
        
        // We must load ALL tiles from z=0 down to the requested zoom level, 
        // because points are mutually exclusive across zoom levels in ArrowTiles!
        for (let currentZ = 0; currentZ <= z; currentZ++) {
            const tilesX = Math.pow(2, currentZ);
            const width = (this.rootBounds.maxX - this.rootBounds.minX) / tilesX;
            const height = (this.rootBounds.maxY - this.rootBounds.minY) / tilesX;

            const startX = Math.max(0, Math.floor((frustum.minX - this.rootBounds.minX) / width));
            const endX = Math.min(tilesX - 1, Math.floor((frustum.maxX - this.rootBounds.minX) / width));
            const startY = Math.max(0, Math.floor((frustum.minY - this.rootBounds.minY) / height));
            const endY = Math.min(tilesX - 1, Math.floor((frustum.maxY - this.rootBounds.minY) / height));

            for (let x = startX; x <= endX; x++) {
                for (let y = startY; y <= endY; y++) {
                    const key = `${currentZ}/${x}/${y}`;
                    visibleIds.add(key);
                    if (!this.activeTiles.has(key) && !this.loadingTiles.has(key)) {
                        this.loadTile(currentZ, x, y, key);
                    }
                }
            }
        }

        // Evict unseen tiles
        for (const [key, tile] of this.activeTiles.entries()) {
            if (!visibleIds.has(key)) {
                this.activeTiles.delete(key);
                if (this.onTileUnloaded) this.onTileUnloaded(key);
            }
        }

        return Array.from(this.activeTiles.values());
    }

    private async loadTile(z: number, x: number, y: number, key: string) {
        this.loadingTiles.add(key);
        try {
            // pmtiles library expects z, x, y
            const tile = await this.pmtiles.getZxy(z, x, y);
            if (tile) {
                // Fetch metadata once if not already fetched
                if (!this.schemaBytes) {
                    const metadata = await this.pmtiles.getMetadata();
                    if (metadata && metadata.schema_base64) {
                        const binaryString = atob(metadata.schema_base64);
                        const fileBytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            fileBytes[i] = binaryString.charCodeAt(i);
                        }
                        const schemaTable = tableFromIPC(fileBytes);
                        this.schemaBytes = tableToIPC(schemaTable, "stream");
                    } else {
                        console.error("No schema_base64 found in PMTiles metadata!");
                        return;
                    }
                }

                // Prepend stream schema bytes to the raw IPC message buffer
                const rawData = new Uint8Array(tile.data);
                const fullBuffer = new Uint8Array(this.schemaBytes.length + rawData.length + 4);
                fullBuffer.set(this.schemaBytes, 0);
                fullBuffer.set(rawData, this.schemaBytes.length);

                const table = tableFromIPC(fullBuffer);
                
                const xNorm = table.getChild("x_norm")?.toArray() as Float64Array;
                const yNorm = table.getChild("y_norm")?.toArray() as Float64Array;
                const color = table.getChild("bp_rp")?.toArray() as Float32Array;
                const size = table.getChild("abs_m")?.toArray() as Float32Array;
                const ix = table.getChild("ix")?.toArray() as Float32Array;

                if (xNorm && yNorm) {
                    const tileData: TileData = {
                        key,
                        xBuffer: xNorm,
                        yBuffer: yNorm,
                        colorBuffer: color || new Float32Array(xNorm.length).fill(1.0),
                        sizeBuffer: size || new Float32Array(xNorm.length).fill(1.0),
                        ixBuffer: ix,
                        numRows: xNorm.length
                    };
                    this.activeTiles.set(key, tileData);
                    if (this.onTileLoaded) this.onTileLoaded(tileData);
                }
            }
        } catch (e) {
            console.error(`Failed to load tile ${key}`, e);
        } finally {
            this.loadingTiles.delete(key);
        }
    }
}
