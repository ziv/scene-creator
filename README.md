# Scene Creator

Scene Creator renders cinematic camera paths over Google's photorealistic 3D globe (Maps JavaScript API, `Map3DElement`) and records them as MP4 files. You pick a scene type, set its points and parameters, scrub through the path with a timeline slider, and press Record. See `plans.md`, `specs-1.md` and `specs-2.md`.

## Requirements

- Node.js 18 or newer
- A Google Maps Platform API key with the **Maps JavaScript API** and the **Elevation API** enabled
- Chrome or Edge for recording (it uses WebCodecs to encode video)

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
6. **Record.** Press Record. The camera steps through every frame, waits for the map to finish loading each view, and encodes it. Progress and an ETA are shown, and Cancel discards the recording. When it completes the browser downloads a file named after the scene. Keep the tab in the foreground: rendering pauses while it is hidden.

The scene and the output settings are saved in the browser and restored on reload.

### Output & quality

Expand "Output & quality" to set resolution (with presets), frame rate, bitrate, the per-frame steady timeout, the number of settle frames after the map reports steady, and the height of the attribution bar. The map is laid out so its rendering buffer matches the output resolution exactly, then scaled to fit the window, so a 1080p recording is rendered at 1080p even in a small window. The panel shows the actual render size and a time estimate.

Every frame carries an attribution bar with the Google Maps logo and `Map data ©year Google` plus the imagery providers the map reports for that view. The logo in `public/google-maps-logo.svg` is a placeholder wordmark; replace it with the official logo from the Google Maps Platform brand guidelines before distributing videos.

### How recording works

`Map3DElement` renders into a WebGL canvas inside a closed shadow root. Two hooks in `src/hooks.ts`, installed before the Maps API loads, record that root and force `preserveDrawingBuffer` on the map's context so its last frame can be copied. For each frame the app sets the camera, waits for the map's steady event plus a couple of animation frames, copies the canvas onto an output canvas, draws attribution, and hands the canvas to [mediabunny](https://github.com/Vanilagy/mediabunny) for H.264 (or HEVC, VP9, AV1) encoding into an MP4 assembled in memory.

This depends on Google's internals. If a Maps update changes them, the Record button is disabled with a message and scrubbing keeps working; `specs-2.md` Appendix A describes a tab-capture fallback.

Recording takes a while: every frame waits for tiles to load, so a 30 second clip at 30 fps can take several minutes.

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
  main.ts           App wiring: loader, viewport, form, slider, settings, recording
  hooks.ts          Shadow-root and WebGL-context hooks into Map3DElement
  maps-loader.ts    Bootstraps the Maps JavaScript API from the env key
  viewport.ts       Owns the Map3DElement; applies camera poses, waits for steady
  elevation.ts      Ground sampling via the Elevation service, memoised
  form.ts           Schema-driven parameter form
  storage.ts        Scene document persistence in localStorage
  settings.ts       Output & quality settings: schema, defaults, persistence
  stage.ts          Lays the map out at output resolution and scales it to fit
  attribution.ts    Reads provider attribution from the map; draws the bar
  encoder.ts        MP4 encoding via mediabunny and WebCodecs
  recorder.ts       Frame planning and the recording sequencer
  support.ts        Feature detection and the internals guard
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
