/**
 * Bootstraps the Google Maps JavaScript API from the env key. This is the
 * official inline loader, wrapped so the channel and key live in one place.
 */

/** Release channel. `alpha` is what the original starter used and is known to serve `maps3d`. */
const CHANNEL = 'alpha';

export function readApiKey(): string | undefined {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  return key && key.trim() !== '' ? key.trim() : undefined;
}

/** Map ID for advanced markers on the 2D minimap; Google's demo ID when not configured. */
export function readMapId(): string {
  const id = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
  return id && id.trim() !== '' ? id.trim() : 'DEMO_MAP_ID';
}

let loaded: Promise<void> | null = null;

/** Injects the loader once. Resolves when `google.maps.importLibrary` is callable. */
export function loadMapsApi(key: string): Promise<void> {
  if (loaded) return loaded;
  loaded = new Promise<void>((resolve, reject) => {
    const params = new URLSearchParams({ key, v: CHANNEL, loading: 'async', callback: '__gmapsReady' });
    const w = window as unknown as Record<string, unknown>;
    w.__gmapsReady = () => {
      delete w.__gmapsReady;
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('The Google Maps JavaScript API could not load. Check the API key and network.'));
    document.head.append(script);
  });
  return loaded;
}
