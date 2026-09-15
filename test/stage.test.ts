import { describe, expect, it } from 'vitest';
import { layoutStage } from '../src/stage';

describe('layoutStage', () => {
  it('lays out at output / dpr and scales to fit the smaller dimension', () => {
    const l = layoutStage(1920, 1080, 2, 1000, 500);
    expect(l.cssWidth).toBe(960);
    expect(l.cssHeight).toBe(540);
    expect(l.scale).toBeCloseTo(500 / 540, 9);
  });

  it('never scales above 1', () => {
    expect(layoutStage(1280, 720, 1, 2000, 2000).scale).toBe(1);
  });

  it('uses the tighter of the two constraints', () => {
    const l = layoutStage(3840, 2160, 2, 1085, 421);
    expect(l.scale).toBeCloseTo(421 / 1080, 9);
    expect(l.cssWidth * l.scale).toBeLessThanOrEqual(1085);
    expect(l.cssHeight * l.scale).toBeLessThanOrEqual(421);
  });

  it('survives a zero-sized viewport', () => {
    expect(layoutStage(1920, 1080, 2, 0, 0).scale).toBe(1);
  });
});
