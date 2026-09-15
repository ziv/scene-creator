import { describe, expect, it } from 'vitest';
import { applyParams, defaultSettings, isValidSettings, parseSettings, settingsToParams } from '../src/settings';

describe('settings', () => {
  it('round-trips the defaults through the flat form params', () => {
    const s = structuredClone(defaultSettings);
    const params = settingsToParams(s);
    expect(params).toEqual({
      width: 1920,
      height: 1080,
      fps: 30,
      bitrateMbps: 16,
      steadyTimeoutSec: 20,
      settleFrames: 2,
      attributionPct: 5,
    });
    applyParams(params, s);
    expect(s).toEqual(defaultSettings);
  });

  it('rounds odd sizes to even and converts units', () => {
    const s = structuredClone(defaultSettings);
    applyParams({ ...settingsToParams(s), width: 1281, height: 719, bitrateMbps: 2.5, steadyTimeoutSec: 7.5 }, s);
    expect(s.video.width).toBe(1282);
    expect(s.video.height).toBe(720);
    expect(s.video.bitrate).toBe(2_500_000);
    expect(s.steady.timeoutMs).toBe(7500);
  });

  it('accepts only complete, in-range, version-1 settings', () => {
    expect(isValidSettings(defaultSettings)).toBe(true);
    expect(isValidSettings({ ...defaultSettings, version: 2 })).toBe(false);
    expect(isValidSettings({ ...defaultSettings, video: { ...defaultSettings.video, width: 100 } })).toBe(false);
    expect(isValidSettings({ ...defaultSettings, steady: { timeoutMs: 20_000 } })).toBe(false);
    expect(isValidSettings(null)).toBe(false);
  });

  it('parses stored JSON and falls back to null on anything invalid', () => {
    expect(parseSettings(JSON.stringify(defaultSettings))).toEqual(defaultSettings);
    expect(parseSettings('not json')).toBeNull();
    expect(parseSettings(null)).toBeNull();
    expect(parseSettings(JSON.stringify({ version: 1 }))).toBeNull();
  });
});
