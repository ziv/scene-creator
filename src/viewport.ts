import type { CameraPose, Geodetic } from './geo/types';

export interface Viewport {
  readonly element: google.maps.maps3d.Map3DElement;
  setPose(pose: CameraPose): void;
  /** Resolves on the next gmp-steadychange with isSteady === true (or immediately if already steady). */
  whenSteady(signal?: AbortSignal): Promise<void>;
  /** Fires with the clicked ground location. Returns an unsubscribe function. */
  onClick(handler: (p: Geodetic) => void): () => void;
  /** Fires on every steady-state change. Returns an unsubscribe function. */
  onSteadyChange(handler: (steady: boolean) => void): () => void;
  /** Fires when the map reports an error. Returns an unsubscribe function. */
  onError(handler: (message: string) => void): () => void;
  isSteady(): boolean;
}

const EPS = 1e-6;
const differs = (a: number | undefined | null, b: number) => a == null || Math.abs(a - b) > EPS;

/** Creates the Map3DElement, appends it to `container`, and wraps its camera and events. */
export async function createViewport(container: HTMLElement): Promise<Viewport> {
  const { Map3DElement, MapMode } = (await google.maps.importLibrary('maps3d')) as google.maps.Maps3DLibrary;

  const element = new Map3DElement({
    center: { lat: 43.6426, lng: -79.3871, altitude: 400 },
    range: 1500,
    tilt: 60,
    heading: 0,
    mode: MapMode.SATELLITE,
    defaultUIHidden: true,
  });
  container.append(element);

  let steady = false;
  element.addEventListener('gmp-steadychange', (event: Event) => {
    steady = (event as google.maps.maps3d.SteadyChangeEvent).isSteady;
  });

  return {
    element,
    setPose(pose) {
      const c = element.center;
      if (!c || differs(c.lat, pose.center.lat) || differs(c.lng, pose.center.lng) || differs(c.altitude, pose.center.alt)) {
        element.center = { lat: pose.center.lat, lng: pose.center.lng, altitude: pose.center.alt };
      }
      if (differs(element.range, pose.range)) element.range = pose.range;
      if (differs(element.heading, pose.heading)) element.heading = pose.heading;
      if (differs(element.tilt, pose.tilt)) element.tilt = pose.tilt;
      if (differs(element.roll, pose.roll)) element.roll = pose.roll;
    },
    whenSteady(signal) {
      if (steady) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const onChange = (event: Event) => {
          if ((event as google.maps.maps3d.SteadyChangeEvent).isSteady) done();
        };
        const done = () => {
          element.removeEventListener('gmp-steadychange', onChange);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        element.addEventListener('gmp-steadychange', onChange);
        signal?.addEventListener('abort', done, { once: true });
      });
    },
    onClick(handler) {
      const listener = (event: Event) => {
        const position = (event as google.maps.maps3d.LocationClickEvent).position;
        if (!position) return;
        handler({ lat: position.lat, lng: position.lng, alt: position.altitude });
      };
      element.addEventListener('gmp-click', listener);
      return () => element.removeEventListener('gmp-click', listener);
    },
    onSteadyChange(handler) {
      const listener = (event: Event) => handler((event as google.maps.maps3d.SteadyChangeEvent).isSteady);
      element.addEventListener('gmp-steadychange', listener);
      return () => element.removeEventListener('gmp-steadychange', listener);
    },
    onError(handler) {
      const listener = (event: Event) => {
        const err = (event as unknown as { error?: unknown }).error;
        handler(err instanceof Error ? err.message : err ? String(err) : 'Unknown map error');
      };
      element.addEventListener('gmp-error', listener);
      return () => element.removeEventListener('gmp-error', listener);
    },
    isSteady: () => steady,
  };
}
