import { describe, expect, it } from 'vitest';
import { boundsOf } from '../src/minimap';

describe('boundsOf', () => {
  it('pads by half the span per side', () => {
    const b = boundsOf([
      { lat: 43.6, lng: -79.4 },
      { lat: 43.7, lng: -79.3 },
    ]);
    expect(b?.north).toBeCloseTo(43.75, 9);
    expect(b?.south).toBeCloseTo(43.55, 9);
    expect(b?.east).toBeCloseTo(-79.25, 9);
    expect(b?.west).toBeCloseTo(-79.45, 9);
  });

  it('applies the floor for a single point', () => {
    const b = boundsOf([{ lat: 10, lng: 20 }]);
    expect(b?.north).toBeCloseTo(10.005, 9);
    expect(b?.south).toBeCloseTo(9.995, 9);
    expect(b?.east).toBeCloseTo(20.005, 9);
    expect(b?.west).toBeCloseTo(19.995, 9);
  });

  it('clamps latitude to the poles and returns null for no points', () => {
    const b = boundsOf([{ lat: 89.999, lng: 0 }, { lat: 80, lng: 1 }]);
    expect(b?.north).toBe(90);
    expect(boundsOf([])).toBeNull();
  });
});
