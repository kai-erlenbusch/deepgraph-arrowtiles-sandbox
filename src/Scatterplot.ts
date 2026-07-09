// @ts-nocheck
import * as THREE from 'three';
import { MeshBasicNodeMaterial, StorageInstancedBufferAttribute } from 'three/webgpu';
// @ts-ignore - TSL types are highly experimental and incomplete
import { 
  attribute, float, positionLocal, vec3, vec4, vec2, uv, distance, smoothstep,
  hash, instanceIndex, max, select, uint, mix, clamp, log2, uniform, varying, instancedArray, storage, cameraProjectionMatrix, cameraViewMatrix, atomicAdd, time, userData, sqrt, sin, cos
} from 'three/tsl';
import { Renderer } from './core/Renderer';
import type { BoundingBox, TileData } from './PMTilesClient';

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
  private rootArea: number;
  private rendererWrapper: Renderer;

  constructor(scene: THREE.Scene, rendererWrapper: Renderer, rootBounds: BoundingBox) {
    this.scene = scene;
    this.rendererWrapper = rendererWrapper;
    this.rootArea = (rootBounds.maxX - rootBounds.minX) * (rootBounds.maxY - rootBounds.minY);

    // 1. Pre-allocate 800 discrete meshes, perfectly chunking the geometry
    const mainMaterial = this.createMainMaterial();

    for (let i = 0; i < this.maxTiles; i++) {
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = this.quadGeometry.index;
        geo.attributes.position = this.quadGeometry.attributes.position;
        geo.attributes.uv = this.quadGeometry.attributes.uv;
        
        // Use standard WebGPU Instanced Attributes
        geo.setAttribute('offsetX', new THREE.InstancedBufferAttribute(new Uint16Array(this.rowsPerTile), 1, true));
        geo.setAttribute('offsetY', new THREE.InstancedBufferAttribute(new Uint16Array(this.rowsPerTile), 1, true));
        geo.setAttribute('pointIx', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        geo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        geo.setAttribute('instanceSize', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        geo.setAttribute('spawnTime', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile).fill(-1000.0), 1));
        geo.setAttribute('parallax', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        geo.setAttribute('teff', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        geo.setAttribute('pmra', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        geo.setAttribute('pmdec', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        geo.setAttribute('rv', new THREE.InstancedBufferAttribute(new Float32Array(this.rowsPerTile), 1));
        
        geo.instanceCount = 0; // Initialize empty to prevent garbage rendering

        const mesh = new THREE.Mesh(geo, mainMaterial);
        mesh.frustumCulled = false; // We do our own Zero-Cost GPU culling via mesh.visible
        mesh.visible = false;
        mesh.userData.slotIndex = i; // Assign Slot ID natively for picking shader
        mesh.userData.tileOffsetX = 0.0;
        mesh.userData.tileOffsetY = 0.0;
        mesh.userData.tileScale = 1.0;

        this.slotMeshes.push(mesh);
        this.scene.add(mesh);
    }
  }

  public updateEncoding(config: EncodingConfig) {
      this.previousConfig = { ...this.currentConfig };
      this.currentConfig = { ...this.currentConfig, ...config };
      
      const newMaterial = this.createMainMaterial(this.previousConfig, this.currentConfig);
      for (let i = 0; i < this.maxTiles; i++) {
          if (this.slotMeshes[i]) {
              this.slotMeshes[i].material = newMaterial;
          }
      }
      
      this.startTransition();
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
          
          if (progress < 1.0) {
              requestAnimationFrame(animate);
          } else {
              this.isTransitioning = false;
          }
      };
      
      requestAnimationFrame(animate);
  }

  private createMainMaterial(prevConfig: EncodingConfig = this.currentConfig, currConfig: EncodingConfig = this.currentConfig) {
    // Abstracted TSL inputs allow ALL 800 meshes to perfectly share this 1 Pipeline!
    const rawColor = float(attribute('instanceColor', 'float'));
    const rawMag = float(attribute('instanceSize', 'float'));
    const offsetX = attribute('offsetX', 'float');
    const offsetY = attribute('offsetY', 'float');
    const pointIx = float(attribute('pointIx', 'float'));
    const spawnTime = float(attribute('spawnTime', 'float'));
    const parallax = float(attribute('parallax', 'float'));
    const teff = float(attribute('teff', 'float'));
    const pmra = float(attribute('pmra', 'float'));
    const pmdec = float(attribute('pmdec', 'float'));
    const rv = float(attribute('rv', 'float'));

    const tileOffsetX = float(userData('tileOffsetX', 'float'));
    const tileOffsetY = float(userData('tileOffsetY', 'float'));
    const tileScale = float(userData('tileScale', 'float'));
    
    // Reconstruct global [0..1] coordinates
    const globalX = tileOffsetX.add(offsetX.mul(tileScale));
    const globalY = tileOffsetY.add(offsetY.mul(tileScale));

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      alphaTest: 0.001,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor, // True Additive Blending
      blendEquation: THREE.AddEquation,
      side: THREE.DoubleSide
    });

    const zoomT = this.rendererWrapper.zoomTUniform;
    const targetPixels = mix(float(1.0), float(2.0), zoomT);
    
    // Handle NaNs natively in the shader (NaN != NaN is True)
    const isMagNaN = rawMag.equal(rawMag).not();
    const safeRawMag = select(isMagNaN, float(20.0), rawMag);
    
    const isColorNaN = rawColor.equal(rawColor).not();
    const safeRawColor = select(isColorNaN, float(0.0), rawColor);
    
    // --- SIZE LOGIC ---
    const SEMANTIC_TOKEN_THRESHOLD = 30.0;
    const isTokens = safeRawMag.greaterThan(SEMANTIC_TOKEN_THRESHOLD);
    const tokenSize = max(float(0.5), log2(max(safeRawMag, float(1.0))));
    
    // GAIA BASELINE SIZE
    const gaiaBaseSize = max(float(0.05), float(21.0).sub(safeRawMag).div(float(10.0)));
    const computedGaiaSize = select(isTokens, tokenSize, gaiaBaseSize);
    const instanceGaiaSize = mix(float(1.2), float(3.0), zoomT).mul(computedGaiaSize);
    
    // CHART MODE SIZE
    const gaiaSizeClamp = clamp(float(21.0).sub(safeRawMag).div(float(8.0)), float(0.15), float(4.0));
    const computedChartSize = select(isTokens, tokenSize, gaiaSizeClamp);
    const linearSize = mix(float(1.5), float(3.0), zoomT);
    const zoomLevel = this.currentZoomUniform;
    const ultraDeepBoost = smoothstep(float(3.0), float(9.0), zoomLevel);
    const faintStarIsolator = smoothstep(float(15.0), float(19.0), safeRawMag);
    const targetedDeepBoost = ultraDeepBoost.mul(faintStarIsolator);
    const finalSizeMultiplier = float(1.0).add(targetedDeepBoost.mul(float(1.5)));
    const instanceChartSize = linearSize.mul(computedChartSize).mul(finalSizeMultiplier);
    
    const isVisible = isTokens.or(safeRawMag.lessThanEqual(this.maxMagUniform));
    
    const instanceSize = mix(instanceGaiaSize, instanceChartSize, this.modeUniform);
    const safeSize = select(isVisible, targetPixels.mul(this.rendererWrapper.worldUnitsPerPixelUniform).mul(instanceSize), float(0.0));
    
    // --- OPACITY LOGIC ---
    // GAIA BASELINE OPACITY
    const opacityRamp = sqrt(zoomT); 
    const baseGaiaOpacity = mix(float(0.03), float(0.10), opacityRamp);
    
    // CHART MODE OPACITY
    const linearOpacity = mix(float(0.04), float(0.12), zoomT);
    const deepBoost = max(float(0.0), zoomT.sub(float(0.5)));
    const baseChartOpacity = clamp(linearOpacity.add(deepBoost.mul(float(0.08))), float(0.02), float(0.25));
    const finalOpacityMultiplier = float(1.0).add(targetedDeepBoost.mul(float(4.0)));
    
    const magFade = clamp(this.maxMagUniform.sub(safeRawMag), float(0.0), float(1.0));
    const finalBaseGaiaOpacity = select(isTokens, baseGaiaOpacity, baseGaiaOpacity.mul(magFade));
    const finalBaseChartOpacity = select(isTokens, baseChartOpacity, baseChartOpacity.mul(magFade)).mul(finalOpacityMultiplier);
    
    const dynamicGaiaOpacity = clamp(finalBaseGaiaOpacity, float(1.0 / 255.0), float(1.0));
    const dynamicChartOpacity = clamp(finalBaseChartOpacity, float(1.0 / 255.0), float(1.0));
    const dynamicOpacity = mix(dynamicGaiaOpacity, dynamicChartOpacity, this.modeUniform);
    
    // --- COLOR LOGIC ---
    const getField = (field: string) => {
        if (field === 'x_u16') return globalX;
        if (field === 'y_u16') return globalY;
        if (field === 'bp_rp') return rawColor;
        if (field === 'abs_m') return rawMag;
        if (field === 'parallax') return parallax;
        if (field === 'teff_gspphot') return teff;
        if (field === 'pmra') return pmra;
        if (field === 'pmdec') return pmdec;
        if (field === 'radial_velocity') return rv;
        return float(0.0);
    };

    const mapVal = (val: any, domain: [number, number] | undefined, range: [number, number] | undefined) => {
        if (!domain || !range) return val;
        const t = val.sub(float(domain[0])).div(float(domain[1] - domain[0]));
        return mix(float(range[0]), float(range[1]), clamp(t, 0.0, 1.0));
    };

    // GAIA BASELINE COLOR
    const val = safeRawColor;
    const cBlue = vec3(0x11/255.0, 0x22/255.0, 0xaa/255.0);
    const cLtBlue = vec3(0x55/255.0, 0xaa/255.0, 0xdd/255.0);
    const cWhite = vec3(1.0, 1.0, 1.0);
    const cOrange = vec3(0xff/255.0, 0x99/255.0, 0x00/255.0);
    const cRed = vec3(0xcc/255.0, 0x22/255.0, 0x00/255.0);

    const mix1Gaia = smoothstep(-5.0, -2.5, val);
    const mix2Gaia = smoothstep(-2.5, 0.0, val);
    const mix3Gaia = smoothstep(0.0, 2.5, val);
    const mix4Gaia = smoothstep(2.5, 5.0, val);

    let colorGaia = mix(cBlue, cLtBlue, mix1Gaia);
    colorGaia = mix(colorGaia, cWhite, mix2Gaia);
    colorGaia = mix(colorGaia, cOrange, mix3Gaia);
    const baseGaiaColor = mix(colorGaia, cRed, mix4Gaia);

    // CHART MODE COLOR
    const colorField = currConfig.color?.field ? getField(currConfig.color.field) : rawColor;
    const isColorNaN2 = colorField.equal(colorField).not();
    const safeColor2 = select(isColorNaN2, float(0.0), colorField);
    
    let baseChartColor = vec3(1.0, 1.0, 1.0);
    if (currConfig.color?.range === 'rdbu') {
        let cDomain = currConfig.color?.domain || [-5.0, 5.0];
        const t = clamp(safeColor2.sub(float(cDomain[0])).div(float(cDomain[1] - cDomain[0])), 0.0, 1.0);
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
        const t = clamp(safeColor2.sub(float(cDomain[0])).div(float(cDomain[1] - cDomain[0])), 0.0, 1.0);
        const mix1 = smoothstep(0.0, 0.33, t);
        const mix2 = smoothstep(0.33, 0.66, t);
        const mix3 = smoothstep(0.66, 1.0, t);
        let color = mix(c1, c2, mix1);
        color = mix(color, c3, mix2);
        baseChartColor = mix(color, c4, mix3);
    }

    const baseColor = mix(baseGaiaColor, baseChartColor, this.modeUniform);
    
    // --- ALPHA & BLENDING ---
    const threshold = float(1.0 / 255.0);
    const distanceToCenter = distance(uv(), vec2(0.5));
    
    const alphaEdgeGaia = float(1.0).sub(smoothstep(float(0.35), float(0.5), distanceToCenter));
    const alphaEdgeChart = float(1.0).sub(smoothstep(float(0.0), float(0.5), distanceToCenter));
    const alphaEdge = mix(alphaEdgeGaia, alphaEdgeChart, this.modeUniform);
    
    const finalAlpha = alphaEdge.mul(dynamicOpacity);

    const isSubPixelOpacity = finalAlpha.lessThan(threshold);
    const randomVal = varying(hash(instanceIndex).mul(float(255.0)));
    const probDiscard = randomVal.greaterThan(finalAlpha.mul(float(255.0)));
    
    // Opacity Fade-in
    const age = this.globalTimeUniform.sub(spawnTime);
    const fadeAlpha = smoothstep(0.0, 0.3, age);
    
    const shouldDiscard = distanceToCenter.greaterThan(0.5).or(isSubPixelOpacity.and(probDiscard));
    const safeAlpha = select(shouldDiscard, float(0.0), max(finalAlpha, threshold).mul(fadeAlpha));

    mat.colorNode = baseColor.mul(safeAlpha);
    mat.opacityNode = safeAlpha;
    
    const getMappedPos = (cfg: EncodingConfig) => {
        const xField = cfg.x?.field ? getField(cfg.x.field) : globalX;
        const mappedX = mapVal(xField, cfg.x?.domain, cfg.x?.range);
        
        const yField = cfg.y?.field ? getField(cfg.y.field) : globalY;
        const mappedY = mapVal(yField, cfg.y?.domain, cfg.y?.range);
        
        let finalX = mappedX;
        let finalY = mappedY;
        
        if (cfg.x?.field === 'x_u16' || cfg.x?.transform === 'literal') {
            finalX = mappedX;
        }
        if (cfg.y?.field === 'y_u16' || cfg.y?.transform === 'literal') {
            finalY = mappedY;
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
    };

    const prevPos = getMappedPos(prevConfig);
    const currPos = getMappedPos(currConfig);
    
    const finalX = mix(prevPos.x, currPos.x, this.transitionTUniform);
    const finalY = mix(prevPos.y, currPos.y, this.transitionTUniform);

    const offset3D = vec3(finalX, finalY, float(0.0));
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
            this.slotMeshes[i].visible = false;
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
        
        // Prevent drawing garbage from a previous tile in this slot
        const geo = this.slotMeshes[slot].geometry as THREE.InstancedBufferGeometry;
        geo.instanceCount = 0;
      }
      
      const slot = this.tileKeyToSlot.get(tile.key)!;
      const geo = this.slotMeshes[slot].geometry as THREE.InstancedBufferGeometry;

      if (tile.needsUpdate) {
        if (performance.now() - frameStart > 8.0) {
             this.slotMeshes[slot].visible = geo.instanceCount > 0;
             hasPendingUpdates = true;
             continue;
        }
        
        // Update per-mesh uniforms for the shader
        const [zStr, txStr, tyStr] = tile.key.split('/');
        const scale = 1.0 / Math.pow(2, parseInt(zStr));
        this.slotMeshes[slot].userData.tileOffsetX = parseInt(txStr) * scale;
        this.slotMeshes[slot].userData.tileOffsetY = parseInt(tyStr) * scale;
        this.slotMeshes[slot].userData.tileScale = scale;
        
        const numItems = Math.min(tile.numRows, this.rowsPerTile);
        geo.instanceCount = numItems;
        
        if (tile.xBuffer && tile.yBuffer) {
            const ox = geo.getAttribute('offsetX') as THREE.InstancedBufferAttribute;
            (ox.array as Uint16Array).set(new Uint16Array(tile.xBuffer).subarray(0, numItems));
            ox.clearUpdateRanges();
            ox.addUpdateRange(0, numItems);
            ox.needsUpdate = true;
            
            const oy = geo.getAttribute('offsetY') as THREE.InstancedBufferAttribute;
            (oy.array as Uint16Array).set(new Uint16Array(tile.yBuffer).subarray(0, numItems));
            oy.clearUpdateRanges();
            oy.addUpdateRange(0, numItems);
            oy.needsUpdate = true;

            const ixBuf = tile.ixBuffer || new Float32Array(numItems);
            const ix = geo.getAttribute('pointIx') as THREE.InstancedBufferAttribute;
            (ix.array as Float32Array).set(ixBuf.subarray(0, numItems));
            ix.clearUpdateRanges();
            ix.addUpdateRange(0, numItems);
            ix.needsUpdate = true;
        }
        
        if (tile.colorBuffer) {
            const currentTime = performance.now() / 1000.0;
            const spawnTimeArray = new Float32Array(numItems).fill(currentTime);

            const ic = geo.getAttribute('instanceColor') as THREE.InstancedBufferAttribute;
            (ic.array as Float32Array).set(tile.colorBuffer.subarray(0, numItems));
            ic.clearUpdateRanges();
            ic.addUpdateRange(0, numItems);
            ic.needsUpdate = true;

            const is = geo.getAttribute('instanceSize') as THREE.InstancedBufferAttribute;
            (is.array as Float32Array).set(tile.sizeBuffer!.subarray(0, numItems));
            is.clearUpdateRanges();
            is.addUpdateRange(0, numItems);
            is.needsUpdate = true;

            const st = geo.getAttribute('spawnTime') as THREE.InstancedBufferAttribute;
            (st.array as Float32Array).set(spawnTimeArray);
            st.clearUpdateRanges();
            st.addUpdateRange(0, numItems);
            st.needsUpdate = true;

            const updateExtraBuf = (name: string, buf: Float32Array | undefined) => {
                if (buf) {
                    const attr = geo.getAttribute(name) as THREE.InstancedBufferAttribute;
                    (attr.array as Float32Array).set(buf.subarray(0, numItems));
                    attr.clearUpdateRanges();
                    attr.addUpdateRange(0, numItems);
                    attr.needsUpdate = true;
                }
            };
            
            updateExtraBuf('parallax', tile.parallaxBuffer);
            updateExtraBuf('teff', tile.teffBuffer);
            updateExtraBuf('pmra', tile.pmraBuffer);
            updateExtraBuf('pmdec', tile.pmdecBuffer);
            updateExtraBuf('rv', tile.rvBuffer);
        }        tile.needsUpdate = false;
      }
      
      this.slotMeshes[slot].visible = geo.instanceCount > 0;
    }
    
    return hasPendingUpdates;
  }

}
