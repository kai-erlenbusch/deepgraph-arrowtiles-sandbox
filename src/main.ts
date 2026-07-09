import * as THREE from 'three';
import GUI from 'lil-gui';
import { PMTiles } from 'pmtiles';
// Globally swallow AbortErrors that leak from pmtiles due to internal unhandled promise chaining
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.name === 'AbortError') {
        event.preventDefault();
    }
});

let _cameraHash = "";
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { 
  attribute, float, positionLocal, vec3, vec4, vec2, uv, distance, smoothstep,
  fwidth, hash, instanceIndex, Discard, max, min, userData, uint, mix,
  log2, clamp, pow, uniformArray, uniform, select, length, floor, varying
} from 'three/tsl';
import { Renderer } from './core/Renderer';
import { PMTilesClient } from './PMTilesClient';
import type { BoundingBox, TileData } from './PMTilesClient';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
const TILE_SERVER_URL = `/gaia.arrowtiles`;


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
          uiText.innerHTML = `<span style="color:red;font-weight:bold;">❌ WebGPU VRAM Crash: ${event.error.message}</span>`;
          console.error("WebGPU uncapturederror:", event.error);
      });
  }


  rendererWrapper.renderer.sortObjects = false; // Disable sorting for additive blending

  const rootBounds = { minX: -2.0, maxX: 2.0, minY: -1.0, maxY: 1.0 };
  
  const scatterplot = new Scatterplot(rendererWrapper.scene, rendererWrapper, rootBounds);
  
  const gui = new GUI({ title: 'Visualization Controls' });
  const state = {
      mode: 'Gaia Baseline',
      colorField: 'bp_rp',
      colorScale: 'viridis',
      xField: 'x_u16',
      yField: 'y_u16'
  };

  const updateConfig = () => {
      scatterplot.modeUniform.value = state.mode === 'Chart Mode' ? 1.0 : 0.0;
      scatterplot.updateEncoding({
          x: { field: state.xField, transform: 'linear', domain: [0, 1], range: [-2, 2] },
          y: { field: state.yField, transform: 'linear', domain: [0, 1], range: [1, -1] },
          color: { field: state.colorField, range: state.colorScale as any, domain: [-0.5, 2.5] }
      });
  };

  gui.add(state, 'mode', ['Gaia Baseline', 'Chart Mode']).name('Mode').onChange(updateConfig);
  
  const chartFolder = gui.addFolder('Chart Mode Settings');
  const fields = ['x_u16', 'y_u16', 'bp_rp', 'abs_m', 'parallax', 'teff_gspphot', 'pmra', 'pmdec', 'radial_velocity'];
  chartFolder.add(state, 'colorField', fields).name('Color By').onChange(updateConfig);
  chartFolder.add(state, 'colorScale', ['viridis', 'rdbu']).name('Color Scale').onChange(updateConfig);
  chartFolder.add(state, 'xField', fields).name('X Axis').onChange(updateConfig);
  chartFolder.add(state, 'yField', fields).name('Y Axis').onChange(updateConfig);

  uiText.innerHTML = `Fetching embedded .arrowtiles schema...`;
  
  const tempPmtiles = new PMTiles(TILE_SERVER_URL);
  const metadata = await tempPmtiles.getMetadata();
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

  const tileManager = new PMTilesClient(TILE_SERVER_URL, [], rootBounds, 250, schemaBuffer);
  window.tileManagerInstance = tileManager;
  
  uiText.innerHTML = `WebGPU is supported!<br/>Streaming Quadtree Tiles...`;

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

  // Connect TileManager's Cache Eviction to Scatterplot's GPU slots
  tileManager.onTileUnloaded = (tileId: string) => {
      scatterplot.unloadTile(tileId);
  };

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
