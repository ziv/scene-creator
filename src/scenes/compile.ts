import type { BuildContext, CompiledScene, CompiledSegment, SceneDocument, SegmentType } from './types';
import { horizontalDistance } from '../geo/wgs84';
import { getSegmentType } from './registry';

export interface CompileOptions {
  /** Resolves a segment type id. Defaults to the registry; tests inject stubs. */
  resolve?: (id: string) => SegmentType;
}

/**
 * Builds every segment concurrently and lays them out end to end on a global
 * time axis. Exactly at a boundary the later segment wins, so the last frame
 * of the scene is the last segment's end pose.
 */
export async function compile(
  doc: SceneDocument,
  ctx: BuildContext,
  options: CompileOptions = {},
): Promise<CompiledScene> {
  if (doc.segments.length === 0) throw new Error('A scene needs at least one segment.');
  const resolve = options.resolve ?? getSegmentType;

  const trajectories = await Promise.all(
    doc.segments.map(async (segment, index) => {
      const type = resolve(segment.type);
      try {
        return await type.build(ctx, segment.params);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Segment ${index + 1} (${type.name}): ${message}`);
      }
    }),
  );

  const segments: CompiledSegment[] = [];
  let offset = 0;
  let length = 0;
  doc.segments.forEach((segment, i) => {
    const trajectory = trajectories[i];
    segments.push({ segment, trajectory, offset });
    offset += trajectory.duration;
    length += trajectory.length;
  });
  const duration = offset;
  const focus = segments[0].trajectory.focus;
  const radius = segments.reduce(
    (r, s) => Math.max(r, horizontalDistance(focus, s.trajectory.focus) + s.trajectory.radius),
    0,
  );

  const locate = (t: number) => {
    const clamped = Math.min(Math.max(t, 0), duration);
    let index = segments.length - 1;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (clamped < s.offset + s.trajectory.duration) {
        index = i;
        break;
      }
    }
    const s = segments[index];
    return { index, local: Math.min(clamped - s.offset, s.trajectory.duration) };
  };

  return {
    duration,
    length,
    segments,
    focus,
    radius,
    locate,
    poseAt(t) {
      const { index, local } = locate(t);
      return segments[index].trajectory.poseAt(local);
    },
  };
}
