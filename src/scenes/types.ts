import type { CameraPose, Geodetic } from '../geo/types';

/** A point the user places. `height` is meters ABOVE GROUND at that lat/lng. */
export interface Waypoint {
  lat: number;
  lng: number;
  height: number;
}

export type ParamValue = Waypoint | number | string;
export type Params = Record<string, ParamValue>;

// ---- Parameter schema (drives the form) ------------------------------------

export interface PointField {
  kind: 'point';
  key: string;
  label: string;
  /** Marker colour (CSS colour). */
  color: string;
  /** Label for the height input (defaults to "Height above ground"). */
  heightLabel?: string;
}

export interface NumberField {
  kind: 'number';
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
}

export interface SelectField {
  kind: 'select';
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type ParamField = PointField | NumberField | SelectField;

// ---- Trajectory (a built, scrubbable segment) -------------------------------

export interface Trajectory {
  /** Path length in meters. */
  length: number;
  /** Seconds. */
  duration: number;
  /** Camera pose at time t in [0, duration]. Clamped outside. */
  poseAt(t: number): CameraPose;
  /** Centre of interest: used to frame the initial view and, later, sky/clouds. */
  focus: Geodetic;
  /** Horizontal extent from focus, meters. */
  radius: number;
  /** Human-readable details for the summary line. */
  notes: string[];
}

// ---- Segment type (the plug-in contract) ------------------------------------

export interface BuildContext {
  /** Ground height in meters above mean sea level for each point, in order. */
  sampleGround(points: { lat: number; lng: number }[]): Promise<number[]>;
}

export interface SegmentType<P extends Params = Params> {
  id: string;
  name: string;
  /** One or two sentences shown under the scene selector. */
  description: string;
  fields: ParamField[];
  defaults: P;
  /** Resolves ground heights and returns the motion. Throws with a user-facing message if params are unusable. */
  build(ctx: BuildContext, params: P): Promise<Trajectory>;
}

/** Helper so segment modules can declare typed params while the registry stays untyped. */
export function defineSegment<P extends Params>(s: SegmentType<P>): SegmentType {
  return s as unknown as SegmentType;
}

// ---- Scene document (the composite structure) --------------------------------

export interface SceneDocument {
  version: 1;
  id: string;
  name: string;
  /** Played in order; must have length >= 1. */
  segments: SceneSegment[];
}

export type SegmentJoin = { kind: 'cut' } | { kind: 'blend'; seconds: number };

export interface SceneSegment {
  /** Stable across edits (needed for a future reorder UI). */
  id: string;
  /** SegmentType.id */
  type: string;
  /** Validated against the type's fields. */
  params: Params;
  /** How this segment connects to the previous one. Milestone 1 supports only 'cut'. */
  join: SegmentJoin;
}

// ---- Compiled scene --------------------------------------------------------

export interface CompiledSegment {
  segment: SceneSegment;
  trajectory: Trajectory;
  /** Global start time, seconds. */
  offset: number;
}

export interface CompiledScene {
  /** Sum of segment durations. */
  duration: number;
  /** Sum of segment path lengths, meters. */
  length: number;
  segments: CompiledSegment[];
  /** Global pose. For 'cut' joins: the segment whose [offset, offset+duration) contains t. */
  poseAt(t: number): CameraPose;
  /** (segment index, local t) for the given global t. */
  locate(t: number): { index: number; local: number };
  /** First segment's focus. */
  focus: Geodetic;
  /** Horizontal extent from focus covering every segment, meters. */
  radius: number;
}

/** Stored params are only trusted if every field is present with the right shape. */
export function paramsMatchSchema(fields: ParamField[], params: unknown): params is Params {
  if (typeof params !== 'object' || params === null) return false;
  const p = params as Record<string, unknown>;
  return fields.every((f) => {
    const v = p[f.key];
    if (f.kind === 'point') {
      const w = v as Partial<Waypoint> | undefined;
      return (
        typeof w === 'object' &&
        w !== null &&
        Number.isFinite(w.lat) &&
        Number.isFinite(w.lng) &&
        Number.isFinite(w.height)
      );
    }
    if (f.kind === 'number') return typeof v === 'number' && Number.isFinite(v);
    return typeof v === 'string' && f.options.some((o) => o.value === v);
  });
}
