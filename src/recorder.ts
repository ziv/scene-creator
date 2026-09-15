import type { CameraPose } from './geo/types';
import type { CompiledScene } from './scenes/types';
import type { RecordingSettings } from './settings';

export type RecordPhase = 'warm-up' | 'recording' | 'encoding';

export interface RecordProgress {
  phase: RecordPhase;
  frame: number;
  frameCount: number;
  etaSeconds: number | null;
  steadyTimeouts: number;
}

/** Thrown when a recording is cancelled through its AbortSignal. */
export class RecordingCancelled extends Error {
  constructor() {
    super('Recording cancelled.');
    this.name = 'RecordingCancelled';
  }
}

export interface FramePlan {
  /** Both endpoints included, at least 2. */
  frameCount: number;
  /** Scene time for frame i; the last frame lands exactly on the duration. */
  timeAt(frame: number): number;
}

export function planFrames(duration: number, fps: number): FramePlan {
  const frameCount = Math.max(2, Math.ceil(duration * fps) + 1);
  return {
    frameCount,
    timeAt: (frame) => Math.min(frame / fps, duration),
  };
}

export interface FrameRecorderDeps {
  /** Sets the pose and waits for the map to be steady. Resolves false on timeout; rejects on abort. */
  settle(pose: CameraPose, signal: AbortSignal): Promise<boolean>;
  /** Waits `count` animation frames; rejects on abort. */
  waitFrames(count: number, signal: AbortSignal): Promise<void>;
  /** Copies the map canvas and draws attribution onto the output canvas. */
  grab(): void;
  /** Encodes the output canvas as frame `index`. */
  addFrame(index: number): Promise<void>;
  /** Milliseconds clock, injectable for tests. */
  now(): number;
}

export interface RecordResult {
  frameCount: number;
  steadyTimeouts: number;
}

/**
 * The recording sequencer: for every frame, set the pose, wait for the map to
 * settle, copy the canvas, encode. Contains no DOM, WebGL or media code.
 */
export async function recordFrames(
  scene: CompiledScene,
  settings: RecordingSettings,
  deps: FrameRecorderDeps,
  onProgress: (p: RecordProgress) => void,
  signal: AbortSignal,
): Promise<RecordResult> {
  const throwIfCancelled = () => {
    if (signal.aborted) throw new RecordingCancelled();
  };
  const plan = planFrames(scene.duration, settings.video.fps);
  const { settleFrames } = settings.steady;
  let steadyTimeouts = 0;

  try {
    onProgress({ phase: 'warm-up', frame: 0, frameCount: plan.frameCount, etaSeconds: null, steadyTimeouts });
    await deps.settle(scene.poseAt(0), signal);
    await deps.waitFrames(settleFrames, signal);
    throwIfCancelled();

    const startedAt = deps.now();
    for (let frame = 0; frame < plan.frameCount; frame++) {
      throwIfCancelled();
      const steady = await deps.settle(scene.poseAt(plan.timeAt(frame)), signal);
      if (!steady) steadyTimeouts++;
      await deps.waitFrames(settleFrames, signal);
      throwIfCancelled();
      deps.grab();
      await deps.addFrame(frame);

      const done = frame + 1;
      const elapsed = (deps.now() - startedAt) / 1000;
      const etaSeconds = frame > 0 ? (elapsed / done) * (plan.frameCount - done) : null;
      onProgress({ phase: 'recording', frame: done, frameCount: plan.frameCount, etaSeconds, steadyTimeouts });
    }

    throwIfCancelled();
    onProgress({ phase: 'encoding', frame: plan.frameCount, frameCount: plan.frameCount, etaSeconds: null, steadyTimeouts });
    return { frameCount: plan.frameCount, steadyTimeouts };
  } catch (err) {
    if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw new RecordingCancelled();
    throw err;
  }
}
