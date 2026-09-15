import type { CameraPose, Vec3 } from './types';
import { distance, fromEnu, normalizeHeading, toDegrees, toEnu, toGeodetic, toRadians } from './wgs84';

export interface CurveSpec {
  /** Position along the curve for u in [0, 1]; any parametrisation. */
  positionAt(u: number): Vec3;
  /** Camera orientation at a position on the curve. */
  poseAt(position: Vec3, u: number): CameraPose;
  /** Constant travel speed, m/s. */
  speed: number;
  /** Segments used to measure the curve (default 1024). */
  samples?: number;
}

export interface ConstantSpeedTrajectory {
  /** Path length in meters. */
  length: number;
  /** Seconds. */
  duration: number;
  /** Camera pose at time t in [0, duration]; clamped outside. */
  poseAt(t: number): CameraPose;
}

const MIN_LENGTH = 1;

/**
 * Turns an arbitrarily parametrised curve into a constant-speed trajectory by
 * measuring it numerically and re-parametrising by arc length.
 */
export function constantSpeedTrajectory(spec: CurveSpec): ConstantSpeedTrajectory {
  if (!(spec.speed > 0)) {
    throw new Error('Speed must be positive.');
  }
  const n = spec.samples ?? 1024;
  const cumulative = new Float64Array(n + 1);
  let prev = spec.positionAt(0);
  for (let i = 1; i <= n; i++) {
    const p = spec.positionAt(i / n);
    cumulative[i] = cumulative[i - 1] + distance(prev, p);
    prev = p;
  }
  const length = cumulative[n];
  if (!(length >= MIN_LENGTH)) {
    throw new Error('The camera path must be at least 1 m long.');
  }

  const uAtDistance = (d: number): number => {
    if (d <= 0) return 0;
    if (d >= length) return 1;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= d) lo = mid;
      else hi = mid;
    }
    const segment = cumulative[hi] - cumulative[lo];
    const f = segment > 0 ? (d - cumulative[lo]) / segment : 0;
    return (lo + f) / n;
  };

  const duration = length / spec.speed;

  return {
    length,
    duration,
    poseAt(t) {
      const frac = Math.min(Math.max(t / duration, 0), 1);
      const u = uAtDistance(frac * length);
      return spec.poseAt(spec.positionAt(u), u);
    },
  };
}

const MIN_RANGE = 1;

/** Camera at `position` looking at `target`. */
export function lookAtPose(position: Vec3, target: Vec3): CameraPose {
  const { e, n, u } = toEnu(target, position);
  const horizontal = Math.hypot(e, n);
  // Heading of the view: from the camera towards the target, i.e. the opposite of the camera's bearing from the target.
  const heading = normalizeHeading(toDegrees(Math.atan2(-e, -n)));
  const tilt = toDegrees(Math.atan2(horizontal, u));
  return {
    center: toGeodetic(target),
    range: Math.max(distance(position, target), MIN_RANGE),
    heading: horizontal < 1e-6 ? 0 : heading,
    tilt,
    roll: 0,
  };
}

/** Camera at `position` looking along heading/pitch, with the look-at point `lookAhead` meters away. */
export function aheadPose(position: Vec3, headingDeg: number, pitchDeg: number, lookAhead: number): CameraPose {
  const h = toRadians(headingDeg);
  const p = toRadians(pitchDeg);
  const e = Math.sin(h) * Math.cos(p);
  const n = Math.cos(h) * Math.cos(p);
  const u = Math.sin(p);
  const center = fromEnu(position, e * lookAhead, n * lookAhead, u * lookAhead);
  return {
    center: toGeodetic(center),
    range: lookAhead,
    heading: normalizeHeading(headingDeg),
    tilt: 90 + pitchDeg,
    roll: 0,
  };
}
