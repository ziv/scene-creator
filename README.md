# Scene Creator

Scene Creator renders cinematic camera paths over Google's photorealistic 3D globe (Maps JavaScript API, `Map3DElement`). You pick a scene type, set its points and parameters, and scrub through the path with a timeline slider. Video capture is planned for a later milestone; see `plans.md` and `specs.md`.

## Requirements

- Node.js 18 or newer
- A Google Maps Platform API key with the **Maps JavaScript API** and the **Elevation API** enabled

## Setup

```bash
npm install
cp .env.example .env.local
```

Paste your key into `.env.local`:

```
VITE_GOOGLE_MAPS_API_KEY=your-key-here
```

Then:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the unit tests (geodesy, trajectories, composite scenes) |

Restrict the key in Google Cloud Console to your dev and deploy origins and to those two APIs.

## Using the app

1. **Choose a scene** from the dropdown: Cinematic orbit, Fly-by or Fly-over.
2. **Set points.** Type latitude, longitude and height, or press "Pick in view" and click the 3D map to place a point. Heights are meters above the ground at that location.
3. **Tune parameters.** Out-of-range values are highlighted and disable the slider.
4. **Scrub.** Drag the slider under the 3D view. Arrow keys step, Shift+arrow moves one second, Home/End jump to the ends.
5. "Frame scene" shows the whole scene from above; "Reset to defaults" restores the built-in example.

The scene is saved in the browser and restored on reload.

### If the status says the Elevation API is not enabled

Ground heights come from the Elevation API. When the key is not allowed to use it, the app keeps working but measures heights from sea level (0 m) instead of the ground, and says so in the status line. Enable "Elevation API" for the key in Google Cloud Console and reload.

## Scene types

- **Cinematic orbit.** Circles a centre point while radius and height ease from start to end values over the sweep. Always looks at the centre.
- **Fly-by.** Straight line from start to end while looking at a separate target.
- **Fly-over.** Straight line from start to end, looking ahead along the route with a fixed downward pitch. The look-at point is a fixed distance ahead; with steep pitches near the ground it can be below the surface, which is harmless for framing.

All paths move at constant speed, so duration is path length divided by speed.

## Project layout

```
src/
  main.ts           App wiring: loader, viewport, form, slider, persistence
  maps-loader.ts    Bootstraps the Maps JavaScript API from the env key
  viewport.ts       Owns the Map3DElement; applies camera poses, tracks steadiness
  elevation.ts      Ground sampling via the Elevation service, memoised
  form.ts           Schema-driven parameter form
  storage.ts        Scene document persistence in localStorage
  geo/
    wgs84.ts        ECEF <-> geodetic, ENU frames, bearings
    trajectory.ts   Constant-speed re-parametrisation and pose helpers
  scenes/
    types.ts        Segment contracts, parameter schema, SceneDocument
    compile.ts      SceneDocument -> CompiledScene (segments laid out in time)
    index.ts        Segment type registry
    orbit.ts, flyby.ts, flyover.ts
test/               Vitest unit tests
```

A scene document is a list of segments played in sequence. The UI currently edits one segment; the model, compiler and slider already handle several.
