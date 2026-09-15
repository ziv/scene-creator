/**
 * A small 2D map (hybrid imagery, place search) used to place scene points by
 * clicking or dragging, and to show the camera's ground track. Independent of
 * the 3D viewport so the stage keeps showing the camera preview.
 */

export interface MapMarker {
  key: string;
  /** Short label shown above the dot. */
  label: string;
  /** CSS colour. */
  color: string;
  lat: number;
  lng: number;
}

type LatLng = { lat: number; lng: number };

export interface Minimap {
  /** Replaces the point markers (creates, moves, removes as needed). */
  setMarkers(markers: MapMarker[]): void;
  /** Ground track; empty clears it. */
  setTrack(points: LatLng[]): void;
  /** Camera position at the slider's time; null hides the dot. */
  setCamera(point: LatLng | null): void;
  /** Which marker the next map click places; null disables picking. */
  setArmed(key: string | null): void;
  /** Zooms to show every marker and the track, padded. */
  fitAll(): void;
  /** Pans to a place chosen in the search box (does not move points). */
  panTo(target: google.maps.LatLngBounds | LatLng): void;
  /** Blocks picking and dragging (while recording). */
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface MinimapOptions {
  mapId: string;
  /** Map click while a marker is armed. */
  onPick(key: string, lat: number, lng: number): void;
  /** A marker was dragged to a new place. */
  onDrag(key: string, lat: number, lng: number): void;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Bounds around `points`, padded by `padFraction` of the span per side with a floor of `floorDeg`. Pure. */
export function boundsOf(points: LatLng[], padFraction = 0.5, floorDeg = 0.005): Bounds | null {
  if (points.length === 0) return null;
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  const padLat = Math.max((north - south) * padFraction, floorDeg);
  const padLng = Math.max((east - west) * padFraction, floorDeg);
  return {
    north: Math.min(north + padLat, 90),
    south: Math.max(south - padLat, -90),
    east: east + padLng,
    west: west - padLng,
  };
}

const latLngOf = (p: google.maps.LatLng | google.maps.LatLngLiteral | google.maps.LatLngAltitudeLiteral | null | undefined): LatLng | null => {
  if (!p) return null;
  return typeof (p as google.maps.LatLng).lat === 'function'
    ? { lat: (p as google.maps.LatLng).lat(), lng: (p as google.maps.LatLng).lng() }
    : { lat: (p as google.maps.LatLngLiteral).lat, lng: (p as google.maps.LatLngLiteral).lng };
};

function markerContent(label: string, color: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mm-marker';
  const text = document.createElement('span');
  text.className = 'mm-label';
  text.textContent = label;
  const dot = document.createElement('span');
  dot.className = 'mm-dot';
  dot.style.background = color;
  el.append(text, dot);
  return el;
}

function cameraContent(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mm-camera';
  return el;
}

export async function createMinimap(
  container: HTMLElement,
  searchContainer: HTMLElement,
  options: MinimapOptions,
): Promise<Minimap> {
  const [{ Map: GMap, Polyline }, { AdvancedMarkerElement }, { PlaceAutocompleteElement }] =
    await Promise.all([
      google.maps.importLibrary('maps') as Promise<google.maps.MapsLibrary>,
      google.maps.importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
      google.maps.importLibrary('places') as Promise<google.maps.PlacesLibrary>,
    ]);

  const { LatLngBounds, SymbolPath } = google.maps;
  const map = new GMap(container, {
    mapId: options.mapId,
    mapTypeId: 'hybrid',
    center: { lat: 43.6426, lng: -79.3871 },
    zoom: 12,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy',
    clickableIcons: false,
    keyboardShortcuts: false,
  });

  const markers = new globalThis.Map<string, { marker: google.maps.marker.AdvancedMarkerElement; label: string; color: string }>();
  let markerPoints: LatLng[] = [];
  let trackPoints: LatLng[] = [];
  let armed: string | null = null;
  let enabled = true;

  const track = new Polyline({
    map: null,
    strokeColor: '#ffd54f',
    strokeOpacity: 0.9,
    strokeWeight: 3,
    icons: [
      { icon: { path: SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: '#ffd54f' }, offset: '100%' },
      { icon: { path: SymbolPath.FORWARD_OPEN_ARROW, scale: 2, strokeColor: '#ffd54f' }, offset: '15%', repeat: '15%' },
    ],
  });

  const camera = new AdvancedMarkerElement({ map: null, content: cameraContent(), title: 'Camera', zIndex: 1000 });

  const clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
    if (!armed || !enabled) return;
    const p = latLngOf(event.latLng);
    if (p) options.onPick(armed, p.lat, p.lng);
  });

  const updateCursor = () => {
    map.setOptions({ draggableCursor: armed && enabled ? 'crosshair' : undefined });
  };

  // ---- Place search ---------------------------------------------------------
  const search = new PlaceAutocompleteElement();
  search.setAttribute('placeholder', 'Search a place…');
  searchContainer.append(search);
  search.addEventListener('gmp-select', async (event: Event) => {
    const prediction = (event as unknown as { placePrediction?: google.maps.places.PlacePrediction }).placePrediction;
    if (!prediction) return;
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['location', 'viewport'] });
      if (place.viewport) map.fitBounds(place.viewport, 24);
      else if (place.location) {
        map.setCenter(place.location);
        map.setZoom(14);
      }
    } catch (err) {
      console.warn('Place lookup failed', err);
    }
  });
  map.addListener('idle', () => {
    const b = map.getBounds();
    if (b) search.locationBias = b;
  });

  return {
    setMarkers(list) {
      const seen = new Set<string>();
      list.forEach((m, index) => {
        seen.add(m.key);
        let entry = markers.get(m.key);
        if (!entry) {
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: m.lat, lng: m.lng },
            content: markerContent(m.label, m.color),
            title: m.label,
            gmpDraggable: enabled,
            zIndex: 10 + index,
          });
          marker.addListener('dragend', () => {
            const p = latLngOf(marker.position);
            if (p && enabled) options.onDrag(m.key, p.lat, p.lng);
          });
          entry = { marker, label: m.label, color: m.color };
          markers.set(m.key, entry);
        } else {
          const p = latLngOf(entry.marker.position);
          if (!p || p.lat !== m.lat || p.lng !== m.lng) entry.marker.position = { lat: m.lat, lng: m.lng };
          if (entry.label !== m.label || entry.color !== m.color) {
            entry.marker.content = markerContent(m.label, m.color);
            entry.marker.title = m.label;
            entry.label = m.label;
            entry.color = m.color;
          }
        }
      });
      for (const [key, entry] of markers) {
        if (!seen.has(key)) {
          entry.marker.map = null;
          markers.delete(key);
        }
      }
      markerPoints = list.map((m) => ({ lat: m.lat, lng: m.lng }));
    },
    setTrack(points) {
      trackPoints = points;
      track.setPath(points);
      track.setMap(points.length >= 2 ? map : null);
    },
    setCamera(point) {
      if (!point) {
        camera.map = null;
        return;
      }
      camera.position = point;
      if (!camera.map) camera.map = map;
    },
    setArmed(key) {
      armed = key;
      updateCursor();
    },
    fitAll() {
      const bounds = boundsOf([...markerPoints, ...trackPoints]);
      if (!bounds) return;
      map.fitBounds(new LatLngBounds({ lat: bounds.south, lng: bounds.west }, { lat: bounds.north, lng: bounds.east }), 8);
    },
    panTo(target) {
      if (target instanceof LatLngBounds) {
        map.fitBounds(target, 24);
      } else {
        map.setCenter(target as LatLng);
        map.setZoom(14);
      }
    },
    setEnabled(value) {
      enabled = value;
      for (const { marker } of markers.values()) marker.gmpDraggable = value;
      updateCursor();
    },
    destroy() {
      clickListener.remove();
      for (const { marker } of markers.values()) marker.map = null;
      markers.clear();
      camera.map = null;
      track.setMap(null);
      search.remove();
    },
  };
}
