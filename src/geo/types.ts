/** Geodetic point. Altitude is meters above mean sea level (absolute). */
export interface Geodetic {
  lat: number;
  lng: number;
  alt: number;
}

/** ECEF meters. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A camera in Map3DElement's native model. */
export interface CameraPose {
  /** Look-at point, absolute altitude. */
  center: Geodetic;
  /** Meters from camera to center. */
  range: number;
  /** Degrees, 0 = north, normalised to [0, 360). */
  heading: number;
  /** Degrees from straight down, [0, 180]. */
  tilt: number;
  /** Degrees; 0 in Milestone 1. */
  roll: number;
}
