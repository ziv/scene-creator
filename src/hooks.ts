/**
 * Runtime hooks into Map3DElement's internals. Must be imported before the
 * Maps JavaScript API loads, because both hooks patch prototypes that Google's
 * code calls while creating the map.
 *
 * 1. `attachShadow` — records the map's closed shadow root.
 * 2. `getContext`   — forces `preserveDrawingBuffer: true` on every webgl2
 *    context in the page and remembers the canvases, so the map's last
 *    rendered frame can be copied at any time.
 *
 * The map's canvas is identified lazily as the recorded webgl2 canvas that
 * lives inside the map's shadow root: the order in which Google attaches the
 * root and requests the context is not stable, and the 2D minimap (a vector
 * map) also creates a webgl2 context. Everything else Google requests is passed
 * through untouched. See specs-2.md §2.
 */

export interface MapInternals {
  /** The closed shadow root of <gmp-map-3d>, once attached. */
  root: ShadowRoot | null;
  /** The webgl2 canvas under that root, once identified. */
  canvas: HTMLCanvasElement | null;
  gl: WebGL2RenderingContext | null;
}

export const internals: MapInternals = { root: null, canvas: null, gl: null };

const MAP_TAG = 'GMP-MAP-3D';
const candidates: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext }[] = [];

/** Identifies the map's canvas among the recorded webgl2 canvases. True once known. */
export function resolveInternals(): boolean {
  if (internals.canvas) return true;
  if (!internals.root) return false;
  const hit = candidates.find((c) => c.canvas.getRootNode() === internals.root);
  if (!hit) return false;
  internals.canvas = hit.canvas;
  internals.gl = hit.gl;
  return true;
}

/** Resolves when both root and canvas are known, or rejects after `timeoutMs`. Polls, since attachment happens asynchronously. */
export function waitForInternals(timeoutMs: number): Promise<{ root: ShadowRoot; canvas: HTMLCanvasElement; gl: WebGL2RenderingContext }> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    const tick = () => {
      if (resolveInternals()) {
        resolve({ root: internals.root!, canvas: internals.canvas!, gl: internals.gl! });
      } else if (performance.now() > deadline) {
        const missing = !internals.root
          ? 'shadow root'
          : candidates.length === 0
            ? 'webgl2 canvas (none created)'
            : `webgl2 canvas inside the map (${candidates.length} elsewhere)`;
        reject(new Error(`map ${missing} not found within ${timeoutMs / 1000} s`));
      } else {
        window.setTimeout(tick, 100);
      }
    };
    tick();
  });
}

let installed = false;

export function installHooks(): void {
  if (installed) return;
  installed = true;

  const origAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = origAttach.call(this, init);
    if (this.tagName === MAP_TAG && !internals.root) internals.root = root;
    return root;
  };

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    attrs?: unknown,
  ): RenderingContext | null {
    if (type === 'webgl2') {
      const forced = { ...((attrs as Record<string, unknown> | undefined) ?? {}), preserveDrawingBuffer: true };
      const ctx = origGetContext.call(this, type, forced) as WebGL2RenderingContext | null;
      if (ctx && !candidates.some((c) => c.canvas === this)) candidates.push({ canvas: this, gl: ctx });
      return ctx;
    }
    return origGetContext.call(this, type, attrs as never);
  } as typeof HTMLCanvasElement.prototype.getContext;
}

installHooks();
