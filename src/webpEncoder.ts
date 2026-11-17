import * as fs from 'fs';
import * as path from 'path';

declare const __dirname: string;

let encodeFn: ((data: { data: Uint8ClampedArray; width: number; height: number }, options?: any) => Promise<ArrayBuffer>) | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Initializes the WebP WebAssembly encoder.
 * Checks for SIMD support and falls back to standard WebAssembly if needed.
 */
export async function initWebPEncoder(extensionPath?: string): Promise<void> {
  if (encodeFn) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const { default: encode, init } = await import('@jsquash/webp/encode.js');

    // Locate the wasm file
    let packageDir: string;
    try {
      packageDir = path.dirname(require.resolve('@jsquash/webp/package.json'));
    } catch {
      if (extensionPath) {
        packageDir = path.join(extensionPath, 'node_modules/@jsquash/webp');
      } else {
        const baseDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
        packageDir = path.join(baseDir, '../node_modules/@jsquash/webp');
      }
    }

    const simdWasmPath = path.join(packageDir, 'codec/enc/webp_enc_simd.wasm');
    const stdWasmPath = path.join(packageDir, 'codec/enc/webp_enc.wasm');

    let wasmModule: WebAssembly.Module | null = null;

    // Try SIMD wasm first
    if (fs.existsSync(simdWasmPath)) {
      try {
        const bytes = fs.readFileSync(simdWasmPath);
        wasmModule = new WebAssembly.Module(bytes);
      } catch (err) {
        console.warn('[WebP Encoder] SIMD WASM compilation failed, falling back to standard WASM:', err);
      }
    }

    // Fall back to standard wasm if SIMD failed or missing
    if (!wasmModule && fs.existsSync(stdWasmPath)) {
      const bytes = fs.readFileSync(stdWasmPath);
      wasmModule = new WebAssembly.Module(bytes);
    }

    if (!wasmModule) {
      throw new Error(`[WebP Encoder] Could not find or compile webp wasm modules at ${simdWasmPath} or ${stdWasmPath}`);
    }

    await init(wasmModule);
    encodeFn = encode as any;
  })();

  return initPromise;
}

/**
 * Encodes raw RGBA pixels (Uint8ClampedArray) to a WebP image buffer.
 * @param data RGBA pixel data, width, and height
 * @param quality WebP compression quality (0-100)
 */
export async function encodeToWebp(
  data: { data: Uint8ClampedArray; width: number; height: number },
  quality: number = 80
): Promise<Buffer> {
  if (!encodeFn) {
    await initWebPEncoder();
  }

  const clampedQuality = Math.max(10, Math.min(100, Math.round(quality)));
  const arrayBuffer = await encodeFn!(data, { quality: clampedQuality });
  return Buffer.from(arrayBuffer);
}

/**
 * Converts a Buffer to a data URL string
 */
export function toDataUrl(buffer: Buffer, mimeType: string = 'image/webp'): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
