import * as THREE from 'three';
import GUI from 'lil-gui';
import { PMTiles } from 'pmtiles';
// Global AbortError swallowing removed in favor of localized catches in PMTilesClient.ts
let _cameraHash = "";
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { 
  attribute, float, positionLocal, vec3, vec4, vec2, uv, distance, smoothstep,
  fwidth, hash, instanceIndex, Discard, max, min, userData, uint, mix,
  log2, clamp, pow, uniformArray, uniform, select, length, floor, varying
} from 'three/tsl';
import { Renderer } from './core/Renderer.ts';
import { PMTilesClient } from './PMTilesClient.ts';
import type { BoundingBox, TileData } from './PMTilesClient.ts';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
const TILE_SERVER_URL = "/gaia_full.arrowtiles";


import { Scatterplot } from './Scatterplot';
let rendererInstance: Renderer | null = null;
let scatterplotInstance: Scatterplot | null = null;




async function init() {
  const container = document.getElementById('app')!;
  const uiText = document.querySelector('#ui p')!;

  

  if (!navigator.gpu) {
    uiText.textContent = 'WebGPU is not supported by your browser.';
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  const limits = adapter ? adapter.limits : undefined;
  const rendererWrapper = new Renderer(container, limits);
  await rendererWrapper.init();
  
  const device = (rendererWrapper.renderer as any).backend?.device;
  if (device) {
      device.addEventListener('uncapturederror', (event: any) => {
          uiText.innerHTML = `<span style="color:red;font-weight:bold;">?O WebGPU VRAM Crash: ${event.error.message}</span>`;
          console.error("WebGPU uncapturederror:", event.error);
      });
  }


  rendererWrapper.renderer.sortObjects = false; // Disable sorting for additive blending

  const rootBounds = { minX: -2.0, maxX: 2.0, minY: -1.0, maxY: 1.0 };
  
  const scatterplot = new Scatterplot(rendererWrapper.scene, rendererWrapper, rootBounds);
  
  let gui: GUI | null = null;
  let tileManager: PMTilesClient | null = null;
  
  async function loadDataset(source: string | File) {
      if (gui) {
          gui.destroy();
          gui = null;
      }
      
      uiText.innerHTML = `Loading dataset schema...`;
      
      if (tileManager) {
          tileManager.destroy();
      }
      
      const { FileSource } = await import('pmtiles');
      const tempPmtiles = new PMTiles(typeof source === 'string' ? source : new FileSource(source));
      const metadata: any = await tempPmtiles.getMetadata();
      
      let schemaBuffer: Uint8Array | null = null;
      if (metadata && metadata.arrow_schema) {
          const binaryString = atob(metadata.arrow_schema);
          schemaBuffer = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
              schemaBuffer[i] = binaryString.charCodeAt(i);
          }
          console.log("Loaded embedded schema from PMTiles metadata!");
      } else {
          console.warn("No embedded arrow_schema found in PMTiles metadata.");
      }

      let embeddedConfig: any = {};
      // For Gaia, since we haven't rebuilt it with stats, provide some sensible fallbacks
      const sourceName = typeof source === 'string' ? source : source.name;
      const isGaia = sourceName.includes('gaia');
      const gaiaFallbacks = {
          abs_m: { min: -5.0, max: 20.0 },
          bp_rp: { min: -1.0, max: 5.0 },
          radial_velocity: { min: -200.0, max: 200.0 },
          teff_gspphot: { min: 2000.0, max: 12000.0 },
          parallax: { min: -5.0, max: 20.0 }
      };

      if (metadata) {
          // Rust ArrowTilesPacker flattens the JSON config into top-level PMTiles metadata keys
          embeddedConfig = {
              mode: metadata.mode,
              colorField: metadata.colorField,
              colorMin: metadata.colorMin !== undefined ? parseFloat(metadata.colorMin) : undefined,
              colorMax: metadata.colorMax !== undefined ? parseFloat(metadata.colorMax) : undefined,
              sizeField: metadata.sizeField,
              sizeMin: metadata.sizeMin !== undefined ? parseFloat(metadata.sizeMin) : undefined,
              sizeMax: metadata.sizeMax !== undefined ? parseFloat(metadata.sizeMax) : undefined,
              colorScale: metadata.colorScale,
              xField: metadata.xField,
              yField: metadata.yField,
              stats: metadata.stats ? JSON.parse(metadata.stats) : (isGaia ? gaiaFallbacks : undefined)
          };
          console.log("Loaded embedded config from PMTiles metadata:", embeddedConfig);
      }

      const dynamicRootBounds = isGaia 
          ? { minX: -2.0, maxX: 2.0, minY: -1.0, maxY: 1.0 }
          : { minX: -1.0, maxX: 1.0, minY: -1.0, maxY: 1.0 };

      tileManager = new PMTilesClient(source, [], dynamicRootBounds, 250, schemaBuffer);
      scatterplot.setRootBounds(dynamicRootBounds);
      (window as any).tileManagerInstance = tileManager;
      
      let schemaFields: string[] = [];
      try {
          const schema = await tileManager.getSchema();
          schemaFields = schema.map(f => f.name).filter(n => n !== 'x_u16' && n !== 'y_u16');
      } catch (err) {
          console.warn("Failed to parse schema, falling back to empty fields list", err);
      }
      
      const allFields = ['x_u16', 'y_u16', ...schemaFields];

      gui = new GUI({ title: 'Visualization Controls' });
      const defaultField = schemaFields.includes('sort_metric') ? 'sort_metric' : (schemaFields.length > 0 ? schemaFields[0] : 'x_u16');
      
      const state = {
          mode: embeddedConfig.mode || (isGaia ? 'Gaia Baseline' : 'Chart Mode'),
          colorField: embeddedConfig.colorField || (isGaia ? 'bp_rp' : defaultField),
          colorMin: embeddedConfig.colorMin ?? (isGaia ? -1.0 : 0.0),
          colorMax: embeddedConfig.colorMax ?? (isGaia ? 4.0 : 100.0),
          colorScale: embeddedConfig.colorScale || 'viridis',
          xField: embeddedConfig.xField || 'x_u16',
          yField: embeddedConfig.yField || 'y_u16',
          sizeField: embeddedConfig.sizeField || defaultField,
          sizeMin: embeddedConfig.sizeMin ?? 0.0,
          sizeMax: embeddedConfig.sizeMax ?? (isGaia ? 2000.0 : 100.0)
      };

      const updateConfig = () => {
          if (!tileManager) return;
          scatterplot.modeUniform.value = state.mode === 'Gaia Baseline' ? 0.0 : 1.0;
          const xRange = isGaia ? [-2, 2] : [-1, 1];
          const activeCols = scatterplot.updateEncoding({
              x: { field: state.xField, transform: 'linear', domain: [0, 1], range: xRange },
              y: { field: state.yField, transform: 'linear', domain: [0, 1], range: [1, -1] },
              color: { field: state.colorField, range: state.colorScale as any, domain: [state.colorMin, state.colorMax] },
              size: { field: state.sizeField, domain: [state.sizeMin, state.sizeMax], range: [0.5, 3.0] }
          });
          tileManager.setRequestedColumns(activeCols);
      };
      
      const availableModes = embeddedConfig.availableModes || (embeddedConfig.mode === 'Gaia Baseline' || isGaia ? ['Gaia Baseline', 'Chart Mode'] : ['Chart Mode']);
      
      const modeFolder = gui.addFolder('Visualization Mode');
      modeFolder.add(state, 'mode', availableModes).name('mode').onChange(updateConfig);

      let colorMinCtrl: any;
      let colorMaxCtrl: any;
      let sizeMinCtrl: any;
      let sizeMaxCtrl: any;

      const handleColorFieldChange = (newField: string) => {
          if (embeddedConfig.stats && embeddedConfig.stats[newField]) {
              const bounds = embeddedConfig.stats[newField];
              state.colorMin = bounds.min;
              state.colorMax = bounds.max;
              if (colorMinCtrl) { colorMinCtrl.min(bounds.min).max(bounds.max); }
              if (colorMaxCtrl) { colorMaxCtrl.min(bounds.min).max(bounds.max); }
              gui.controllersRecursive().forEach(c => c.updateDisplay());
          }
          updateConfig();
      };
      
      const handleSizeFieldChange = (newField: string) => {
          if (embeddedConfig.stats && embeddedConfig.stats[newField]) {
              const bounds = embeddedConfig.stats[newField];
              state.sizeMin = bounds.min;
              state.sizeMax = bounds.max;
              if (sizeMinCtrl) { sizeMinCtrl.min(bounds.min).max(bounds.max); }
              if (sizeMaxCtrl) { sizeMaxCtrl.min(bounds.min).max(bounds.max); }
              gui.controllersRecursive().forEach(c => c.updateDisplay());
          }
          updateConfig();
      };

      const chartFolder = gui.addFolder('Chart Mode Settings');
      chartFolder.add(state, 'colorField', allFields).name('Color By').onChange(handleColorFieldChange);
      chartFolder.add(state, 'colorScale', ['viridis', 'plasma', 'magma', 'inferno', 'rdbu']).name('Color Scale').onChange(updateConfig);
      
      // Initialize with bounds if we have them for the default field
      let initColorBounds = { min: 0.0, max: isGaia ? 2000.0 : 100.0 };
      if (embeddedConfig.stats && embeddedConfig.stats[state.colorField]) {
          initColorBounds = embeddedConfig.stats[state.colorField];
      }
      colorMinCtrl = chartFolder.add(state, 'colorMin', initColorBounds.min, initColorBounds.max).name('Color Min').onChange(updateConfig);
      colorMaxCtrl = chartFolder.add(state, 'colorMax', initColorBounds.min, initColorBounds.max).name('Color Max').onChange(updateConfig);

      
      let initSizeBounds = { min: 0.0, max: isGaia ? 2000.0 : 100.0 };
      if (embeddedConfig.stats && embeddedConfig.stats[state.sizeField]) {
          initSizeBounds = embeddedConfig.stats[state.sizeField];
      }
      chartFolder.add(state, 'sizeField', allFields).name('Size By').onChange(handleSizeFieldChange);
      sizeMinCtrl = chartFolder.add(state, 'sizeMin', initSizeBounds.min, initSizeBounds.max).name('Size Min').onChange(updateConfig);
      sizeMaxCtrl = chartFolder.add(state, 'sizeMax', initSizeBounds.min, initSizeBounds.max).name('Size Max').onChange(updateConfig);
      
      chartFolder.add(state, 'xField', allFields).name('X Axis').onChange(updateConfig);
      chartFolder.add(state, 'yField', allFields).name('Y Axis').onChange(updateConfig);

      // Connect TileManager's Cache Eviction to Scatterplot's GPU slots
      tileManager.onTileUnloaded = (tileId: string) => {
          scatterplot.unloadTile(tileId);
      };

      updateConfig();
      uiText.innerHTML = `WebGPU is supported!<br/>Streaming Quadtree Tiles...`;
  }

  // Setup Drag and Drop
  const dropOverlay = document.getElementById('drop-overlay');
  if (dropOverlay) {
      window.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropOverlay.style.display = 'flex';
      });
      window.addEventListener('dragleave', (e) => {
          e.preventDefault();
          if (e.clientX === 0 && e.clientY === 0) {
              dropOverlay.style.display = 'none';
          }
      });
      window.addEventListener('drop', (e) => {
          e.preventDefault();
          dropOverlay.style.display = 'none';
          if (e.dataTransfer?.files.length) {
              const file = e.dataTransfer.files[0];
              if (file.name.endsWith('.arrowtiles')) {
                  loadDataset(file).catch(console.error);
              }
          }
      });
  }

  await loadDataset(TILE_SERVER_URL);

  const copyBtn = document.getElementById('copy-metrics-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
       navigator.clipboard.writeText(uiText.innerText);
       const origColor = copyBtn.style.color;
       copyBtn.style.color = '#4CAF50';
       setTimeout(() => copyBtn.style.color = origColor, 1000);
    });
  }

  // Detail is now perfectly tied to camera zoom.



  rendererInstance = rendererWrapper;
  scatterplotInstance = scatterplot;

  rendererInstance = rendererWrapper;
  scatterplotInstance = scatterplot;

  const mouse = new THREE.Vector2();

  const lastCameraMatrix = new THREE.Matrix4();
  let lastZoom = -1;
  let activeVisibleTiles: TileData[] = [];
  
  // Local state for render loop
  let hasPendingUpdates = false;
  let lastCamHash = "";
  let currentZDisplay = 0;
  let perfAccum = { frames: 0, getVisibleTiles: 0, updateTiles: 0, updateCam: 0, render: 0, totalFrame: 0, lastReport: performance.now() };
  let lastPerfReport = { fps: "0", tiles: 0, getVisibleTiles: "0", updateTiles: "0", updateCam: "0", render: "0", totalFrame: "0" };

  rendererWrapper.renderer.setAnimationLoop(() => {
    try {
      if (!tileManager) return;

      const t0 = performance.now();
      
      const cam = rendererWrapper.camera as THREE.OrthographicCamera;
      const currentZoom = Math.log2(Math.max(0.1, cam.zoom));
      
      let t1 = performance.now();
      
      // 1. Get frustum bounds from camera (Throttled for box math only)
      if (!lastCameraMatrix.equals(cam.matrixWorld) || currentZoom !== lastZoom) {
          lastCameraMatrix.copy(cam.matrixWorld);
          lastZoom = currentZoom;
      }
          
      const worldFrustum: BoundingBox = {
         minX: cam.position.x + cam.left / cam.zoom,
         maxX: cam.position.x + cam.right / cam.zoom,
         minY: cam.position.y + cam.bottom / cam.zoom,
         maxY: cam.position.y + cam.top / cam.zoom
      };
            const frustumBox: BoundingBox = worldFrustum;
      
      const currentMaxIx = scatterplot.calculateMaxIx(cam);
      const camHash = `${cam.position.x},${cam.position.y},${cam.zoom}`;
      
      // 2. Fetch visible tiles only when camera moves or cache updates
      // Pure Google Maps Math: Target tile pixel-density directly from zoom level.
      // Math.log2() naturally steps exactly by powers of 2, perfectly matching the quadtree depth.
      // We add +2 as a constant visual density offset (Google Maps typically overfetches by ~1-2 Z levels for sharpness).
      const detailOffset = 2;
      const currentZ = Math.max(0, Math.min(14, Math.floor(currentZoom) + detailOffset));
      
      if (lastCamHash !== camHash || tileManager.cacheChanged || hasPendingUpdates) {
          activeVisibleTiles = tileManager.getVisibleTiles(frustumBox, currentZ);
          t1 = performance.now();
          
          // 3. Update scatterplot geometry and compute nodes
          hasPendingUpdates = scatterplot.updateTiles(activeVisibleTiles);
          
          lastCamHash = camHash;
          currentZDisplay = tileManager.currentMaxZ;
          tileManager.cacheChanged = false;
      }
      
      const t2 = performance.now();
      
      // 4. Update Camera
      scatterplot.updateCamera(rendererWrapper.camera);

      const t3 = performance.now();

      // 5. Render Main Scene
      rendererWrapper.render();
      
      const t4 = performance.now();
      
      // TELEMETRY
      perfAccum.frames++;
      perfAccum.getVisibleTiles += (t1 - t0);
      perfAccum.updateTiles += (t2 - t1);
      perfAccum.updateCam += (t3 - t2);
      perfAccum.render += (t4 - t3);
      perfAccum.totalFrame += (t4 - t0);
      
      if (t4 - perfAccum.lastReport >= 250) {
         const p = perfAccum;
         lastPerfReport = {
            fps: (p.frames * (1000 / (t4 - p.lastReport))).toFixed(0),
            tiles: activeVisibleTiles.length,
            getVisibleTiles: (p.getVisibleTiles / p.frames).toFixed(1),
            updateTiles: (p.updateTiles / p.frames).toFixed(1),
            updateCam: (p.updateCam / p.frames).toFixed(1),
            render: (p.render / p.frames).toFixed(1),
            totalFrame: (p.totalFrame / p.frames).toFixed(1)
         };
         perfAccum = { frames: 0, getVisibleTiles: 0, updateTiles: 0, updateCam: 0, render: 0, totalFrame: 0, lastReport: t4 };
         
         // Throttled UI DOM Update
         let totalPoints = 0;
         for (const t of activeVisibleTiles) totalPoints += t.numRows;
         const vramMB = (activeVisibleTiles.length * 2.4).toFixed(1);
         let netLatency = "0.0";
         let workerLatency = "0.0";
         if (tileManager.fetchTelemetry && tileManager.fetchTelemetry.net.length > 0) {
             const sumNet = tileManager.fetchTelemetry.net.reduce((a: number, b: number) => a + b, 0);
             const sumWorker = tileManager.fetchTelemetry.worker.reduce((a: number, b: number) => a + b, 0);
             const avgNet = sumNet / tileManager.fetchTelemetry.net.length;
             netLatency = avgNet.toFixed(1);
             workerLatency = (sumWorker / tileManager.fetchTelemetry.worker.length).toFixed(1);
         }
         
         const perf = lastPerfReport;
         uiText.innerHTML = `
           Streaming Quadtree (Z=${currentZDisplay ?? 0})
        FPS: ${perf.fps}
        Camera Zoom: ${cam.zoom.toFixed(2)}</b><br/>
           Tiles active: ${activeVisibleTiles.length} (${vramMB} MB VRAM)<br/>
           Points rendered: ${(totalPoints / 1000000).toFixed(2)} Million<br/>
           Tile load latency: <b>Net</b> ${netLatency}ms | <b>Worker</b> ${workerLatency}ms
           <br/><span style="color:#aaa; font-size: 12px;">Culling: ${perf.getVisibleTiles}ms | GPU Upload: ${perf.updateTiles}ms | Render: ${perf.render}ms</span>
         `;
      }
      

    } catch (err) {
      console.error("Animation loop crash:", err);
      rendererWrapper.renderer.setAnimationLoop(null); // Stop loop to avoid 3000 errors
    }
  });
}

init().catch(console.error);
