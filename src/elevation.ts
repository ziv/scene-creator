type LatLng = { lat: number; lng: number };

/** Elevation service limit per request. */
const BATCH = 512;

const keyOf = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

export interface GroundSampler {
  (points: LatLng[]): Promise<number[]>;
  /** Non-null once the service has refused us and sea level (0 m) is being used instead. */
  readonly fallbackReason: string | null;
}

/**
 * Ground height in meters above mean sea level for each point, via the Maps
 * Elevation service. Results are memoised for the session so rebuilds that
 * only change speeds or angles make no network call.
 *
 * If the key is not allowed to use the service (REQUEST_DENIED), the sampler
 * permanently falls back to 0 m and exposes the reason so the UI can warn.
 */
export async function createGroundSampler(): Promise<GroundSampler> {
  const { ElevationService } = (await google.maps.importLibrary('elevation')) as google.maps.ElevationLibrary;
  const service = new ElevationService();
  const cache = new Map<string, number>();
  let fallbackReason: string | null = null;

  const sampler = (async (points: LatLng[]) => {
    if (fallbackReason) return points.map(() => 0);

    const missing = points.filter((p) => !cache.has(keyOf(p)));
    // Dedupe so identical points cost one location.
    const unique = [...new Map(missing.map((p) => [keyOf(p), p])).values()];

    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      let response: google.maps.LocationElevationResponse;
      try {
        response = await service.getElevationForLocations({ locations: batch });
      } catch (err) {
        const status = err instanceof Error ? err.message : String(err);
        if (/REQUEST_DENIED/.test(status)) {
          fallbackReason =
            'The Elevation API is not enabled for this key; heights are measured from sea level (0 m) instead of the ground. ' +
            'Enable "Elevation API" for the key in Google Cloud Console and reload.';
          return points.map(() => 0);
        }
        throw new Error(`Could not sample ground height (Elevation service error: ${status})`);
      }
      if (response.results.length !== batch.length) {
        throw new Error('Could not sample ground height (Elevation service returned an incomplete result)');
      }
      response.results.forEach((r, j) => cache.set(keyOf(batch[j]), r.elevation));
    }

    return points.map((p) => cache.get(keyOf(p))!);
  }) as GroundSampler;

  Object.defineProperty(sampler, 'fallbackReason', { get: () => fallbackReason });
  return sampler;
}
