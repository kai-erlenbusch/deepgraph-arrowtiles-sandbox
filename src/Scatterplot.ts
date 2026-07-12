import * as THREE from 'three';
import { writeToDeviceQueue } from './WebGPUAdapter';
import { MeshBasicNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
// @ts-ignore - TSL types are highly experimental and incomplete
import { 
  attribute, float, positionLocal, vec3, vec4, vec2, uv, distance, smoothstep,
  hash, instanceIndex, max, select, uint, mix, clamp, log2, uniform, varying, instancedArray, storage, cameraProjectionMatrix, cameraViewMatrix, atomicAdd, time, userData, sqrt, sin, cos
} from 'three/tsl';
import { Renderer } from './core/Renderer.ts';
import { PMTilesClient, type TileData } from './PMTilesClient.ts';

export interface EncodingConfig {
    x?: { field: string, transform?: 'literal' | 'linear', domain?: [number, number], range?: [number, number] };
    y?: { field: string, transform?: 'literal' | 'linear', domain?: [number, number], range?: [number, number] };
    color?: { field: string, range: 'rdbu' | 'viridis', domain?: [number, number] };
    size?: { field: string, domain?: [number, number], range?: [number, number] };
    jitter?: { method: 'circle' | 'spiral', speed: number, radius: number };
}


export class Scatterplot {
  public scene: THREE.Scene;
  
  public maxTiles = 200;
  public rowsPerTile = 262144;
  public maxGlobalRows = this.maxTiles * this.rowsPerTile;
  
  public slotMeshes: THREE.Mesh[] = [];
  public slotToTileKey: string[] = new Array(this.maxTiles).fill('');
  public currentConfig: EncodingConfig = {
      x: { field: 'x_u16', transform: 'linear', domain: [0, 1], range: [-2, 2] },
      y: { field: 'y_u16', transform: 'linear', domain: [0, 1], range: [1, -1] },
      color: { field: 'bp_rp', range: 'viridis', domain: [-0.5, 2.5] },
      size: { field: 'abs_m' }
  };
  public previousConfig: EncodingConfig = this.currentConfig;
  public transitionTUniform = uniform(1.0);
  public isTransitioning = false;
  public modeUniform = uniform(0.0);

  public slotToTileData: (TileData | null)[] = new Array(this.maxTiles).fill(null);
  public tileKeyToSlot: Map<string, number> = new Map();
  
  private quadGeometry = new THREE.PlaneGeometry(1, 1);

  public layerSpacingUniform = uniform(0.0);
  public maxMagUniform = uniform(15.0);
  public maxIxUniform = uniform(100000000.0); // Kept for API compatibility if needed
  public currentZoomUniform = uniform(0.0);
  public globalTimeUniform = uniform(0.0);
  public vpMatrixUniform = uniform(new THREE.Matrix4());
  public modeUniform = uniform(0.0); // 0.0 = Gaia Baseline, 1.0 = Chart Mode
  private rootArea: number;
  private rendererWrapper: Renderer;

  public getActiveColumns(config: EncodingConfig): string[] {
      const cols = new Set<string>();
      if (config.x?.field) cols.add(config.x.field);
      if (config.y?.field) cols.add(config.y.field);
      if (config.color?.field) cols.add(config.color.field);
      if (config.size?.field) cols.add(config.size.field);
      
      // Always ensure Gaia baseline fields exist if requested
      cols.add('bp_rp');
      cols.add('abs_m');
      
      cols.add('x_u16');
      cols.add('y_u16');
      return Array.from(cols);
  }

  constructor(scene: THREE.Scene, rendererWrapper: Renderer, rootBounds: BoundingBox) {
    this.scene = scene;
    this.rendererWrapper = rendererWrapper;
    this.rootArea = (rootBounds.maxX - rootBounds.minX) * (rootBounds.maxY - rootBounds.minY);

    const mainMaterial = this.createMainMaterial();
    const initialCols = this.getActiveColumns(this.currentConfig);

    for (let i = 0; i < this.maxTiles; i++) {
        this.slotMeshes.push(null as any);
    }
  }

  public setRootBounds(bounds: BoundingBox) {
      this.rootArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
  }

  public updateEncoding(config: EncodingConfig) {
      this.previousConfig = { ...this.currentConfig };
      this.currentConfig = { ...this.currentConfig, ...config };
      
      const newCols = this.getActiveColumns(this.currentConfig);
      
      for (let i = 0; i < this.maxTiles; i++) {
          if (!this.slotMeshes[i]) continue;
          const geo = this.slotMeshes[i].geometry as THREE.InstancedBufferGeometry;
          for (const col of newCols) {
              if (!geo.attributes[col]) {
                  geo.setAttribute(col, new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile).fill(0.0), 1));
              }
          }
      }
      
      const newMaterial = this.createMainMaterial(this.previousConfig, this.currentConfig);
      for (let i = 0; i < this.maxTiles; i++) {
          if (this.slotMeshes[i]) {
              this.slotMeshes[i].material = newMaterial;
          }
      }
      
      this.startTransition();
      return newCols;
  }

  private startTransition() {
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      
      const startTime = performance.now();
      const duration = 2000; // 2 seconds
      
      const animate = () => {
          const now = performance.now();
          let progress = (now - startTime) / duration;
          if (progress > 1.0) progress = 1.0;
          
          // Smoothstep easing for a cinematic transition
          const t = progress * progress * (3 - 2 * progress);
          this.transitionTUniform.value = t;
          
          for (let i = 0; i < this.maxTiles; i++) {
              const mesh = this.slotMeshes[i];
              if (!mesh) continue;
              const prevX = this.mapValJS(mesh.userData.tileOffsetX, this.previousConfig.x);
              const prevY = this.mapValJS(mesh.userData.tileOffsetY, this.previousConfig.y);
              const currX = this.mapValJS(mesh.userData.tileOffsetX, this.currentConfig.x);
              const currY = this.mapValJS(mesh.userData.tileOffsetY, this.currentConfig.y);
              
              mesh.position.x = prevX + (currX - prevX) * t;
              mesh.position.y = prevY + (currY - prevY) * t;
          }
          
          if (progress < 1.0) {
              requestAnimationFrame(animate);
          } else {
              this.isTransitioning = false;
          }
      };
      
      requestAnimationFrame(animate);
  }

  private getScaleFactor(domain: [number, number] | undefined, range: [number, number] | undefined) {
      if (!domain || !range) return float(1.0);
      return float(range[1] - range[0]).div(float(domain[1] - domain[0]));
  }

  private mapVal(val: any, domain: [number, number] | undefined, range: [number, number] | undefined) {
      if (!domain || !range) return val;
      const t = val.sub(float(domain[0])).div(float(domain[1] - domain[0]));
      return mix(float(range[0]), float(range[1]), clamp(t, 0.0, 1.0));
  }

  private mapValJS(val: number, cfgAxis: any): number {
      if (!cfgAxis || (cfgAxis.field !== 'x_u16' && cfgAxis.field !== 'y_u16' && cfgAxis.transform !== 'literal')) {
          return 0.0; 
      }
      const domain = cfgAxis.domain || [0, 1];
      const range = cfgAxis.range || [0, 1];
      const t = (val - domain[0]) / (domain[1] - domain[0]);
      return range[0] + (range[1] - range[0]) * Math.max(0, Math.min(1, t));
  }

  private getMappedPos(cfg: EncodingConfig, offsetX: any, offsetY: any, tileScale: any, getField: (f: string) => any) {
      const isXSpatial = cfg.x?.field === 'x_u16' || cfg.x?.transform === 'literal';
      const isYSpatial = cfg.y?.field === 'y_u16' || cfg.y?.transform === 'literal';
      
      let finalX, finalY;
      
      if (isXSpatial) {
          finalX = offsetX.mul(tileScale).mul(this.getScaleFactor(cfg.x?.domain, cfg.x?.range));
      } else {
          const xField = cfg.x?.field ? getField(cfg.x.field) : float(0.0);
          finalX = this.mapVal(xField, cfg.x?.domain, cfg.x?.range);
      }
      
      if (isYSpatial) {
          finalY = offsetY.mul(tileScale).mul(this.getScaleFactor(cfg.y?.domain, cfg.y?.range));
      } else {
          const yField = cfg.y?.field ? getField(cfg.y.field) : float(0.0);
          finalY = this.mapVal(yField, cfg.y?.domain, cfg.y?.range);
      }
      
      if (cfg.jitter) {
          const jRad = float(cfg.jitter.radius);
          const jSpeed = float(cfg.jitter.speed);
          const phase = hash(instanceIndex).mul(float(Math.PI * 2.0));
          const tOffset = this.globalTimeUniform.mul(jSpeed).add(phase);
          finalX = finalX.add(sin(tOffset).mul(jRad));
          finalY = finalY.add(cos(tOffset).mul(jRad));
      }
      return { x: finalX, y: finalY };
  }

  private buildColorNode(currConfig: EncodingConfig, getField: (f: string) => any, isGaiaMode: any) {
      const colorField = currConfig.color?.field ? getField(currConfig.color.field) : float(0.0);
      const isColorNaN = colorField.equal(colorField).not();
      const safeColor = select(isColorNaN, float(0.0), colorField);

      let baseChartColor = vec3(1.0, 1.0, 1.0);
      if (currConfig.color?.range === 'rdbu') {
          const cBlue = vec3(0x11/255.0, 0x22/255.0, 0xaa/255.0);
          const cLtBlue = vec3(0x55/255.0, 0xaa/255.0, 0xdd/255.0);
          const cWhite = vec3(1.0, 1.0, 1.0);
          const cOrange = vec3(0xff/255.0, 0x99/255.0, 0x00/255.0);
          const cRed = vec3(0xcc/255.0, 0x22/255.0, 0x00/255.0);
          
          let cDomain = currConfig.color?.domain || [-5.0, 5.0];
          const t = clamp(safeColor.sub(float(cDomain[0])).div(float(cDomain[1] - cDomain[0])), 0.0, 1.0);
          const mix1 = smoothstep(0.0, 0.25, t);
          const mix2 = smoothstep(0.25, 0.5, t);
          const mix3 = smoothstep(0.5, 0.75, t);
          const mix4 = smoothstep(0.75, 1.0, t);
          let color = mix(cBlue, cLtBlue, mix1);
          color = mix(color, cWhite, mix2);
          color = mix(color, cOrange, mix3);
          baseChartColor = mix(color, cRed, mix4);
      } else if (currConfig.color?.range === 'viridis') {
          const c1 = vec3(0.26, 0.00, 0.32);
          const c2 = vec3(0.19, 0.40, 0.55);
          const c3 = vec3(0.12, 0.63, 0.53);
          const c4 = vec3(0.99, 0.90, 0.14);
          let cDomain = currConfig.color?.domain || [0.0, 100.0];
          const t = clamp(safeColor.sub(float(cDomain[0])).div(float(cDomain[1] - cDomain[0])), 0.0, 1.0);
          const mix1 = smoothstep(0.0, 0.33, t);
          const mix2 = smoothstep(0.33, 0.66, t);
          const mix3 = smoothstep(0.66, 1.0, t);
          let color = mix(c1, c2, mix1);
          color = mix(color, c3, mix2);
          baseChartColor = mix(color, c4, mix3);
      }
      
      const mix1G = smoothstep(-5.0, -2.5, safeColor);
      const mix2G = smoothstep(-2.5, 0.0, safeColor);
      const mix3G = smoothstep(0.0, 2.5, safeColor);
      const mix4G = smoothstep(2.5, 5.0, safeColor);
      let colorG = mix(vec3(0x11/255.0, 0x22/255.0, 0xaa/255.0), vec3(0x55/255.0, 0xaa/255.0, 0xdd/255.0), mix1G);
      colorG = mix(colorG, vec3(1.0, 1.0, 1.0), mix2G);
      colorG = mix(colorG, vec3(0xff/255.0, 0x99/255.0, 0x00/255.0), mix3G);
      const baseGaiaColor = mix(colorG, vec3(0xcc/255.0, 0x22/255.0, 0x00/255.0), mix4G);
      
      return select(isGaiaMode, baseGaiaColor, baseChartColor);
  }

  private createMainMaterial(prevConfig: EncodingConfig = this.currentConfig, currConfig: EncodingConfig = this.currentConfig) {
    const offsetX = attribute('x_u16', 'float');
    const offsetY = attribute('y_u16', 'float');
    const spawnTime = float(attribute('spawnTime', 'float'));

    const tileOffsetX = float(userData('tileOffsetX', 'float'));
    const tileOffsetY = float(userData('tileOffsetY', 'float'));
    const tileScale = float(userData('tileScale', 'float'));
    
    // Reconstruct global [0..1] coordinates
    const globalX = tileOffsetX.add(offsetX.mul(tileScale));
    const globalY = tileOffsetY.add(offsetY.mul(tileScale));

    const getField = (field: string) => {
        if (field === 'x_u16') return globalX;
        if (field === 'y_u16') return globalY;
        return float(attribute(field, 'float'));
    };

    const prevPos = this.getMappedPos(prevConfig, offsetX, offsetY, tileScale, getField);
    const currPos = this.getMappedPos(currConfig, offsetX, offsetY, tileScale, getField);
    
    const finalX = mix(prevPos.x, currPos.x, this.transitionTUniform);
    const finalY = mix(prevPos.y, currPos.y, this.transitionTUniform);

    const offset3D = vec3(finalX, finalY, float(0.0));

    // Determine Size
    const sizeField = currConfig.size?.field ? getField(currConfig.size.field) : float(1.0);
    const isSizeNaN = sizeField.equal(sizeField).not();
    const safeSizeField = select(isSizeNaN, float(0.0), sizeField);
    
    const mappedSize = this.mapVal(safeSizeField, currConfig.size?.domain, currConfig.size?.range || [1.0, 1.0]);
    
    const zoomT = this.rendererWrapper.zoomTUniform;
    const targetPixels = mix(float(1.0), float(2.0), zoomT);

    // Scale and cap the base size 
    const isTokens = safeSizeField.greaterThan(30.0);
    const tokenSize = max(float(0.5), log2(max(safeSizeField, float(1.0))));
    const gaiaSize = max(float(0.05), float(21.0).sub(safeSizeField).div(float(10.0)));
    const computedSizeGaia = select(isTokens, tokenSize, gaiaSize);
    
    const instanceSizeGaia = mix(float(1.2), float(3.0), zoomT).mul(computedSizeGaia);
    
    const isVisibleGaia = sizeField.greaterThan(0.0)
                      .and(isTokens.or(safeSizeField.lessThanEqual(this.maxMagUniform)));
    const safeSizeGaia = select(isVisibleGaia, targetPixels.mul(this.rendererWrapper.worldUnitsPerPixelUniform).mul(instanceSizeGaia), float(0.0));
    
    const isGaiaMode = this.modeUniform.lessThan(0.5);
    const safeSize = select(isGaiaMode, safeSizeGaia, targetPixels.mul(this.rendererWrapper.worldUnitsPerPixelUniform).mul(mappedSize));

    const finalBaseColor = this.buildColorNode(currConfig, getField, isGaiaMode);
    
    // Opacity
    const opacityRamp = sqrt(zoomT); 
    const dynamicOpacityChart = mix(float(0.10), float(0.50), opacityRamp); // Scales naturally with zoom (Brighter for generic datasets)
    
    const baseOpacityGaia = mix(float(0.03), float(0.10), opacityRamp);
    const magFade = clamp(this.maxMagUniform.sub(safeSizeField), float(0.0), float(1.0));
    const finalBaseOpacityGaia = select(isTokens, baseOpacityGaia, baseOpacityGaia.mul(magFade));
    const dynamicOpacityGaia = clamp(finalBaseOpacityGaia, float(1.0 / 255.0), float(1.0));
    
    const dynamicOpacity = select(isGaiaMode, dynamicOpacityGaia, dynamicOpacityChart);
    
    const distanceToCenter = distance(uv(), vec2(0.5));
    const alphaEdge = float(1.0).sub(smoothstep(float(0.0), float(0.5), distanceToCenter));
    
    const threshold = float(1.0 / 255.0);
    const finalAlpha = alphaEdge.mul(dynamicOpacity);

    const isSubPixelOpacity = finalAlpha.lessThan(threshold);
    const randomVal = varying(hash(instanceIndex).mul(float(255.0)));
    const probDiscard = randomVal.greaterThan(finalAlpha.mul(float(255.0)));
    
    // Opacity Fade-in
    const age = this.globalTimeUniform.sub(spawnTime);
    const fadeAlpha = smoothstep(0.0, 0.3, age);
    
    const shouldDiscard = distanceToCenter.greaterThan(0.5).or(isSubPixelOpacity.and(probDiscard));
    const safeAlpha = select(shouldDiscard, float(0.0), max(finalAlpha, threshold).mul(fadeAlpha));

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      alphaTest: 0.001,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      side: THREE.DoubleSide
    });

    const isVisible = select(isGaiaMode, isVisibleGaia, float(1.0));
    mat.colorNode = finalBaseColor.mul(safeAlpha);
    mat.opacityNode = safeAlpha;
    mat.positionNode = select(isVisible, offset3D.add(positionLocal.mul(safeSize)), vec3(1000000.0));
    return mat;
  }


  public calculateMaxIx(camera: THREE.OrthographicCamera): number {
    const visibleWidth = (camera.right - camera.left) / camera.zoom;
    const visibleHeight = (camera.top - camera.bottom) / camera.zoom;
    const visibleArea = visibleWidth * visibleHeight;
    const safeRootArea = this.rootArea > 0 ? this.rootArea : 1;
    const areaRatio = safeRootArea / visibleArea;
    return 3000000 * areaRatio;
  }

  private vp = new THREE.Matrix4();

  public updateCamera(camera: THREE.Camera) {
    this.globalTimeUniform.value = performance.now() / 1000.0;
    this.vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.vpMatrixUniform.value.copy(this.vp);
    
    const currentZoom = Math.log2(Math.max(0.1, (camera as any).zoom || 1.0));
    this.currentZoomUniform.value = currentZoom;
    
    // Map zoom level to a global magnitude cutoff!
    if (!this.maxMagUniform) {
        console.error("maxMagUniform is undefined!");
    } else {
        let magOffset = 0;
        if (currentZoom <= 2.0) {
            magOffset = 0; // Z=2 and Z=3 stay perfectly clamped at 14.0 for smooth panning
        } else if (currentZoom <= 3.0) {
            // Z=4 (currentZoom 2.0 -> 3.0)
            // Ramp slowly to 15.5 to decrease Z=4 density
            magOffset = (currentZoom - 2.0) * 1.5; 
        } else if (currentZoom <= 4.0) {
            // Z=5 (currentZoom 3.0 -> 4.0)
            // Spike very hard right at the start of Z=5 so M33 erupts into view early.
            // Using an easeOut curve, it rapidly hits Mag 18+ within the first 25% of Z=5.
            const t = currentZoom - 3.0;
            magOffset = 1.5 + (t * (2.0 - t)) * 5.5; 
        } else {
            // Z=6+ (currentZoom 4.0+)
            // Fully saturated to Mag 21.0
            magOffset = 7.0;
        }
        
        this.maxMagUniform.value = Math.min(21.0, 14.0 + magOffset);
    }
  }

    private getFreeSlot(): number {
      for (let i = 0; i < this.maxTiles; i++) {
          if (this.slotToTileKey[i] === '') return i;
      }
      return -1;
    }

    private globalZeroBuffer: ArrayBuffer = new Float32Array(this.rowsPerTile).buffer;

    public unloadTile(key: string) {
        const slot = this.tileKeyToSlot.get(key);
        if (slot !== undefined) {
            this.slotToTileKey[slot] = '';
            this.slotToTileData[slot] = null;
            this.tileKeyToSlot.delete(key);
            this.slotMeshes[slot].visible = false;
        }
    }

    public updateTiles(tiles: TileData[]): boolean {
        const currentKeys = new Set(tiles.map(t => t.key));
        
        // PCIe Throttling: Use a time-based budget (e.g., 8ms) to prevent frame stuttering during rapid panning
        const frameStart = performance.now();
        let hasPendingUpdates = false;

        // 1. Identify tiles that are currently on GPU but no longer active
        for (const [key, slot] of this.tileKeyToSlot.entries()) {
            if (!currentKeys.has(key)) {
                this.unloadTile(key);
            }
        }
        
        // Ensure only currently visible tiles are drawn! (Zero-Cost Culling)
        for (let i = 0; i < this.maxTiles; i++) {
            if (this.slotMeshes[i]) this.slotMeshes[i].visible = false;
        }

    // 2. Process added/updated tiles
    for (const tile of tiles) {
      if (!this.tileKeyToSlot.has(tile.key)) {
        const slot = this.getFreeSlot();
        if (slot === -1) continue; // Out of slots (exceeds maxTiles)
        
        this.tileKeyToSlot.set(tile.key, slot);
        this.slotToTileKey[slot] = tile.key;
        this.slotToTileData[slot] = tile;
        tile.needsUpdate = true;
        
        if (!this.slotMeshes[slot]) {
            const geo = new THREE.InstancedBufferGeometry();
            geo.index = this.quadGeometry.index;
            geo.attributes.position = this.quadGeometry.attributes.position;
            geo.attributes.uv = this.quadGeometry.attributes.uv;
            
            geo.setAttribute('spawnTime', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile).fill(-1000.0), 1));
            
            const activeCols = this.getActiveColumns(this.currentConfig);
            for (const col of activeCols) {
                 geo.setAttribute(col, new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile).fill(0.0), 1));
            }
            
            geo.instanceCount = 0;

            const mesh = new THREE.Mesh(geo, this.createMainMaterial());
            mesh.frustumCulled = false;
            mesh.visible = false;
            mesh.userData.slotIndex = slot;
            mesh.userData.tileOffsetX = 0.0;
            mesh.userData.tileOffsetY = 0.0;
            mesh.userData.tileScale = 1.0;

            this.slotMeshes[slot] = mesh;
            this.scene.add(mesh);
        } else {
            const geo = this.slotMeshes[slot].geometry as THREE.InstancedBufferGeometry;
            geo.instanceCount = 0;
        }
      }
      
      const slot = this.tileKeyToSlot.get(tile.key)!;
      const geo = this.slotMeshes[slot].geometry as THREE.InstancedBufferGeometry;

      if (tile.needsUpdate) {
        if (performance.now() - frameStart > 8.0) {
             this.slotMeshes[slot].visible = geo.instanceCount > 0;
             hasPendingUpdates = true;
             continue;
        }
        
        const [zStr, txStr, tyStr] = tile.key.split('/');
        const scale = 1.0 / Math.pow(2, parseInt(zStr));
        const tileOffsetX = parseInt(txStr) * scale;
        const tileOffsetY = parseInt(tyStr) * scale;
        
        this.slotMeshes[slot].userData.tileOffsetX = tileOffsetX;
        this.slotMeshes[slot].userData.tileOffsetY = tileOffsetY;
        this.slotMeshes[slot].userData.tileScale = scale;
        
        // RTE Precision Jitter Fix: Apply absolute base offset to mesh position (f64)
        if (!this.isTransitioning) {
            this.slotMeshes[slot].position.x = this.mapValJS(tileOffsetX, this.currentConfig.x);
            this.slotMeshes[slot].position.y = this.mapValJS(tileOffsetY, this.currentConfig.y);
            this.slotMeshes[slot].position.z = 0;
            this.slotMeshes[slot].updateMatrixWorld();
        }
        
        const numItems = Math.min(tile.numRows, this.rowsPerTile);
        console.log(`Tile ${tile.key} | numRows: ${tile.numRows} | numItems: ${numItems}`);
        geo.instanceCount = numItems;
        
        const writeToGPU = (attrName: string, buffer: ArrayBuffer | undefined) => {
            if (!buffer) return;
            const attr = geo.getAttribute(attrName) as THREE.InstancedBufferAttribute;
            if (!attr) return; // Prevent crashes if attribute isn't allocated yet
            
            const success = writeToDeviceQueue(this.rendererWrapper.renderer, attr, buffer);
            
            if (!success) {
                // Slow Path Fallback: Used only on the very first frame before Three.js allocates the GPU buffer
                // new Float32Array(buffer) creates a zero-copy view, so this minimizes garbage collection overhead
                (attr.array as Float32Array).set(new Float32Array(buffer, 0, numItems));
                attr.needsUpdate = true;
                attr.clearUpdateRanges();
                attr.addUpdateRange(0, numItems);
            }
        };

        if (tile.columns) {
            for (const colName of Object.keys(tile.columns)) {
                writeToGPU(colName, tile.columns[colName]);
            }
            const currentTime = performance.now() / 1000.0;
            const spawnTimeArray = new Float32Array(numItems).fill(currentTime);
            writeToGPU('spawnTime', spawnTimeArray.buffer);
        }
        tile.needsUpdate = false;
      }
      
      this.slotMeshes[slot].visible = geo.instanceCount > 0;
    }
    
    return hasPendingUpdates;
  }

}
