import { defineSegment, type Waypoint } from './types';
import { constantSpeedTrajectory, lookAtPose } from '../geo/trajectory';
import { horizontalDistance, lerp, toEcef } from '../geo/wgs84';

interface FlyByParams extends Record<string, Waypoint | number> {
  start: Waypoint;
  end: Waypoint;
  target: Waypoint;
  speed: number;
}

/** Straight pass from A to B while the camera stays locked on a separate point C. */
export const flyBy = defineSegment<FlyByParams>({
  id: 'flyby',
  name: 'Fly-by',
  description:
    'Flies in a straight line from the start to the end point while the camera stays locked on a separate target.',
  fields: [
    { kind: 'point', key: 'start', label: 'Start point', color: '#76ff03' },
    { kind: 'point', key: 'end', label: 'End point', color: '#29b6f6' },
    { kind: 'point', key: 'target', label: 'Camera target', color: '#f44336', heightLabel: 'Look-at height above ground' },
    { kind: 'number', key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 5000, step: 5 },
  ],
  defaults: {
    start: { lat: 43.63, lng: -79.4, height: 500 },
    end: { lat: 43.655, lng: -79.375, height: 500 },
    target: { lat: 43.6426, lng: -79.3871, height: 150 },
    speed: 80,
  },
  async build(ctx, params) {
    const [gS, gE, gT] = await ctx.sampleGround([params.start, params.end, params.target]);
    const start = toEcef({ lat: params.start.lat, lng: params.start.lng, alt: gS + params.start.height });
    const end = toEcef({ lat: params.end.lat, lng: params.end.lng, alt: gE + params.end.height });
    const target = toEcef({ lat: params.target.lat, lng: params.target.lng, alt: gT + params.target.height });

    // A straight ECEF chord sits a few centimetres below the great-circle path
    // for a 5 km leg, which is invisible and simpler than a geodesic.
    const core = constantSpeedTrajectory({
      positionAt: (u) => lerp(start, end, u),
      poseAt: (position) => lookAtPose(position, target),
      speed: params.speed,
      samples: 1,
    });

    return {
      ...core,
      focus: { lat: params.target.lat, lng: params.target.lng, alt: gT },
      radius: Math.max(horizontalDistance(params.target, params.start), horizontalDistance(params.target, params.end)),
      notes: [`Ground at start ${gS.toFixed(0)} m, at end ${gE.toFixed(0)} m, at target ${gT.toFixed(0)} m`],
    };
  },
});
