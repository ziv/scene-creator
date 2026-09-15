import type { Geodetic, Vec3 } from './types';

/** WGS84 ellipsoid. */
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const B = A * (1 - F);

export const toRadians = (deg: number): number => (deg * Math.PI) / 180;
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI;

/** Normalises a heading to [0, 360). */
export function normalizeHeading(deg: number): number {
  const h = deg % 360;
  return h < 0 ? h + 360 : h;
}

// ---- Vec3 ops ---------------------------------------------------------------

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l === 0) throw new Error('Cannot normalise a zero vector.');
  return scale(a, 1 / l);
}
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

// ---- Geodetic <-> ECEF ------------------------------------------------------

/** Geodetic (degrees, meters above the ellipsoid) to ECEF meters. */
export function toEcef(g: Geodetic): Vec3 {
  const lat = toRadians(g.lat);
  const lng = toRadians(g.lng);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + g.alt) * cosLat * Math.cos(lng),
    y: (n + g.alt) * cosLat * Math.sin(lng),
    z: (n * (1 - E2) + g.alt) * sinLat,
  };
}

/** ECEF meters to geodetic. Bowring's closed form plus Newton refinement; well under 1 mm error. */
export function toGeodetic(v: Vec3): Geodetic {
  const lng = Math.atan2(v.y, v.x);
  const p = Math.hypot(v.x, v.y);
  if (p < 1e-9) {
    // On the polar axis.
    const alt = Math.abs(v.z) - B;
    return { lat: v.z >= 0 ? 90 : -90, lng: toDegrees(lng), alt };
  }
  // Bowring initial estimate.
  const ep2 = (A * A - B * B) / (B * B);
  const theta = Math.atan2(v.z * A, p * B);
  let lat = Math.atan2(
    v.z + ep2 * B * Math.sin(theta) ** 3,
    p - E2 * A * Math.cos(theta) ** 3,
  );
  // A few Newton iterations to polish.
  for (let i = 0; i < 4; i++) {
    const sinLat = Math.sin(lat);
    const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
    const h = p / Math.cos(lat) - n;
    lat = Math.atan2(v.z, p * (1 - (E2 * n) / (n + h)));
  }
  const sinLat = Math.sin(lat);
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const cosLat = Math.cos(lat);
  const alt = Math.abs(cosLat) > 1e-10 ? p / cosLat - n : Math.abs(v.z) / Math.abs(sinLat) - n * (1 - E2);
  return { lat: toDegrees(lat), lng: toDegrees(lng), alt };
}

// ---- Local frames -----------------------------------------------------------

export interface EnuFrame {
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

/** Local east/north/up unit axes at `origin` (ECEF). */
export function enuFrame(origin: Vec3): EnuFrame {
  const g = toGeodetic(origin);
  const lat = toRadians(g.lat);
  const lng = toRadians(g.lng);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLng = Math.sin(lng);
  const cosLng = Math.cos(lng);
  return {
    east: { x: -sinLng, y: cosLng, z: 0 },
    north: { x: -sinLat * cosLng, y: -sinLat * sinLng, z: cosLat },
    up: { x: cosLat * cosLng, y: cosLat * sinLng, z: sinLat },
  };
}

/** ECEF point `v` expressed in the ENU frame at `origin`, meters. */
export function toEnu(origin: Vec3, v: Vec3): { e: number; n: number; u: number } {
  const f = enuFrame(origin);
  const d = sub(v, origin);
  return { e: dot(d, f.east), n: dot(d, f.north), u: dot(d, f.up) };
}

/** ECEF point for local ENU offsets (meters) from `origin`. */
export function fromEnu(origin: Vec3, e: number, n: number, u: number): Vec3 {
  const f = enuFrame(origin);
  return add(origin, add(add(scale(f.east, e), scale(f.north, n)), scale(f.up, u)));
}

// ---- Bearings & distances ---------------------------------------------------

type LatLng = { lat: number; lng: number };

/** Initial bearing from `from` to `to`, degrees clockwise from north in [0, 360). Altitude is ignored. */
export function bearing(from: LatLng, to: LatLng): number {
  const origin = toEcef({ lat: from.lat, lng: from.lng, alt: 0 });
  const target = toEcef({ lat: to.lat, lng: to.lng, alt: 0 });
  const { e, n } = toEnu(origin, target);
  return normalizeHeading(toDegrees(Math.atan2(e, n)));
}

/** Horizontal (ENU plane) distance between two points, meters. Accurate for legs up to tens of km. */
export function horizontalDistance(a: LatLng, b: LatLng): number {
  const origin = toEcef({ lat: a.lat, lng: a.lng, alt: 0 });
  const target = toEcef({ lat: b.lat, lng: b.lng, alt: 0 });
  const { e, n } = toEnu(origin, target);
  return Math.hypot(e, n);
}
