import type { ParamField, Params } from './scenes/types';

export interface RecordingSettings {
  version: 1;
  video: {
    /** px, even. */
    width: number;
    /** px, even. */
    height: number;
    fps: number;
    /** bits/s */
    bitrate: number;
  };
  steady: {
    /** Max wait per frame for the map to report steady, ms. Then the frame is captured anyway. */
    timeoutMs: number;
    /** Animation frames to wait after steady before copying the canvas. */
    settleFrames: number;
  };
  attribution: {
    /** Bar height as a fraction of output height. */
    barHeight: number;
  };
}

export const defaultSettings: RecordingSettings = {
  version: 1,
  video: { width: 1920, height: 1080, fps: 30, bitrate: 16_000_000 },
  steady: { timeoutMs: 20_000, settleFrames: 2 },
  attribution: { barHeight: 0.05 },
};

const STORAGE_KEY = 'scene-creator:settings:v1';

/** The "Output & quality" panel, in friendlier units than the nested settings. */
export const settingsFields: ParamField[] = [
  { kind: 'number', key: 'width', label: 'Video width', unit: 'px', min: 160, max: 7680, step: 2 },
  { kind: 'number', key: 'height', label: 'Video height', unit: 'px', min: 90, max: 4320, step: 2 },
  { kind: 'number', key: 'fps', label: 'Frame rate', unit: 'fps', min: 1, max: 120, step: 1 },
  { kind: 'number', key: 'bitrateMbps', label: 'Bitrate', unit: 'Mbit/s', min: 0.5, max: 200, step: 0.5 },
  { kind: 'number', key: 'steadyTimeoutSec', label: 'Steady timeout', unit: 's', min: 1, max: 300, step: 1 },
  { kind: 'number', key: 'settleFrames', label: 'Settle frames after steady', min: 1, max: 10, step: 1 },
  { kind: 'number', key: 'attributionPct', label: 'Attribution bar height', unit: '%', min: 3, max: 12, step: 1 },
];

export const presets: { label: string; width: number; height: number }[] = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '4K', width: 3840, height: 2160 },
  { label: 'Square 1080', width: 1080, height: 1080 },
  { label: 'Vertical 1080', width: 1080, height: 1920 },
];

export function settingsToParams(s: RecordingSettings): Params {
  return {
    width: s.video.width,
    height: s.video.height,
    fps: s.video.fps,
    bitrateMbps: s.video.bitrate / 1e6,
    steadyTimeoutSec: s.steady.timeoutMs / 1000,
    settleFrames: s.steady.settleFrames,
    attributionPct: s.attribution.barHeight * 100,
  };
}

const even = (v: number) => Math.round(v / 2) * 2;

/** Writes validated flat params back into the (mutable) settings in place. */
export function applyParams(p: Params, s: RecordingSettings): void {
  s.video.width = even(p.width as number);
  s.video.height = even(p.height as number);
  s.video.fps = Math.round(p.fps as number);
  s.video.bitrate = Math.round((p.bitrateMbps as number) * 1e6);
  s.steady.timeoutMs = Math.round((p.steadyTimeoutSec as number) * 1000);
  s.steady.settleFrames = Math.round(p.settleFrames as number);
  s.attribution.barHeight = (p.attributionPct as number) / 100;
}

const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** True if `value` is a complete, in-range RecordingSettings. */
export function isValidSettings(value: unknown): value is RecordingSettings {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<RecordingSettings>;
  if (s.version !== 1 || !s.video || !s.steady || !s.attribution) return false;
  return (
    inRange(s.video.width, 160, 7680) &&
    inRange(s.video.height, 90, 4320) &&
    inRange(s.video.fps, 1, 120) &&
    inRange(s.video.bitrate, 0.5e6, 200e6) &&
    inRange(s.steady.timeoutMs, 1000, 300_000) &&
    inRange(s.steady.settleFrames, 1, 10) &&
    inRange(s.attribution.barHeight, 0.03, 0.12)
  );
}

/** Parses stored JSON; returns null for anything that is not valid settings. */
export function parseSettings(raw: string | null): RecordingSettings | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return isValidSettings(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadSettings(): RecordingSettings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY)) ?? structuredClone(defaultSettings);
  } catch {
    return structuredClone(defaultSettings);
  }
}

export function saveSettings(s: RecordingSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable; nothing to do.
  }
}
