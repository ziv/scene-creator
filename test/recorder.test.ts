import { describe, expect, it } from 'vitest';
import { planFrames, recordFrames, RecordingCancelled, type FrameRecorderDeps, type RecordProgress } from '../src/recorder';
import { defaultSettings, type RecordingSettings } from '../src/settings';
import type { CompiledScene } from '../src/scenes/types';
import type { CameraPose } from '../src/geo/types';

const poseAt = (t: number): CameraPose => ({ center: { lat: 0, lng: t, alt: 0 }, range: 1, heading: 0, tilt: 0, roll: 0 });

function stubScene(duration: number): CompiledScene {
  return {
    duration,
    length: duration * 10,
    segments: [],
    poseAt,
    locate: (t) => ({ index: 0, local: t }),
    focus: { lat: 0, lng: 0, alt: 0 },
    radius: 100,
  };
}

function settingsWith(fps: number, settleFrames = 2): RecordingSettings {
  const s = structuredClone(defaultSettings);
  s.video.fps = fps;
  s.steady.settleFrames = settleFrames;
  return s;
}

interface Harness {
  deps: FrameRecorderDeps;
  log: string[];
  progress: RecordProgress[];
}

function harness(opts: { steadyResults?: boolean[]; abortOnFrame?: number; controller?: AbortController } = {}): Harness {
  const log: string[] = [];
  let clock = 0;
  let settleCalls = 0;
  const deps: FrameRecorderDeps = {
    async settle(pose) {
      const i = settleCalls++;
      log.push(`settle(${pose.center.lng})`);
      if (opts.abortOnFrame !== undefined && i === opts.abortOnFrame + 1) opts.controller?.abort(); // +1: warm-up call
      clock += 100;
      return opts.steadyResults?.[i] ?? true;
    },
    async waitFrames(count) {
      log.push(`waitFrames(${count})`);
    },
    grab() {
      log.push('grab');
    },
    async addFrame(index) {
      log.push(`addFrame(${index})`);
    },
    now: () => clock,
  };
  return { deps, log, progress: [] };
}

describe('planFrames', () => {
  it('includes both endpoints and lands the last frame on the duration', () => {
    const plan = planFrames(10, 30);
    expect(plan.frameCount).toBe(301);
    expect(plan.timeAt(0)).toBe(0);
    expect(plan.timeAt(150)).toBe(5);
    expect(plan.timeAt(300)).toBe(10);
  });

  it('never plans fewer than two frames', () => {
    const plan = planFrames(0.01, 30);
    expect(plan.frameCount).toBe(2);
    expect(plan.timeAt(1)).toBe(0.01);
  });
});

describe('recordFrames', () => {
  it('records every frame in order with settle → waitFrames → grab → addFrame', async () => {
    const h = harness();
    const result = await recordFrames(stubScene(1), settingsWith(10), h.deps, (p) => h.progress.push(p), new AbortController().signal);

    expect(result).toEqual({ frameCount: 11, steadyTimeouts: 0 });
    // Warm-up, then 11 frames × 4 calls.
    expect(h.log.slice(0, 2)).toEqual(['settle(0)', 'waitFrames(2)']);
    const perFrame = h.log.slice(2);
    expect(perFrame).toHaveLength(44);
    for (let i = 0; i < 11; i++) {
      const t = Math.min(i / 10, 1);
      expect(perFrame.slice(i * 4, i * 4 + 4)).toEqual([`settle(${t})`, 'waitFrames(2)', 'grab', `addFrame(${i})`]);
    }
    expect(h.progress[0].phase).toBe('warm-up');
    const recordingFrames = h.progress.filter((p) => p.phase === 'recording').map((p) => p.frame);
    expect(recordingFrames).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(h.progress.at(-1)?.phase).toBe('encoding');
  });

  it('counts steady timeouts', async () => {
    // Index 0 is the warm-up settle; frames 2 and 5 time out.
    const steadyResults = Array.from({ length: 12 }, (_, i) => !(i === 3 || i === 6));
    const h = harness({ steadyResults });
    const result = await recordFrames(stubScene(1), settingsWith(10), h.deps, (p) => h.progress.push(p), new AbortController().signal);
    expect(result.steadyTimeouts).toBe(2);
    expect(h.progress.at(-1)?.steadyTimeouts).toBe(2);
  });

  it('stops promptly with RecordingCancelled when aborted', async () => {
    const controller = new AbortController();
    const h = harness({ abortOnFrame: 5, controller });
    await expect(
      recordFrames(stubScene(1), settingsWith(10), h.deps, (p) => h.progress.push(p), controller.signal),
    ).rejects.toBeInstanceOf(RecordingCancelled);
    const added = h.log.filter((l) => l.startsWith('addFrame')).length;
    expect(added).toBeLessThanOrEqual(5);
  });

  it('reports a null ETA on the first frame and a positive one afterwards', async () => {
    const h = harness();
    await recordFrames(stubScene(1), settingsWith(10), h.deps, (p) => h.progress.push(p), new AbortController().signal);
    const rec = h.progress.filter((p) => p.phase === 'recording');
    expect(rec[0].etaSeconds).toBeNull();
    expect(rec[1].etaSeconds).toBeGreaterThan(0);
    expect(rec.at(-1)?.etaSeconds).toBe(0);
  });
});
