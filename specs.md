# Scene Creator — Milestone 1 Specification

Scene Creator renders cinematic camera paths over Google's photorealistic 3D globe and, in later milestones, captures them to video. This document specifies Milestone 1 completely enough to implement it without further design decisions.

The reference implementation is the Cesium-based `scene-recorder` app (`/Users/ziv.perry/code/scene-recorder`). Its scene framework, schema-driven parameter form, constant-speed re-parametrisation and persistence model are carried over. Its renderer (Cesium), terrain sampling and recorder are replaced by Google Maps Platform pieces.

---

## 1. Milestone 1 goals

From `plans.md`:

1. A top section showing the rendered 3D view.
2. A slider that moves the camera along the scene.
3. Three scene path types: **cinematic orbit**, **fly-by**, **fly-over**.
4. A data structure, designed now, that supports a future "composite" scene made of several paths played in sequence.

### In scope

- Vite + TypeScript app that loads the Google Maps JavaScript API `maps3d` library and shows a `Map3DElement`.
- Scene type selector, schema-generated parameter form, per-scene defaults and "Reset to defaults".
- Ground-height sampling through the Maps Elevation service so all heights are "meters above ground".
- Constant-speed trajectories for the three path types.
- Timeline slider (plus time readout) that scrubs the camera through the scene.
- A versioned `Scene` document model in which a scene is a list of segments. Milestone 1 UI edits exactly one segment; the model, compiler, slider and persistence already work on the list.
- Persistence of the current scene document in `localStorage`.
- Status line: loading, sampling ground, ready, error.
- Unit tests for the geodesy helpers and the composite time mapping.

### Out of scope (later milestones)

- Video capture / recording of any kind.
- Multi-segment editing UI (add / remove / reorder segments, transitions).
- A 2D picking map. Points are entered as numbers in Milestone 1; the 3D view's `gmp-click` event is used as a cheap "pick" helper (see §7.4).
- Sky, weather, time of day. Google's imagery has baked lighting.
- Play / pause auto-playback of the timeline. Cheap to add; listed as an optional stretch in §12.

---

## 2. Key technical decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Renderer | Google Maps JavaScript API, `maps3d` library, `Map3DElement` | It is what the existing `index.html` already loads and what "Google Earth" means for the web today. No canvas access, which is acceptable for Milestone 1 (preview only). |
| Camera representation | Google's native orbit camera: `center`, `range`, `heading`, `tilt`, `roll` | Scrubbing is a direct property assignment per frame. No conversion layer needed at render time. |
| Trajectory time base | Seconds, not frame index | Frame rate is a capture concern. `poseAt(tSeconds)` keeps Milestone 1 independent of fps and lets composite scenes concatenate by duration. |
| Ground height | `google.maps.ElevationService` (`elevation` library) | Returns meters above mean sea level, which is exactly what `Map3DElement` altitudes use (`AltitudeMode.ABSOLUTE`). No geoid correction needed. |
| Geometry | Small dependency-free WGS84 vector library (`src/geo/wgs84.ts`) | Replaces `Cesium.Cartesian3` and friends. About 100 lines. |
| Constant speed | Numerical arc-length re-parametrisation, ported from `scene-recorder/src/scenes/geo.ts` | Proven approach; uniform playback speed regardless of how a curve is parametrised. |
| Language / build | TypeScript, Vite, Vitest | Matches the reference app; tests for the maths are cheap and valuable. |
| API key | `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` | Same pattern as the reference app's Cesium token. |

### 2.1 Facts about `Map3DElement` the design relies on

Verified against the current reference docs (`developers.google.com/maps/documentation/javascript/reference/3d-map`):

- `center: LatLngAltitude` — the point the camera looks at. `altitude` is meters above mean sea level.
- `range: number` — distance from camera to `center`, meters.
- `heading: number` — compass heading of the view, degrees, 0 = north, 0–360.
- `tilt: number` — degrees from straight down. `0` looks straight down, `90` looks at the horizon. Valid 0–180.
- `roll: number` — rotation around the view vector, degrees.
- `fov: number` — vertical field of view, default `35`, valid 5–80.
- `mode: MapMode` — `SATELLITE` or `HYBRID`.
- `defaultUIHidden: boolean`.
- Methods `flyCameraTo`, `flyCameraAround`, `stopCameraAnimation` exist but are **not used** for scrubbing. They are real-time animations and cannot be positioned at an arbitrary time.
- Events: `gmp-steadychange` (`isSteady`), `gmp-click` (`position: LatLngAltitude`), `gmp-error`.

The element has no `cameraPosition` setter that overrides the orbit model in a way we rely on; all scenes are expressed as `(center, range, heading, tilt, roll)`.

---

## 3. Repository layout

```
maps/
  index.html               Shell: layout + <script type="module" src="/src/main.ts">
  vite.config.ts
  tsconfig.json
  package.json             deps: typescript, vite, vitest, @types/google.maps
  .env.example             VITE_GOOGLE_MAPS_API_KEY=
  .env.local               (git-ignored) real key
  src/
    main.ts                App wiring: loader, viewport, form, slider, persistence
    style.css
    maps-loader.ts         Bootstraps the Maps JS API from the env key, exposes importLibrary
    viewport.ts            Creates/owns the Map3DElement, applies CameraPose, steady tracking
    elevation.ts           sampleGround(points) via ElevationService, with cache
    form.ts                Schema-driven parameter form (ported from scene-recorder)
    storage.ts             load/save of the SceneDocument in localStorage
    geo/
      types.ts             Vec3, Geodetic, CameraPose
      wgs84.ts             ECEF <-> geodetic, ENU frame, vector ops, bearings
      trajectory.ts        constantSpeedTrajectory, pose helpers (lookAtPose, aheadPose)
    scenes/
      types.ts             Segment contracts, param field schema, SceneDocument
      index.ts             Segment type registry
      orbit.ts             Cinematic orbit
      flyby.ts             Fly-by
      flyover.ts           Fly-over
      compile.ts           SceneDocument -> CompiledScene (composite time mapping)
  test/
    wgs84.test.ts
    trajectory.test.ts
    compile.test.ts
```

Files to remove from the current repo: `src/main.js`, `src/assets/*` (Vite template leftovers), `public/settings.json` (see §11), `maps.iml` (add to `.gitignore`).

---

## 4. Data model

All types live in `src/scenes/types.ts` and `src/geo/types.ts`.

### 4.1 Geometry primitives

```ts
/** Geodetic point. Altitude is meters above mean sea level (absolute). */
export interface Geodetic { lat: number; lng: number; alt: number }

/** ECEF meters. */
export interface Vec3 { x: number; y: number; z: number }

/** A camera in Map3DElement's native model. */
export interface CameraPose {
  center: Geodetic;   // look-at point, absolute altitude
  range: number;      // meters from camera to center
  heading: number;    // degrees, 0 = north, normalised to [0, 360)
  tilt: number;       // degrees from straight down, [0, 180]
  roll: number;       // degrees, 0 in Milestone 1
}
```

### 4.2 User-facing parameters

```ts
/** A point the user places. `height` is meters ABOVE GROUND at that lat/lng. */
export interface Waypoint { lat: number; lng: number; height: number }

export type ParamValue = Waypoint | number | string;
export type Params = Record<string, ParamValue>;
```

Ground height is resolved at build time, so user input never mixes absolute and relative altitudes.

### 4.3 Parameter schema (drives the form)

Ported unchanged from the reference app:

```ts
export interface PointField  { kind: 'point';  key: string; label: string; color: string; heightLabel?: string }
export interface NumberField { kind: 'number'; key: string; label: string; unit?: string; min: number; max: number; step: number }
export interface SelectField { kind: 'select'; key: string; label: string; options: { value: string; label: string }[] }
export type ParamField = PointField | NumberField | SelectField;
```

### 4.4 Trajectory (a built, scrubbable segment)

```ts
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
```

### 4.5 Segment type (the plug-in contract)

```ts
export interface BuildContext {
  sampleGround(points: { lat: number; lng: number }[]): Promise<number[]>; // meters above MSL
}

export interface SegmentType<P extends Params = Params> {
  id: 'orbit' | 'flyby' | 'flyover' | string;
  name: string;
  description: string;
  fields: ParamField[];
  defaults: P;
  /** Resolves ground heights and returns the motion. Throws with a user-facing message if params are unusable. */
  build(ctx: BuildContext, params: P): Promise<Trajectory>;
}

export function defineSegment<P extends Params>(s: SegmentType<P>): SegmentType;
```

### 4.6 Scene document (the composite structure, designed now)

This is the persisted, serialisable representation. Milestone 1 always has exactly one segment, but nothing in the code assumes that.

```ts
export interface SceneDocument {
  version: 1;
  id: string;                 // uuid
  name: string;
  segments: SceneSegment[];   // played in order; must have length >= 1
}

export interface SceneSegment {
  id: string;                 // uuid, stable across edits (needed for future reorder UI)
  type: string;               // SegmentType.id
  params: Params;             // validated against the type's fields
  /**
   * How this segment connects to the previous one. Milestone 1 supports only
   * 'cut' (hard jump). Reserved values for later: { kind: 'blend', seconds }.
   */
  join: { kind: 'cut' } | { kind: 'blend'; seconds: number };
}
```

Design notes that must hold for later milestones:

- **Time is the only global axis.** Each segment owns a local `[0, duration]`. The composite maps global time to (segment index, local time). Frame rate is applied only at capture time.
- **Segments are independent.** A segment's `build` sees only its own params and the ground sampler. Continuity between segments (matching end pose to start pose) is a property of the `join`, not of the segment. This keeps the three path types simple and makes `blend` an additive feature.
- **Params are self-contained JSON.** No references to other segments, no derived values stored. Rebuilding from the document is always possible.
- **Stable ids** on segments so a future UI can reorder without losing per-segment state.
- **`version`** on the document so migrations are possible. Loading an unknown version falls back to the default document.

### 4.7 Compiled scene

Produced by `src/scenes/compile.ts` from a `SceneDocument`:

```ts
export interface CompiledSegment {
  segment: SceneSegment;
  trajectory: Trajectory;
  /** Global start time, seconds. */
  offset: number;
}

export interface CompiledScene {
  duration: number;                  // sum of segment durations (+ blend time later)
  segments: CompiledSegment[];
  /** Global pose. For 'cut' joins: the segment whose [offset, offset+duration) contains t. */
  poseAt(t: number): CameraPose;
  /** (segment index, local t) for the given global t. Exposed for the UI readout. */
  locate(t: number): { index: number; local: number };
  focus: Geodetic;                   // first segment's focus
}
```

`compile()` builds every segment concurrently with `Promise.all`, then lays them out end to end. `poseAt` clamps `t` to `[0, duration]`. Exactly at a boundary time, the *later* segment wins, so the last frame of the scene is the last segment's end pose.

---

## 5. Geodesy and trajectory helpers

### 5.1 `src/geo/wgs84.ts`

Constants: `a = 6378137`, `f = 1/298.257223563`, `e² = f(2 − f)`.

| Function | Purpose |
| --- | --- |
| `toEcef(g: Geodetic): Vec3` | Geodetic → ECEF |
| `toGeodetic(v: Vec3): Geodetic` | ECEF → geodetic (Bowring or 3–5 Newton iterations; ≤ 1 mm error) |
| `enuFrame(origin: Vec3): { east, north, up }` | Local unit axes at origin |
| `toEnu(origin, v)` / `fromEnu(origin, e, n, u)` | Convert between ECEF and local ENU meters |
| `add, sub, scale, dot, cross, length, normalize, distance, lerp` | Plain `Vec3` ops |
| `bearing(from: Geodetic, to: Geodetic): number` | Initial bearing, degrees clockwise from north, normalised `[0, 360)` — computed from the ENU vector, not spherical formulas, so altitude differences do not matter |
| `horizontalDistance(a, b): number` | Length of the ENU vector's horizontal component |
| `toRadians, toDegrees, normalizeHeading` | Trivial |

### 5.2 `src/geo/trajectory.ts`

```ts
export interface CurveSpec {
  positionAt(u: number): Vec3;                       // any parametrisation, u in [0,1]
  poseAt(position: Vec3, u: number): CameraPose;
  speed: number;                                     // m/s
  samples?: number;                                  // default 1024
}
export function constantSpeedTrajectory(spec: CurveSpec): Pick<Trajectory, 'length' | 'duration' | 'poseAt'>;
```

Port of the reference implementation with two changes: `poseAt(t)` takes seconds (`u = uAtDistance(clamp(t / duration) · length)`), and there is no `fps`. Throws `"The camera path must be at least 1 m long."` and `"Speed must be positive."` as before.

Pose helpers (all return `roll: 0`):

```ts
/** Camera at `position` looking at `target`. */
export function lookAtPose(position: Vec3, target: Vec3): CameraPose
// center  = toGeodetic(target)
// range   = distance(position, target)          (min 1 m)
// heading = bearing(position → target)
// tilt    = toDegrees(atan2(horizontal, vertical)) where (e,n,u) = toEnu(target, position)
//           horizontal = hypot(e, n), vertical = u.  Looking down from above → tilt < 90.
//           Camera below target → tilt > 90 (valid, up to 180).

/** Camera at `position` looking along heading/pitch, with the look-at point `lookAhead` meters away. */
export function aheadPose(position: Vec3, headingDeg: number, pitchDeg: number, lookAhead: number): CameraPose
// dir (ENU at position) = (sin h·cos p, cos h·cos p, sin p)
// center  = toGeodetic(fromEnu(position, dir · lookAhead))
// range   = lookAhead
// heading = headingDeg
// tilt    = 90 + pitchDeg    (pitch −15° → tilt 75°)
```

---

## 6. Segment types

Defaults use a city with photorealistic coverage so the demo looks its best. Toronto (CN Tower area, `43.6426, -79.3871`) matches the existing `index.html`.

### 6.1 Cinematic orbit — `orbit`

Circles a centre point while radius and height ease from start to end values. Camera always looks at the centre.

| Field | Kind | Range / options | Default |
| --- | --- | --- | --- |
| `center` | point (heightLabel "Look-at height above ground") | — | `{ lat: 43.6426, lng: -79.3871, height: 150 }` |
| `startRadius` | number, m | 1 – 200 000, step 50 | 1500 |
| `endRadius` | number, m | 1 – 200 000, step 50 | 600 |
| `startHeight` | number, m above centre ground | −1000 – 50 000, step 25 | 600 |
| `endHeight` | number, m above centre ground | −1000 – 50 000, step 25 | 300 |
| `startBearing` | number, ° from N | −360 – 360, step 5 | 200 |
| `sweep` | number, ° | 1 – 1080, step 15 | 270 |
| `direction` | select | `cw` "Clockwise (seen from above)", `ccw` "Counter-clockwise" | `cw` |
| `speed` | number, m/s | 1 – 5000, step 5 | 60 |

Build:

1. `[groundC] = sampleGround([center])`.
2. `target = toEcef({ lat, lng, alt: groundC + center.height })`, `origin = toEcef({ lat, lng, alt: groundC })`.
3. `ease(u) = u²(3 − 2u)`; `r(u) = lerp(startRadius, endRadius, ease(u))`; `h(u) = lerp(startHeight, endHeight, ease(u))`; `b(u) = startBearing + sign·sweep·u` with `sign = direction === 'ccw' ? −1 : 1`.
4. `positionAt(u) = fromEnu(origin, r·sin b, r·cos b, h)`.
5. `poseAt = lookAtPose(position, target)`; `samples: 2048`.
6. `focus = { lat, lng, alt: groundC }`, `radius = max(startRadius, endRadius)`, notes: ground height at centre; radius and height ranges over the sweep.

### 6.2 Fly-by — `flyby`

Straight pass from A to B while the camera stays locked on a separate target C.

| Field | Kind | Range | Default |
| --- | --- | --- | --- |
| `start` | point | — | `{ lat: 43.6300, lng: -79.4000, height: 500 }` |
| `end` | point | — | `{ lat: 43.6550, lng: -79.3750, height: 500 }` |
| `target` | point (heightLabel "Look-at height above ground") | — | `{ lat: 43.6426, lng: -79.3871, height: 150 }` |
| `speed` | number, m/s | 1 – 5000, step 5 | 80 |

Build:

1. `[gS, gE, gT] = sampleGround([start, end, target])`.
2. `S, E, T` as ECEF with `alt = ground + height`.
3. `positionAt(u) = lerp(S, E, u)`, `samples: 1`.
4. `poseAt = lookAtPose(position, T)`.
5. `focus = T (geodetic)`, `radius = max(horizontalDistance(target, start), horizontalDistance(target, end))`.

A straight ECEF chord is a few centimetres below the great-circle path for a 5 km leg. That is invisible and simpler than a geodesic; document it in the code comment.

### 6.3 Fly-over — `flyover`

Pilot's view: straight from A to B, looking ahead along the route with a fixed pitch.

| Field | Kind | Range | Default |
| --- | --- | --- | --- |
| `start` | point | — | `{ lat: 43.6200, lng: -79.4100, height: 400 }` |
| `end` | point | — | `{ lat: 43.6600, lng: -79.3700, height: 300 }` |
| `pitch` | number, ° (negative = down) | −89 – 0, step 5 | −20 |
| `lookAhead` | number, m | 50 – 20 000, step 50 | 800 |
| `speed` | number, m/s | 1 – 5000, step 5 | 80 |

Build:

1. `[gS, gE] = sampleGround([start, end])`; `S, E` as ECEF.
2. `heading = bearing(start, end)` (constant along a straight leg).
3. `positionAt(u) = lerp(S, E, u)`, `samples: 1`.
4. `poseAt = aheadPose(position, heading, pitch, lookAhead)`.
5. `focus` = midpoint geodetic with `alt = (gS + gE)/2`, `radius = length / 2`.

Constraint: `pitch` max is 0, not +45 as in the reference app, because `Map3DElement` refuses a `center` that is above the camera in a way that inverts the orbit model (tilt would exceed 90 for a look-ahead point above the camera). A horizontal or downward look keeps `tilt ≤ 90`.

Risk: the look-at `center` may sit below terrain for steep pitches near the ground. The element renders it anyway because `center` is a mathematical point; verify during implementation and, if the view snaps, clamp the `center` altitude to `groundAtCenter − 1`... only if observed. Note the result in the README.

### 6.4 Registry — `src/scenes/index.ts`

```ts
export const segmentTypes: readonly SegmentType[] = [cinematicOrbit, flyBy, flyOver];
export function getSegmentType(id: string): SegmentType; // throws on unknown id
```

---

## 7. Application behaviour

### 7.1 Layout (`index.html`, `style.css`)

Single column, full viewport, dark theme (`#111` background, `#eee` text, system font, values from the reference app's stylesheet).

```
┌──────────────────────────────────────────────────────────┐
│  #viewport  (flex: 1, min-height 50vh)                   │
│     <gmp-map-3d> fills it                                │
│     #steady badge (top-right): "Loading tiles…"/"Ready"  │
├──────────────────────────────────────────────────────────┤
│  #timeline                                                │
│     [◄ slider ──────────────────────────────────►]        │
│     "12.4 s / 38.0 s · segment 1/1 (orbit) · 2.3 km"      │
├──────────────────────────────────────────────────────────┤
│  #controls  (scrollable, max-height ~40vh)                │
│     Scene: [select ▾]   description                       │
│     [params form: point fieldsets + number grid]          │
│     [Reset to defaults]  [Frame scene]                    │
│     #status                                               │
└──────────────────────────────────────────────────────────┘
```

Responsive: at widths under 700 px the controls stack naturally; nothing is hidden. The viewport must never shrink below 240 px in height.

### 7.2 Start-up sequence (`main.ts`)

1. Read `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`. If missing, show in `#status`:
   `Missing Google Maps API key. Create .env.local with VITE_GOOGLE_MAPS_API_KEY=<key>` and stop.
2. `maps-loader.ts` injects the bootstrap loader (the IIFE currently in `index.html`) with `{ key, v: 'alpha' }`. Keep `alpha` as the existing code does; switch to `weekly` once the implementation confirms `maps3d` works there.
3. `await google.maps.importLibrary('maps3d')` and `importLibrary('elevation')` in parallel.
4. Create the `Map3DElement` (`viewport.ts`) with `mode: SATELLITE`, `defaultUIHidden: true`, and append it to `#viewport`. Listen to `gmp-steadychange` to update the badge and `gmp-error` to surface errors in `#status`.
5. Load the `SceneDocument` from storage (`storage.ts`); fall back to the default document (one `orbit` segment with defaults).
6. Mount the scene selector and form for `segments[0]`.
7. `compile()` the document; on success set the slider range and show `t = 0`.

### 7.3 Editing and rebuilding

- Every input event writes straight into `segments[0].params` (form is bound to the params object, as in the reference `form.ts`), validates, and schedules a rebuild after 250 ms of quiet.
- A rebuild increments a generation counter; a stale result (older generation) is discarded. While building, `#status` shows `Sampling ground…` and the slider is disabled.
- On success: `#status` = `Ready.`, slider `max = duration` (step `0.05` s), slider value preserved as a fraction of the previous duration (so scrubbing position survives edits), camera set to `poseAt(value)`.
- On error: `#status` = `Invalid scene: <message>`; slider disabled; the last good camera pose stays on screen.
- Changing the scene type replaces `segments[0]` with `{ id: newUuid(), type, params: structuredClone(defaults), join: { kind: 'cut' } }`, but keeps per-type param edits in memory for the session (`paramsByType` map, as the reference app does with `paramsByScene`) so switching back and forth does not lose work.
- "Reset to defaults" restores the current type's defaults and rebuilds.
- "Frame scene" sets the camera to a view that shows the whole scene: `center = focus`, `range = max(2.5 · radius, 500)`, `tilt = 45`, `heading = 0`. This does not move the slider.
- Every successful edit persists the document (`storage.ts`, key `scene-creator:v1`).

### 7.4 Point picking via the 3D view

Each point fieldset has a "Pick in view" button. When armed, the next `gmp-click` on the map writes `position.lat / position.lng` into the point (height untouched), disarms, and triggers a rebuild. Arming highlights the button; pressing it again disarms. This replaces the reference app's 2D map for Milestone 1.

### 7.5 Slider semantics

- `input[type=range]`, `min = 0`, `max = compiled.duration`, `step = 0.05`.
- On `input`: `viewport.setPose(compiled.poseAt(t))` and update the readout `"${t.toFixed(1)} s / ${duration.toFixed(1)} s · segment ${i+1}/${n} (${type}) · ${(length/1000).toFixed(1)} km"`.
- Keyboard: arrow keys move by one step; `Shift+arrow` by 1 s; `Home`/`End` jump to the ends. Native range behaviour covers arrows; the shift/home/end handling is a small keydown handler.
- Applying a pose sets, in this order, `center`, `range`, `heading`, `tilt`, `roll` on the element. Values are written only if they changed by more than `1e-6` to avoid redundant re-renders.

### 7.6 Persistence (`storage.ts`)

- `load(): SceneDocument | null` — parses `localStorage['scene-creator:v1']`, validates `version === 1`, every segment's `type` is registered and its `params` match the type's `fields` (same `paramsMatchSchema` check as the reference app). Any failure returns `null`.
- `save(doc)` — `JSON.stringify`; swallow storage errors.

---

## 8. Ground sampling (`elevation.ts`)

```ts
export function createGroundSampler(): (points: { lat: number; lng: number }[]) => Promise<number[]>
```

- Uses `new google.maps.ElevationService().getElevationForLocations({ locations })`.
- Batches up to 512 locations per request (service limit); Milestone 1 needs at most 3.
- Memoises by `lat.toFixed(6),lng.toFixed(6)` for the session, so rebuilding after a speed change makes no network call.
- Result `elevation` is meters above sea level; returned as is. Missing results throw `Could not sample ground height (Elevation service error: <status>)`.
- If the service answers `REQUEST_DENIED` (the key lacks the Elevation API), the sampler permanently falls back to `0` m for the session and exposes `fallbackReason`; the app still builds and scrubs, and the status line explains that heights are measured from sea level and how to fix the key.

---

## 9. Module contracts

### `viewport.ts`

```ts
export interface Viewport {
  readonly element: google.maps.maps3d.Map3DElement;
  setPose(pose: CameraPose): void;
  /** Resolves on the next gmp-steadychange with isSteady === true (or immediately if already steady). */
  whenSteady(signal?: AbortSignal): Promise<void>;
  onClick(handler: (p: Geodetic) => void): () => void;   // returns unsubscribe
  isSteady(): boolean;
}
export async function createViewport(container: HTMLElement): Promise<Viewport>;
```

`whenSteady` is not needed by Milestone 1's UI but is the primitive the capture milestone will build on, and it is trivial to add now.

### `form.ts`

Port of the reference `renderForm(root, fields, params, hooks)` → `FormHandle { refresh, setArmed, setEnabled, destroy }`. Differences: field label `Longitude` maps to `lng`; the `date` kind is dropped; the pick button reads "Pick in view".

### `compile.ts`

```ts
export async function compile(doc: SceneDocument, ctx: BuildContext): Promise<CompiledScene>;
```

Throws the first segment error, prefixed with `Segment ${index + 1} (${type}): `.

---

## 10. Testing

Vitest, `npm test`. No browser or network.

- `wgs84.test.ts`: round-trip `toGeodetic(toEcef(g))` within 1e-9° and 1 mm for a grid of points including poles and the antimeridian; `enuFrame` axes orthonormal; `bearing` of due-north and due-east offsets equal 0 and 90; `horizontalDistance` of 0.01° latitude ≈ 1112 m ± 1 m.
- `trajectory.test.ts`: `constantSpeedTrajectory` on a circle parametrised with `u³` still yields equal step lengths between `poseAt(t)` and `poseAt(t + dt)` (max deviation < 1 %); `duration = length / speed`; throws on zero length and non-positive speed; `lookAtPose` from directly above gives `tilt ≈ 0`; from the same altitude gives `tilt ≈ 90`; `aheadPose` with pitch −20 gives `tilt = 70` and `range = lookAhead`.
- `compile.test.ts`: with a stub `BuildContext` and two stub segment types of durations 3 s and 5 s, `duration = 8`, `locate(2.9) = {0, 2.9}`, `locate(3) = {1, 0}`, `locate(99) = {1, 5}`, `poseAt` delegates to the right trajectory. This is the test that proves the composite model works before the UI supports it.

Manual acceptance (see §13) covers the rendering.

---

## 11. Configuration and secrets

- `.env.example` with `VITE_GOOGLE_MAPS_API_KEY=` is committed; `.env.local` is git-ignored (already in `.gitignore`).
- **The current repo has a Google API key hard-coded in `index.html` and in `public/settings.json`, and `settings.json` is staged.** Both must be removed before the first commit of this milestone and the key rotated in Google Cloud Console, then restricted by HTTP referrer to the dev and deploy origins and to the Maps JavaScript API and Elevation API only. The existing `.env.local` variable `GOOGLE_MAPS_TOKEN` is not exposed by Vite (no `VITE_` prefix); rename it.
- `vite.config.ts`: default config for Milestone 1. (GitHub Pages `base` handling as in the reference app can be added when deploying.)

`package.json` scripts:

```json
{
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "test": "vitest run"
}
```

Dependencies: `vite`, `typescript`, `vitest`, `@types/google.maps` (dev). No runtime dependencies.

---

## 12. Optional stretch (only if the core is done)

- **Play / pause**: a button that advances the slider in real time using `requestAnimationFrame` deltas, looping at the end. Pure UI over `poseAt`.
- **Segment list read-out**: render `doc.segments` as a static list under the form to make the composite structure visible even though only one segment is editable.

---

## 13. Acceptance criteria

1. `npm run dev` with a valid key shows the 3D view in the top section within a few seconds; without a key, a clear message is shown and nothing throws.
2. The scene selector offers exactly "Cinematic orbit", "Fly-by", "Fly-over", each with its description.
3. With defaults, every scene builds without error, the status reads `Ready.`, and the slider range equals the computed duration.
4. Dragging the slider from start to end moves the camera continuously along the path; the orbit keeps the CN Tower centred; the fly-by keeps the target framed; the fly-over looks along the route at the set pitch.
5. Editing any numeric field rebuilds within about a quarter second after typing stops; the slider position is preserved proportionally; invalid values are highlighted and disable the slider.
6. "Pick in view" followed by a click on the map moves the point and rebuilds.
7. Reloading the page restores the last scene type and parameters.
8. `npm test` passes; `npm run build` type-checks with `strict: true` and produces a bundle.
9. No API key appears in any committed file.
10. `SceneDocument` with two segments compiles and scrubs correctly in the unit test (§10), even though the UI cannot yet create one.

---

## 14. Known risks

| Risk | Impact | Mitigation in M1 |
| --- | --- | --- |
| `maps3d` channel or API drift (`alpha` vs `weekly`) | App fails to load | Loader isolates the channel in one constant; `gmp-error` is surfaced |
| Fly-over `center` below terrain at steep pitch | Odd framing near the ground | Pitch limited to ≤ 0; clamp only if observed (§6.3) |
| Elevation API quota / billing | Rebuild fails | Session memoisation; at most 3 points per build |
| No canvas access in `Map3DElement` | Capture is not possible in the deterministic way the reference app used | Out of scope for M1; the `whenSteady` primitive and time-based trajectories keep both capture strategies (real-time tab capture, or a future tile renderer) open |
| Photorealistic coverage outside cities | Terrain looks flat | Defaults are in a covered city; documented |
