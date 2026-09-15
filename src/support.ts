import { internals, waitForInternals } from './hooks';

export interface Support {
  ok: boolean;
  reasons: string[];
}

/** Synchronous platform checks for encoding. */
export function detectSupport(): Support {
  const reasons: string[] = [];
  if (!('VideoEncoder' in window)) reasons.push('WebCodecs video encoding is not available (Chrome or Edge needed).');
  if (!window.isSecureContext) reasons.push('Recording needs a secure context (https or localhost).');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Confirms the hooks found the map's internals and that its canvas can be
 * copied. `whenReady` should resolve once the map has rendered at least once
 * (the first steady state). Any failure yields a reason instead of a black video.
 */
export async function detectInternals(timeoutMs: number, whenReady: () => Promise<void>): Promise<Support> {
  const fail = (reason: string): Support => ({
    ok: false,
    reasons: [`Recording is unavailable: the map's internals changed (${reason}). Scrubbing still works.`],
  });
  try {
    const { root, canvas, gl } = await waitForInternals(timeoutMs);
    if (canvas.getRootNode() !== root) return fail('the webgl2 canvas is not inside the map element');
    if (!gl.getContextAttributes()?.preserveDrawingBuffer) return fail('preserveDrawingBuffer could not be enabled');
    await whenReady();
    if (!testCopy(canvas)) return fail('the canvas copy came back blank');
    return { ok: true, reasons: [] };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Copies the canvas into a small scratch canvas and checks it is not a single flat colour. */
export function testCopy(source: HTMLCanvasElement): boolean {
  const scratch = document.createElement('canvas');
  scratch.width = 64;
  scratch.height = 64;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  const first = (d[0] << 16) | (d[1] << 8) | d[2];
  for (let i = 4; i < d.length; i += 4) {
    if (((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) !== first) return true;
  }
  return false;
}

export { internals };
