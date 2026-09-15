import { defineSegment, type Waypoint } from './types';
import { constantSpeedTrajectory, lookAtPose } from '../geo/trajectory';
import { fromEnu, toEcef, toRadians } from '../geo/wgs84';

interface OrbitParams extends Record<string, Waypoint | number | string> {
  center: Waypoint;
  startRadius: number;
  endRadius: number;
  startHeight: number;
  endHeight: number;
  startBearing: number;
  sweep: number;
  direction: 'cw' | 'ccw';
  speed: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Cinematic orbit: the camera circles the centre point while the radius and
 * height ease from their start to end values, keeping the centre framed.
 */
export const cinematicOrbit = defineSegment<OrbitParams>({
  id: 'orbit',
  name: 'Cinematic orbit',
  description:
    'Circles the centre point while closing in: radius and height move from their start to end values over the sweep. The camera always looks at the centre.',
  fields: [
    { kind: 'point', key: 'center', label: 'Centre (camera target)', color: '#f44336', heightLabel: 'Look-at height above ground' },
    { kind: 'number', key: 'startRadius', label: 'Start radius', unit: 'm', min: 1, max: 200_000, step: 50 },
    { kind: 'number', key: 'endRadius', label: 'End radius', unit: 'm', min: 1, max: 200_000, step: 50 },
    { kind: 'number', key: 'startHeight', label: 'Start height above centre ground', unit: 'm', min: -1000, max: 50_000, step: 25 },
    { kind: 'number', key: 'endHeight', label: 'End height above centre ground', unit: 'm', min: -1000, max: 50_000, step: 25 },
    { kind: 'number', key: 'startBearing', label: 'Start bearing from centre', unit: '° from N', min: -360, max: 360, step: 5 },
    { kind: 'number', key: 'sweep', label: 'Sweep', unit: '°', min: 1, max: 1080, step: 15 },
    {
      kind: 'select',
      key: 'direction',
      label: 'Direction',
      options: [
        { value: 'cw', label: 'Clockwise (seen from above)' },
        { value: 'ccw', label: 'Counter-clockwise' },
      ],
    },
    { kind: 'number', key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 5000, step: 5 },
  ],
  defaults: {
    center: { lat: 43.6426, lng: -79.3871, height: 150 },
    startRadius: 1500,
    endRadius: 600,
    startHeight: 600,
    endHeight: 300,
    startBearing: 200,
    sweep: 270,
    direction: 'cw',
    speed: 60,
  },
  async build(ctx, params) {
    const [groundC] = await ctx.sampleGround([params.center]);
    const { lat, lng } = params.center;
    const origin = toEcef({ lat, lng, alt: groundC });
    const target = toEcef({ lat, lng, alt: groundC + params.center.height });
    const sign = params.direction === 'ccw' ? -1 : 1;

    // Smoothstep easing on radius/height so the approach starts and ends gently.
    const ease = (u: number) => u * u * (3 - 2 * u);

    const positionAt = (u: number) => {
      const e = ease(u);
      const r = lerp(params.startRadius, params.endRadius, e);
      const h = lerp(params.startHeight, params.endHeight, e);
      const b = toRadians(params.startBearing + sign * params.sweep * u);
      return fromEnu(origin, r * Math.sin(b), r * Math.cos(b), h);
    };

    const core = constantSpeedTrajectory({
      positionAt,
      poseAt: (position) => lookAtPose(position, target),
      speed: params.speed,
      samples: 2048,
    });

    return {
      ...core,
      focus: { lat, lng, alt: groundC },
      radius: Math.max(params.startRadius, params.endRadius),
      notes: [
        `Ground at centre ${groundC.toFixed(0)} m`,
        `Radius ${params.startRadius} → ${params.endRadius} m, height ${params.startHeight} → ${params.endHeight} m over ${params.sweep}°`,
      ],
    };
  },
});
