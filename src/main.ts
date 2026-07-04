import * as THREE from 'three';

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
const TILE_SERVER_URL = '/gaia.pmtiles';




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
  
  // 2. Initialize the PMTiles client and pass 2000 for LRU Cache
  const tileManager = new PMTilesClient(TILE_SERVER_URL, rootBounds, 2000);
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

  const mouse = new THREE.Vector2();

  const tooltip = document.createElement('div');
  tooltip.style.position = 'absolute';
  tooltip.style.background = 'rgba(0,0,0,0.8)';
  tooltip.style.color = 'white';
  tooltip.style.padding = '5px';
  tooltip.style.borderRadius = '5px';
  tooltip.style.display = 'none';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.zIndex = '1000';
  document.body.appendChild(tooltip);

  const raycaster = new THREE.Raycaster();

  async function performGPUPicking(mouseX: number, mouseY: number) {
    if (!scatterplot.pickingRenderTarget.texture) return;
    
    // 1. Position the 1x1 picking camera perfectly under the mouse cursor
    const pickingCamera = rendererWrapper.camera.clone() as THREE.OrthographicCamera;
    pickingCamera.setViewOffset(
        window.innerWidth, window.innerHeight,
        mouseX, mouseY,
        1, 1
    );

    // 2. Hide hoverMesh during picking
    scatterplot.hoverMesh.visible = false;

    // 3. Override per-mesh picking materials
    const originalMaterials = new Map<THREE.Mesh, THREE.Material>();
    rendererWrapper.scene.traverse((child) => {
        if (child instanceof THREE.Mesh && child.userData.pickingMaterial) {
            originalMaterials.set(child, child.material);
            child.material = child.userData.pickingMaterial;
        }
    });

    // 4. Render directly to the 1x1 Render Target
    rendererWrapper.renderer.setRenderTarget(scatterplot.pickingRenderTarget);
    await rendererWrapper.renderer.renderAsync(rendererWrapper.scene, pickingCamera);

    // 5. Restore scene state
    rendererWrapper.renderer.setRenderTarget(null);
    for (const [mesh, origMat] of originalMaterials.entries()) {
        mesh.material = origMat;
    }

    // 6. Read back the exact 4 bytes asynchronously!
    const buffer = await rendererWrapper.renderer.readRenderTargetPixelsAsync(
        scatterplot.pickingRenderTarget, 
        0, 0, 1, 1
    );

    if (!buffer) return;

    // Decode: RGBA -> globalId
    // Background pixels have Alpha=0. Valid picked IDs have Alpha >= 1 due to our 0x01000000 offset.
    if (buffer[3] === 0) {
        scatterplot.updateHover(-1, () => {});
        tooltip.style.display = 'none';
        return;
    }

    const decodedId = buffer[0] | (buffer[1] << 8) | (buffer[2] << 16) | (buffer[3] << 24);
    const globalId = decodedId - 0x01000000;

    scatterplot.updateHover(globalId, (hoverHtml) => {
        tooltip.style.display = 'block';
        tooltip.style.left = mouseX + 15 + 'px';
        tooltip.style.top = mouseY + 15 + 'px';
        tooltip.style.fontFamily = 'monospace';
        tooltip.innerHTML = hoverHtml;
    });
  }

  // DISABLED TEMPORARILY: Hover tooltip and magnification
  /*
  let isPickingScheduled = false;
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (!isPickingScheduled) {
      isPickingScheduled = true;
      performGPUPicking(mouse.x, mouse.y).then(() => {
          isPickingScheduled = false;
      }).catch(err => {
          console.error("Picking error", err);
          isPickingScheduled = false;
      });
    }
  });
  */

  // Connect TileManager's Cache Eviction to Scatterplot's GPU slots
  tileManager.onTileUnloaded = (tileId: string) => {
      scatterplot.unloadTile(tileId);
  };

  const lastCameraMatrix = new THREE.Matrix4();
  let lastZoom = -1;
  let activeVisibleTiles: TileData[] = [];

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
      const w = window as any;
      
      let hasPendingUpdates = w.hasPendingUpdates || false;
      
      // 2. Fetch visible tiles only when camera moves or cache updates
      // Pure Google Maps Math: Target tile pixel-density directly from zoom level.
      // Math.log2() naturally steps exactly by powers of 2, perfectly matching the quadtree depth.
      // We add +2 as a constant visual density offset (Google Maps typically overfetches by ~1-2 Z levels for sharpness).
      const detailOffset = 2;
      const currentZ = Math.min(14, Math.floor(currentZoom) + detailOffset);
      
      if (w.lastCamHash !== camHash || tileManager.cacheChanged || hasPendingUpdates) {
          activeVisibleTiles = tileManager.getVisibleTiles(frustumBox, currentZ);
          t1 = performance.now();
          
          // 3. Update scatterplot geometry and compute nodes
          w.hasPendingUpdates = scatterplot.updateTiles(activeVisibleTiles);
          
          w.lastCamHash = camHash;
          w.currentZDisplay = tileManager.currentMaxZ;
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
      w.perfAccum = w.perfAccum || { frames: 0, getVisibleTiles: 0, updateTiles: 0, updateCam: 0, render: 0, totalFrame: 0, lastReport: performance.now() };
      w.perfAccum.frames++;
      w.perfAccum.getVisibleTiles += (t1 - t0);
      w.perfAccum.updateTiles += (t2 - t1);
      w.perfAccum.updateCam += (t3 - t2);
      w.perfAccum.render += (t4 - t3);
      w.perfAccum.totalFrame += (t4 - t0);
      
      if (t4 - w.perfAccum.lastReport >= 250) {
         const p = w.perfAccum;
         w.lastPerfReport = {
            fps: (p.frames * (1000 / (t4 - p.lastReport))).toFixed(0),
            tiles: activeVisibleTiles.length,
            getVisibleTiles: (p.getVisibleTiles / p.frames).toFixed(1),
            updateTiles: (p.updateTiles / p.frames).toFixed(1),
            updateCam: (p.updateCam / p.frames).toFixed(1),
            render: (p.render / p.frames).toFixed(1),
            totalFrame: (p.totalFrame / p.frames).toFixed(1)
         };
         w.perfAccum = { frames: 0, getVisibleTiles: 0, updateTiles: 0, updateCam: 0, render: 0, totalFrame: 0, lastReport: t4 };
         
         // Throttled UI DOM Update
         let totalPoints = 0;
         for (const t of activeVisibleTiles) totalPoints += t.numRows;
         const vramMB = (activeVisibleTiles.length * 2.4).toFixed(1);
         let netLatency = "0.0";
         let workerLatency = "0.0";
         if (w.fetchTelemetry && w.fetchTelemetry.net.length > 0) {
             const sumNet = w.fetchTelemetry.net.reduce((a: number, b: number) => a + b, 0);
             const sumWorker = w.fetchTelemetry.worker.reduce((a: number, b: number) => a + b, 0);
             const avgNet = sumNet / w.fetchTelemetry.net.length;
             w.lastNetLatency = avgNet;
             netLatency = avgNet.toFixed(1);
             workerLatency = (sumWorker / w.fetchTelemetry.worker.length).toFixed(1);
         }
         
         const perf = w.lastPerfReport;
         uiText.innerHTML = `
           Streaming Quadtree (Z=${w.currentZDisplay ?? 0})
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
