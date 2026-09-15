import { defineSegment, type Waypoint } from './types';
import { aheadPose, constantSpeedTrajectory } from '../geo/trajectory';
import { bearing, lerp, toEcef } from '../geo/wgs84';

interface FlyOverParams extends Record<string, Waypoint | number> {
  start: Waypoint;
  end: Waypoint;
  pitch: number;
  lookAhead: number;
  speed: number;
}

/** Pilot's view: straight from A to B, looking ahead along the route with a fixed pitch. */
export const flyOver = defineSegment<FlyOverParams>({
  id: 'flyover',
  name: 'Fly-over',
  description:
    'Flies in a straight line from the start to the end point looking ahead along the route, tilted down by the chosen pitch. Like a cockpit or drone forward view.',
  fields: [
    { kind: 'point', key: 'start', label: 'Start point', color: '#76ff03' },
    { kind: 'point', key: 'end', label: 'End point', color: '#29b6f6' },
    // Max 0: a look-ahead point above the camera would invert the orbit camera model (tilt > 90).
    { kind: 'number', key: 'pitch', label: 'Camera pitch (negative = down)', unit: '°', min: -89, max: 0, step: 5 },
    { kind: 'number', key: 'lookAhead', label: 'Look-ahead distance', unit: 'm', min: 50, max: 20_000, step: 50 },
    { kind: 'number', key: 'speed', label: 'Speed', unit: 'm/s', min: 1, max: 5000, step: 5 },
  ],
  defaults: {
    start: { lat: 43.62, lng: -79.41, height: 400 },
    end: { lat: 43.66, lng: -79.37, height: 300 },
    pitch: -20,
    lookAhead: 800,
    speed: 80,
  },
  async build(ctx, params) {
    const [gS, gE] = await ctx.sampleGround([params.start, params.end]);
    const start = toEcef({ lat: params.start.lat, lng: params.start.lng, alt: gS + params.start.height });
    const end = toEcef({ lat: params.end.lat, lng: params.end.lng, alt: gE + params.end.height });
    // Constant along a straight leg.
    const heading = bearing(params.start, params.end);

    const core = constantSpeedTrajectory({
      positionAt: (u) => lerp(start, end, u),
      poseAt: (position) => aheadPose(position, heading, params.pitch, params.lookAhead),
      speed: params.speed,
      samples: 1,
    });

    return {
      ...core,
      focus: {
        lat: (params.start.lat + params.end.lat) / 2,
        lng: (params.start.lng + params.end.lng) / 2,
        alt: (gS + gE) / 2,
      },
      radius: core.length / 2,
      notes: [`Ground at start ${gS.toFixed(0)} m, at end ${gE.toFixed(0)} m`, `Heading ${heading.toFixed(0)}°`],
    };
  },
});
