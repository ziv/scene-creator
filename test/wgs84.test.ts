import { describe, expect, it } from 'vitest';
import { bearing, dot, enuFrame, fromEnu, horizontalDistance, length, toEcef, toEnu, toGeodetic } from '../src/geo/wgs84';

describe('toEcef / toGeodetic', () => {
  const grid = [
    { lat: 0, lng: 0, alt: 0 },
    { lat: 43.6426, lng: -79.3871, alt: 400 },
    { lat: 45.9763, lng: 7.6586, alt: 4478 },
    { lat: -33.8688, lng: 151.2093, alt: 50 },
    { lat: 89.9, lng: 45, alt: 1000 },
    { lat: -89.9, lng: -120, alt: -100 },
    { lat: 12.3, lng: 179.9999, alt: 10 },
    { lat: 12.3, lng: -179.9999, alt: 10 },
    { lat: 90, lng: 0, alt: 0 },
    { lat: -90, lng: 0, alt: 0 },
  ];

  it('round-trips within 1e-9 degrees and 1 mm', () => {
    for (const g of grid) {
      const back = toGeodetic(toEcef(g));
      expect(Math.abs(back.lat - g.lat)).toBeLessThan(1e-9);
      if (Math.abs(g.lat) < 90) {
        // Longitude is undefined exactly at the poles.
        const dLng = Math.abs(((back.lng - g.lng + 540) % 360) - 180);
        expect(dLng).toBeLessThan(1e-9);
      }
      expect(Math.abs(back.alt - g.alt)).toBeLessThan(1e-3);
    }
  });

  it('places the equator/prime meridian on the x axis at the semi-major axis', () => {
    const v = toEcef({ lat: 0, lng: 0, alt: 0 });
    expect(v.x).toBeCloseTo(6378137, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });
});

describe('enuFrame', () => {
  it('yields orthonormal axes with up along the surface normal', () => {
    const origin = toEcef({ lat: 43.6426, lng: -79.3871, alt: 0 });
    const f = enuFrame(origin);
    for (const axis of [f.east, f.north, f.up]) expect(length(axis)).toBeCloseTo(1, 12);
    expect(dot(f.east, f.north)).toBeCloseTo(0, 12);
    expect(dot(f.east, f.up)).toBeCloseTo(0, 12);
    expect(dot(f.north, f.up)).toBeCloseTo(0, 12);
    // Moving 100 m up along the frame's up axis raises the geodetic altitude by 100 m.
    const raised = toGeodetic(fromEnu(origin, 0, 0, 100));
    expect(raised.alt).toBeCloseTo(100, 6);
    expect(raised.lat).toBeCloseTo(43.6426, 9);
  });

  it('toEnu inverts fromEnu', () => {
    const origin = toEcef({ lat: 10, lng: 20, alt: 30 });
    const { e, n, u } = toEnu(origin, fromEnu(origin, 12.5, -7.25, 3));
    expect(e).toBeCloseTo(12.5, 6);
    expect(n).toBeCloseTo(-7.25, 6);
    expect(u).toBeCloseTo(3, 6);
  });
});

describe('bearing / horizontalDistance', () => {
  const origin = { lat: 43.6426, lng: -79.3871 };

  it('is 0 due north and 90 due east', () => {
    // East/west points on the same parallel sit a hair south of the tangent plane's
    // east axis (meridian convergence), so allow a few thousandths of a degree.
    expect(bearing(origin, { lat: origin.lat + 0.01, lng: origin.lng })).toBeCloseTo(0, 6);
    expect(bearing(origin, { lat: origin.lat, lng: origin.lng + 0.01 })).toBeCloseTo(90, 2);
    expect(bearing(origin, { lat: origin.lat - 0.01, lng: origin.lng })).toBeCloseTo(180, 6);
    expect(bearing(origin, { lat: origin.lat, lng: origin.lng - 0.01 })).toBeCloseTo(270, 2);
  });

  it('measures 0.01 degrees of latitude as about 1112 m', () => {
    const d = horizontalDistance(origin, { lat: origin.lat + 0.01, lng: origin.lng });
    expect(Math.abs(d - 1112)).toBeLessThan(1);
  });
});
