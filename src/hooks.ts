/**
 * Runtime hooks into Map3DElement's internals. Must be imported before the
 * Maps JavaScript API loads, because both hooks patch prototypes that Google's
 * code calls while creating the map.
 *
 * 1. `attachShadow` — records the map's closed shadow root.
 * 2. `getContext`   — forces `preserveDrawingBuffer: true` on the map's webgl2
 *    context so its last rendered frame can be copied at any time.
 *
 * Everything else Google requests is passed through untouched. See specs-2.md §2.
 */

export interface MapInternals {
  /** The closed shadow root of <gmp-map-3d>, once attached. */
  root: ShadowRoot | null;
  /** The webgl2 canvas under that root, once it requested its context. */
  canvas: HTMLCanvasElement | null;
  gl: WebGL2RenderingContext | null;
}

export const internals: MapInternals = { root: null, canvas: null, gl: null };

const MAP_TAG = 'GMP-MAP-3D';
const waiters: (() => void)[] = [];

function notify(): void {
  if (internals.root && internals.canvas) {
    for (const w of waiters.splice(0)) w();
  }
}

/** Resolves when both root and canvas are known, or rejects after `timeoutMs`. */
export function waitForInternals(timeoutMs: number): Promise<{ root: ShadowRoot; canvas: HTMLCanvasElement; gl: WebGL2RenderingContext }> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (internals.root && internals.canvas && internals.gl) {
        resolve({ root: internals.root, canvas: internals.canvas, gl: internals.gl });
        return true;
      }
      return false;
    };
    if (check()) return;
    const timer = window.setTimeout(() => {
      const missing = [!internals.root && 'shadow root', !internals.canvas && 'webgl2 canvas'].filter(Boolean).join(' and ');
      reject(new Error(`map ${missing} not found within ${timeoutMs / 1000} s`));
    }, timeoutMs);
    waiters.push(() => {
      window.clearTimeout(timer);
      check();
    });
  });
}

let installed = false;

export function installHooks(): void {
  if (installed) return;
  installed = true;

  const origAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
    const root = origAttach.call(this, init);
    if (this.tagName === MAP_TAG && !internals.root) {
      internals.root = root;
      notify();
    }
    return root;
  };

  const origGetContext = HTMLCanvasElement.prototype.getContext;
  // The map's canvas may not be attached to the root yet when it asks for its
  // context, so the rule is: the first webgl2 request after the map root exists
  // is the map's. The internals guard (support.ts) later confirms the canvas
  // really lives under that root.
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    attrs?: unknown,
  ): RenderingContext | null {
    if (type === 'webgl2' && internals.root && !internals.canvas) {
      const forced = { ...((attrs as Record<string, unknown> | undefined) ?? {}), preserveDrawingBuffer: true };
      const ctx = origGetContext.call(this, type, forced) as WebGL2RenderingContext | null;
      if (ctx) {
        internals.canvas = this;
        internals.gl = ctx;
        notify();
      }
      return ctx;
    }
    return origGetContext.call(this, type, attrs as never);
  } as typeof HTMLCanvasElement.prototype.getContext;
}

installHooks();
