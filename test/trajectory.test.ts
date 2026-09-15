import { describe, expect, it } from 'vitest';
import { aheadPose, cameraPosition, constantSpeedTrajectory, lookAtPose, sampleTrack } from '../src/geo/trajectory';
import { distance, fromEnu, toEcef } from '../src/geo/wgs84';
import type { CameraPose, Vec3 } from '../src/geo/types';

const origin = toEcef({ lat: 43.6426, lng: -79.3871, alt: 100 });
const dummyPose = (p: Vec3): CameraPose => lookAtPose(p, origin);

describe('constantSpeedTrajectory', () => {
  it('re-parametrises an unevenly parametrised circle to uniform speed', () => {
    const r = 1000;
    const traj = constantSpeedTrajectory({
      // u^3 bunches samples near the start; arc length must undo that.
      positionAt: (u) => {
        const a = 2 * Math.PI * u ** 3;
        return fromEnu(origin, r * Math.sin(a), r * Math.cos(a), 0);
      },
      poseAt: dummyPose,
      speed: 50,
      samples: 4096,
    });
    expect(traj.length).toBeCloseTo(2 * Math.PI * r, -1); // within ~5 m
    expect(traj.duration).toBeCloseTo(traj.length / 50, 9);

    // Uniform speed on a circle means the heading advances by a constant amount per step.
    const dt = traj.duration / 200;
    const headingSteps: number[] = [];
    for (let i = 0; i < 200; i++) {
      const a = traj.poseAt(i * dt).heading;
      const b = traj.poseAt((i + 1) * dt).heading;
      headingSteps.push(((b - a + 540) % 360) - 180);
    }
    const mean = headingSteps.reduce((s, v) => s + v, 0) / headingSteps.length;
    expect(Math.abs(Math.abs(mean) - 1.8)).toBeLessThan(0.01); // 360° / 200 steps
    for (const s of headingSteps) expect(Math.abs(s - mean) / Math.abs(mean)).toBeLessThan(0.01);
  });

  it('moves at uniform speed along an uneven straight line', () => {
    const a = fromEnu(origin, 0, 0, 0);
    const b = fromEnu(origin, 3000, 0, 0);
    const positions: Vec3[] = [];
    const traj = constantSpeedTrajectory({
      positionAt: (u) => ({ x: a.x + (b.x - a.x) * u * u, y: a.y + (b.y - a.y) * u * u, z: a.z + (b.z - a.z) * u * u }),
      poseAt: (p) => {
        positions.push(p);
        return dummyPose(p);
      },
      speed: 100,
    });
    expect(traj.length).toBeCloseTo(3000, 3);
    expect(traj.duration).toBeCloseTo(30, 6);
    positions.length = 0;
    const n = 60;
    for (let i = 0; i <= n; i++) traj.poseAt((i / n) * traj.duration);
    const steps = positions.slice(1).map((p, i) => distance(positions[i], p));
    const mean = steps.reduce((s, v) => s + v, 0) / steps.length;
    for (const s of steps) expect(Math.abs(s - mean) / mean).toBeLessThan(0.01);
  });

  it('clamps time outside [0, duration]', () => {
    const traj = constantSpeedTrajectory({
      positionAt: (u) => fromEnu(origin, 1000 * u, 0, 0),
      poseAt: dummyPose,
      speed: 10,
    });
    expect(traj.poseAt(-5)).toEqual(traj.poseAt(0));
    expect(traj.poseAt(1e9)).toEqual(traj.poseAt(traj.duration));
  });

  it('rejects zero-length paths and non-positive speed', () => {
    expect(() => constantSpeedTrajectory({ positionAt: () => origin, poseAt: dummyPose, speed: 10 })).toThrow(
      /at least 1 m/,
    );
    expect(() =>
      constantSpeedTrajectory({ positionAt: (u) => fromEnu(origin, 1000 * u, 0, 0), poseAt: dummyPose, speed: 0 }),
    ).toThrow(/Speed must be positive/);
  });
});

describe('lookAtPose', () => {
  it('looks straight down from directly above', () => {
    const pose = lookAtPose(fromEnu(origin, 0, 0, 500), origin);
    expect(pose.tilt).toBeCloseTo(0, 6);
    expect(pose.range).toBeCloseTo(500, 6);
    expect(pose.center.alt).toBeCloseTo(100, 6);
  });

  it('is horizontal at the same altitude and heads towards the target', () => {
    // Camera 1000 m south of the target, looking north.
    const pose = lookAtPose(fromEnu(origin, 0, -1000, 0), origin);
    expect(pose.tilt).toBeCloseTo(90, 4);
    expect(pose.heading).toBeCloseTo(0, 4);
    // Camera east of the target looks west.
    const west = lookAtPose(fromEnu(origin, 1000, 0, 0), origin);
    expect(west.heading).toBeCloseTo(270, 4);
  });

  it('gives 45 degrees tilt at equal horizontal and vertical offsets', () => {
    const pose = lookAtPose(fromEnu(origin, 300, 400, 500), origin);
    expect(pose.tilt).toBeCloseTo(45, 6);
    expect(pose.range).toBeCloseTo(Math.hypot(500, 500), 6);
  });
});

describe('aheadPose', () => {
  it('derives tilt from pitch and keeps the look-ahead range', () => {
    const pose = aheadPose(origin, 30, -20, 800);
    expect(pose.tilt).toBeCloseTo(70, 9);
    expect(pose.range).toBe(800);
    expect(pose.heading).toBeCloseTo(30, 9);
    // Tangent-plane altitude; 750 m of horizontal travel drops ~4 cm below it from Earth's curvature.
    expect(Math.abs(pose.center.alt - (100 + 800 * Math.sin((-20 * Math.PI) / 180)))).toBeLessThan(0.1);
    expect(distance(origin, toEcef(pose.center))).toBeCloseTo(800, 3);
  });

  it('is consistent with lookAtPose', () => {
    // aheadPose works in the camera's ENU frame, lookAtPose in the target's; 1.5 km apart
    // the frames differ by about a hundredth of a degree.
    const pose = aheadPose(origin, 120, -35, 1500);
    const check = lookAtPose(origin, toEcef(pose.center));
    expect(check.heading).toBeCloseTo(pose.heading, 1);
    expect(check.tilt).toBeCloseTo(pose.tilt, 1);
    expect(check.range).toBeCloseTo(pose.range, 3);
  });
});

describe('cameraPosition', () => {
  const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
    expect(distance(a, b)).toBeLessThan(0.01);

  it('inverts lookAtPose', () => {
    for (const [e, n, u] of [
      [0, 0, 500],
      [0, -1000, 0],
      [300, 400, 500],
      [-1200, 800, 150],
    ] as const) {
      const p = fromEnu(origin, e, n, u);
      close(toEcef(cameraPosition(lookAtPose(p, origin))), p);
    }
  });

  it('inverts aheadPose to within the ENU-frame drift over the look-ahead distance', () => {
    // aheadPose works in the camera's frame and cameraPosition in the centre's; the frames
    // differ by ~0.01° over 1.5 km, which moves the answer by a few tens of centimetres.
    expect(distance(toEcef(cameraPosition(aheadPose(origin, 30, -20, 800))), origin)).toBeLessThan(0.5);
    expect(distance(toEcef(cameraPosition(aheadPose(origin, 250, -60, 1500))), origin)).toBeLessThan(1);
  });
});

describe('sampleTrack', () => {
  const scene = {
    duration: 8,
    poseAt: (t: number) => ({ center: { lat: 0, lng: t, alt: 0 }, range: 1, heading: 0, tilt: 0, roll: 0 }),
  };

  it('samples evenly in time with both ends included', () => {
    const calls: number[] = [];
    const track = sampleTrack({ duration: 8, poseAt: (t) => (calls.push(t), scene.poseAt(t)) }, 5);
    expect(calls).toEqual([0, 2, 4, 6, 8]);
    expect(track).toHaveLength(5);
  });

  it('returns only the start for a single sample', () => {
    const calls: number[] = [];
    sampleTrack({ duration: 8, poseAt: (t) => (calls.push(t), scene.poseAt(t)) }, 1);
    expect(calls).toEqual([0]);
  });
});
