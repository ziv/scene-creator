import { describe, expect, it } from 'vitest';
import { compile } from '../src/scenes/compile';
import type { BuildContext, SceneDocument, SegmentType, Trajectory } from '../src/scenes/types';
import type { CameraPose } from '../src/geo/types';

const poseFor = (tag: number, t: number): CameraPose => ({
  center: { lat: tag, lng: t, alt: 0 },
  range: 1,
  heading: 0,
  tilt: 0,
  roll: 0,
});

function stubType(id: string, duration: number, tag: number): SegmentType {
  const trajectory: Trajectory = {
    length: duration * 10,
    duration,
    poseAt: (t) => poseFor(tag, Math.min(Math.max(t, 0), duration)),
    focus: { lat: 43.6426, lng: -79.3871, alt: 0 },
    radius: 100,
    notes: [],
  };
  return {
    id,
    name: `Stub ${id}`,
    description: '',
    fields: [],
    defaults: {},
    build: async () => trajectory,
  };
}

const ctx: BuildContext = { sampleGround: async (points) => points.map(() => 0) };

const types: Record<string, SegmentType> = {
  a: stubType('a', 3, 1),
  b: stubType('b', 5, 2),
};
const resolve = (id: string) => {
  const t = types[id];
  if (!t) throw new Error(`Unknown segment type "${id}"`);
  return t;
};

const doc: SceneDocument = {
  version: 1,
  id: 'doc',
  name: 'two segments',
  segments: [
    { id: 's1', type: 'a', params: {}, join: { kind: 'cut' } },
    { id: 's2', type: 'b', params: {}, join: { kind: 'cut' } },
  ],
};

describe('compile', () => {
  it('lays segments out end to end on a global time axis', async () => {
    const scene = await compile(doc, ctx, { resolve });
    expect(scene.duration).toBe(8);
    expect(scene.length).toBe(80);
    expect(scene.segments.map((s) => s.offset)).toEqual([0, 3]);
  });

  it('locates global times, with the later segment winning at a boundary', async () => {
    const scene = await compile(doc, ctx, { resolve });
    expect(scene.locate(2.9)).toEqual({ index: 0, local: 2.9 });
    expect(scene.locate(3)).toEqual({ index: 1, local: 0 });
    expect(scene.locate(99)).toEqual({ index: 1, local: 5 });
    expect(scene.locate(-1)).toEqual({ index: 0, local: 0 });
  });

  it('delegates poseAt to the right trajectory with local time', async () => {
    const scene = await compile(doc, ctx, { resolve });
    expect(scene.poseAt(1)).toEqual(poseFor(1, 1));
    expect(scene.poseAt(4.5)).toEqual(poseFor(2, 1.5));
    expect(scene.poseAt(8)).toEqual(poseFor(2, 5));
  });

  it('prefixes build errors with the segment position', async () => {
    const failing: SegmentType = {
      ...stubType('bad', 1, 0),
      build: async () => {
        throw new Error('boom');
      },
    };
    const bad: SceneDocument = { ...doc, segments: [doc.segments[0], { ...doc.segments[1], type: 'bad' }] };
    await expect(compile(bad, ctx, { resolve: (id) => (id === 'bad' ? failing : resolve(id)) })).rejects.toThrow(
      'Segment 2 (Stub bad): boom',
    );
  });

  it('rejects an empty scene', async () => {
    await expect(compile({ ...doc, segments: [] }, ctx, { resolve })).rejects.toThrow(/at least one segment/);
  });
});
