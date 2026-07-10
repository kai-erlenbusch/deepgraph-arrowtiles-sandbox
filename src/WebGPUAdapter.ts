import { InstancedBufferAttribute } from 'three';
import { WebGPURenderer } from 'three/webgpu';

/**
 * Safely writes an ArrayBuffer payload directly to a WebGPU InstancedBufferAttribute's underlying VRAM queue.
 * This is a highly experimental fast-path that bypasses standard Three.js serialization.
 * 
 * @param renderer The Three.js WebGPURenderer
 * @param attribute The InstancedBufferAttribute to update
 * @param payload The raw ArrayBuffer data to write
 * @returns boolean True if the fast-path succeeded, false if it failed (meaning fallback is required)
 */
export function writeToDeviceQueue(
    renderer: WebGPURenderer, 
    attribute: InstancedBufferAttribute, 
    payload: ArrayBuffer
): boolean {
    try {
        // Isolate the 'any' cast here to protect against future Three.js WebGPU API changes.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const backend = (renderer as any).backend;
        if (!backend || !backend.device || typeof backend.get !== 'function') {
            return false;
        }

        const webgpuDevice = backend.device as GPUDevice;
        const gpuBuffer = backend.get(attribute).buffer;

        if (!gpuBuffer) return false;

        webgpuDevice.queue.writeBuffer(gpuBuffer, 0, payload, 0, payload.byteLength);
        return true;
    } catch (e) {
        console.warn("WebGPU fast-path failed, falling back to standard update.", e);
        return false;
    }
}
