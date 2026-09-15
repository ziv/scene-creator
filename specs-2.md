# Scene Creator — Milestone 2 Specification: Recording

Milestone 2 adds a **Record** button that turns the current scene into an MP4 file. This document specifies it completely enough to implement without further design decisions. It builds on Milestone 1 (`specs-1.md`); everything there stays as is unless a section below says otherwise.

---

## 1. Goal

From `plans.md`:

> The app should contain a record button that convert the scene into a video.

### In scope

- A Record button that produces a downloadable `.mp4` of the compiled scene, from `t = 0` to `t = duration`, rendered **frame by frame**: the camera is stepped to each frame's time, the map is waited on until it reports steady, and only then is the frame captured. The output plays at constant speed with no tile popping, regardless of machine or network speed. This is the same model the Cesium reference app used.
- Frames are read directly from the map's WebGL canvas. No screen-share dialog, no tab capture.
- Attribution composited onto every frame: the Google Maps logo and the live copyright text, since the canvas holds only the imagery layer.
- An **Output & quality** panel: resolution, frame rate, bitrate, steady-wait tuning. Persisted in the browser.
- The map laid out so its backing buffer equals the output resolution exactly, CSS-scaled to fit the window.
- Progress with ETA, cancel, clear errors, and a guard that disables recording if the map's internals stop matching what we rely on.
- Unit tests for the pure parts: frame planning, the sequencer, settings, stage sizing, attribution text parsing.

### Out of scope (later milestones)

- Multi-segment editing UI and blend joins. The recorder consumes `CompiledScene`, so it records composite scenes unchanged once the UI can build them.
- Audio, titles, overlays other than attribution.
- Server-side rendering. Everything stays in the browser.
- Real-time (best-effort) capture. It was only ever a fallback for the tab-capture design and has no purpose now. Appendix A keeps the tab-capture design as a documented fallback should Google's internals change.
- Firefox and Safari. Encoding needs WebCodecs; treat Chromium as the target.

---

## 2. How the pixels are obtained

### 2.1 What the spike established (Chrome 152, 2026-09-15)

A runtime probe of `Map3DElement` showed:

- The element attaches a **closed** shadow root. Inside it, rendering happens on a plain main-thread `<canvas>` with a `webgl2` context. No worker, no `OffscreenCanvas`, no `transferControlToOffscreen`, no rendering iframe.
- The context is requested with `preserveDrawingBuffer: false`, `alpha: false`, `antialias: false`, `premultipliedAlpha: false`, `depth: true`, `stencil: true`, `powerPreference: 'high-performance'`, `failIfMajorPerformanceCaveat: true`, plus some private keys.
- With `preserveDrawingBuffer` forced to `true`, `drawImage(canvas)` after the map is steady yields the real image; `readPixels` and `captureStream` also work.
- The backing buffer is the element's CSS size times `devicePixelRatio` (1085×421 CSS → 2170×842).
- Attribution lives outside the canvas in DOM: `gmp-internal-attribution` (open root, holds the "Google Maps" logo) and `gmp-internal-disclosure-section` elements (open roots) whose text nodes carry `Map data` and the provider string, e.g. `Vexcel Imaging US, Inc., Landsat / Copernicus, NOAA, …`.

### 2.2 The two hooks

Both are installed by `src/hooks.ts`, which `main.ts` imports **first**, before anything can call the Maps loader. They patch prototypes once and record what they see.

```ts
export interface MapInternals {
  /** The closed shadow root of <gmp-map-3d>, once attached. */
  root: ShadowRoot | null;
  /** The webgl2 canvas under that root, once it requested its context. */
  canvas: HTMLCanvasElement | null;
  gl: WebGL2RenderingContext | null;
}
export const internals: MapInternals;
/** Resolves when both root and canvas are known, or rejects after `timeoutMs`. */
export function waitForInternals(timeoutMs: number): Promise<Required<MapInternals>>;
```

1. **`Element.prototype.attachShadow`**: call the original; if `this.tagName === 'GMP-MAP-3D'`, store the returned root. Roots of other hosts are ignored.
2. **`HTMLCanvasElement.prototype.getContext`**: when `type` is `'webgl2'` and the canvas's root node is the recorded map root (or the root is not yet known and the canvas is connected under a `gmp-map-3d`), call the original with `{ ...attrs, preserveDrawingBuffer: true }` and store canvas + context. Every other call passes through untouched. Google's other attributes, including `failIfMajorPerformanceCaveat`, are preserved.

The hooks are a dependency on Google's internals. Section 9 defines the guard that turns a mismatch into a disabled button with a message, never into a black video.

### 2.3 Reading a frame

After the map reports steady for a pose, wait two animation frames so the last render has been presented, then:

```ts
outCtx.drawImage(internals.canvas, 0, 0, out.width, out.height);
```

`out` is the offscreen output canvas at the configured resolution; with the stage sized as in §5 the copy is 1:1. Then attribution is drawn on top (§6) and the canvas goes to the encoder.

Because `preserveDrawingBuffer` is on, the buffer holds the last rendered frame until the next render, so timing of the copy relative to Google's animation loop is not critical. The two-frame wait only covers the case where steady fires before the final present.

---

## 3. Repository changes

New and changed files only. Everything else from Milestone 1 stays.

```
maps/
  package.json                 + "mediabunny": "^1.56.2" (runtime dependency)
  index.html                   stage wrapper, record row, settings panel
  public/google-maps-logo.svg  Google Maps logo from the Maps Platform brand assets (white-on-transparent variant)
  src/
    hooks.ts                   attachShadow / getContext hooks; MapInternals; waitForInternals
    main.ts                    imports hooks first; wires settings, stage sizing, record flow
    style.css                  stage layout with CSS scale, record row, progress bar
    viewport.ts                + setInteractive(), + setPoseAndSettle()
    settings.ts                RecordingSettings type, defaults, form schema, load/save
    stage.ts                   lays the stage out at output resolution and scales it to fit
    attribution.ts             reads the live attribution text; draws logo + text onto a frame
    encoder.ts                 mediabunny Mp4Encoder (port of scene-recorder's)
    recorder.ts                frame planning and the recording sequencer
    support.ts                 feature + internals detection with user-facing reasons
  test/
    recorder.test.ts
    settings.test.ts
    stage.test.ts
    attribution.test.ts
```

---

## 4. Settings

### 4.1 Model (`src/settings.ts`)

```ts
export interface RecordingSettings {
  version: 1;
  video: {
    width: number;        // px, even, 160..7680
    height: number;       // px, even, 90..4320
    fps: number;          // 1..120
    bitrate: number;      // bits/s
  };
  steady: {
    /** Max wait per frame for the map to report steady, ms. Then the frame is captured anyway. */
    timeoutMs: number;    // 1000..300000
    /** Animation frames to wait after steady before copying the canvas. */
    settleFrames: number; // 1..10
  };
  attribution: {
    /** Bar height as a fraction of output height. */
    barHeight: number;    // 0.03..0.12
  };
}

export const defaultSettings: RecordingSettings = {
  version: 1,
  video: { width: 1920, height: 1080, fps: 30, bitrate: 16_000_000 },
  steady: { timeoutMs: 20_000, settleFrames: 2 },
  attribution: { barHeight: 0.05 },
};
```

Storage key `scene-creator:settings:v1`. `loadSettings()` returns defaults when absent or invalid (`version !== 1`, any field missing, out of range, non-finite). `saveSettings()` swallows storage errors. Never mixed into the `SceneDocument`.

### 4.2 Form schema

Rendered with the existing `renderForm` (number and select fields). The form works on a flat record, so `settingsToParams` / `applyParams` map between the nested settings and flat values in friendlier units:

| key | label | kind | range/step | maps to |
| --- | --- | --- | --- | --- |
| `width` | Video width | number, px | 160–7680, step 2 | `video.width` |
| `height` | Video height | number, px | 90–4320, step 2 | `video.height` |
| `fps` | Frame rate | number, fps | 1–120, step 1 | `video.fps` |
| `bitrateMbps` | Bitrate | number, Mbit/s | 0.5–200, step 0.5 | `video.bitrate / 1e6` |
| `steadyTimeoutSec` | Steady timeout | number, s | 1–300, step 1 | `steady.timeoutMs / 1000` |
| `settleFrames` | Settle frames after steady | number | 1–10, step 1 | `steady.settleFrames` |
| `attributionPct` | Attribution bar height | number, % | 3–12, step 1 | `attribution.barHeight * 100` |

Presets row above the form: `720p`, `1080p`, `4K`, `Square 1080`, `Vertical 1080` set width/height only. "Reset to defaults" restores `defaultSettings`. Width and height are rounded to even on apply.

---

## 5. Stage layout (`src/stage.ts`, `style.css`)

The map's backing buffer is its CSS size × `devicePixelRatio`. To get an exact `W×H` buffer, the stage is laid out at `W / dpr` × `H / dpr` CSS pixels, then CSS-scaled to fit the viewport. A CSS transform does not change layout size, so the buffer stays at `W×H` while the element shrinks visually.

```
┌───────────────────────── #viewport (flex: 1, overflow hidden) ─────────────────────┐
│                                                                                    │
│            ┌──────────── #stage: width W/dpr, height H/dpr, transform: scale(s) ┐  │
│            │  <gmp-map-3d> absolute inset 0                                     │  │
│            │  #steady badge (DOM overlay; never in the canvas, so harmless)     │  │
│            │  #stageShield (transparent; blocks input while recording)          │  │
│            └────────────────────────────────────────────────────────────────────┘  │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

```ts
export interface StageLayout { cssWidth: number; cssHeight: number; scale: number }
/** CSS size for an exact backing buffer of (width, height) at `dpr`, and the scale that fits it in (availW, availH). Scale never exceeds 1. */
export function layoutStage(width: number, height: number, dpr: number, availW: number, availH: number): StageLayout
export function applyStage(stage: HTMLElement, layout: StageLayout): void   // sets width/height/transform (origin center)
```

Applied on load, on window resize, on `devicePixelRatio` change (listen via `matchMedia('(resolution: …dppx)')`), and when the settings' width/height change.

**Verification during implementation.** After applying a layout, compare `internals.canvas.width/height` to the target after the next steady. If Google sizes its buffer from the transformed rect instead of layout size, or caps it, the buffer will be smaller. In that case `stage.ts` reports `actualWidth/actualHeight`, the summary line says `Rendering at 1920×1080` or `Rendering at 1280×720 (browser capped; output will be upscaled)`, and the frame copy scales. Recording proceeds either way.

The 3D map is interactive at the scaled size; picking and scrubbing work as before.

---

## 6. Attribution (`src/attribution.ts`)

Google's terms require the Google logo and the copyright attributions to be visible with the imagery. The canvas contains neither, so both are composited onto every frame in a bar along the bottom edge.

### 6.1 Text source

```ts
/** Reads the current attribution from the map's DOM. Returns null if the elements are not found. */
export function readAttribution(root: ShadowRoot): { providers: string } | null
/** Composes the line drawn in the frame. */
export function attributionLine(providers: string, year: number): string   // "Map data ©2026 Google · Vexcel Imaging US, Inc., Landsat / Copernicus, NOAA, …"
```

`readAttribution` finds every `gmp-internal-disclosure-section` under the map root (they have open roots), collects text of leaf nodes, drops the label `Map data`, `Google Maps Terms`, and empty strings, and joins the rest with `, `. The provider text changes with the view, so it is read **per frame**; the value is memoised by string so unchanged frames cost nothing.

If the elements are not found, the line falls back to `Map data ©year Google` and the summary shows a warning `Provider attribution not found in the map; only "Map data ©year Google" will be shown`. Recording is not blocked.

### 6.2 Logo

`public/google-maps-logo.svg`, bundled, drawn from an `HTMLImageElement` loaded once at startup. A local same-origin asset keeps the output canvas untainted; drawing Google's own logo `<img>` from `gstatic` would taint it and break encoding. Use the official Google Maps logo from the Maps Platform brand guidelines, white variant, unmodified.

### 6.3 Drawing

```ts
export function drawAttribution(ctx: CanvasRenderingContext2D, width: number, height: number, logo: HTMLImageElement, line: string, barHeight: number): void
```

- Bar: `height × barHeight` tall, full width, at the bottom, `rgba(0,0,0,0.45)`.
- Logo: left, vertical padding 20 % of bar height, aspect preserved.
- Text: right-aligned, `system-ui`, font size 55 % of bar height, white with a 1 px black shadow, truncated with `…` if wider than the space left of the logo.

The same bar is shown live as a DOM overlay under the stage while not recording? No: the map already shows its own attribution in the UI, so the DOM stays as is. The composited bar exists only in the video.

---

## 7. Modules

### 7.1 `src/viewport.ts` additions

```ts
/** Blocks user gestures on the map (shows the transparent shield). */
setInteractive(enabled: boolean): void;

/**
 * Sets the pose, then waits for the map to be steady for that pose:
 * - if a gmp-steadychange(false) arrives within `unsteadyGraceMs`, wait for the following (true);
 * - otherwise assume nothing needed loading and resolve after the grace period.
 * Resolves true if steady was reached, false on timeout. Rejects only on abort.
 */
setPoseAndSettle(pose: CameraPose, opts: { unsteadyGraceMs: number; timeoutMs: number; signal: AbortSignal }): Promise<boolean>;
```

`unsteadyGraceMs` is a constant `150` in `recorder.ts`. A small camera step may not make the map leave the steady state at all; without the grace period the loop would wait for a `true` that never comes.

### 7.2 `src/encoder.ts`

Port of the reference app's `Mp4Encoder` on mediabunny:

```ts
export class Mp4Encoder {
  static async create(canvas: HTMLCanvasElement, video: RecordingSettings['video']): Promise<Mp4Encoder>;
  readonly codec: VideoCodec;
  /** Captures the canvas' current content as frame `index` at index / fps. Applies encoder backpressure. */
  addFrame(index: number): Promise<void>;
  finalize(): Promise<Blob>;
  cancel(): Promise<void>;
}
```

`Mp4OutputFormat` + `BufferTarget`; `CanvasSource(canvas, { codec, bitrate })`; codec chosen with `getFirstEncodableVideoCodec(format.getSupportedVideoCodecs().filter(preferred), { width, height })` in the order `avc, hevc, vp9, av1`; throws `This browser cannot encode W×H video in any MP4-compatible codec (tried: …)` when none fits. `addFrame` calls `source.add(index / fps, 1 / fps)`. `finalize` closes the source, finalizes the output and returns a `Blob` of `format.mimeType`.

### 7.3 `src/recorder.ts`

```ts
export type RecordPhase = 'warm-up' | 'recording' | 'encoding';
export interface RecordProgress { phase: RecordPhase; frame: number; frameCount: number; etaSeconds: number | null; steadyTimeouts: number }
export class RecordingCancelled extends Error {}

/** Frames for a scene: both endpoints included, at least 2. */
export function planFrames(duration: number, fps: number): { frameCount: number; timeAt(frame: number): number }

export interface FrameRecorderDeps {
  settle(pose: CameraPose, signal: AbortSignal): Promise<boolean>;  // viewport.setPoseAndSettle bound with settings
  waitFrames(count: number, signal: AbortSignal): Promise<void>;   // requestAnimationFrame × count; rejects on abort
  grab(): void;                                                    // copies the map canvas + draws attribution onto the output canvas
  addFrame(index: number): Promise<void>;                          // encoder.addFrame
  now(): number;                                                   // performance.now, injectable
}

export async function recordFrames(
  scene: CompiledScene, settings: RecordingSettings, deps: FrameRecorderDeps,
  onProgress: (p: RecordProgress) => void, signal: AbortSignal,
): Promise<{ frameCount: number; steadyTimeouts: number }>
```

`recordFrames` is the sequencer and contains no DOM, WebGL or media code, so it is unit-testable:

```
plan = planFrames(scene.duration, fps)
warm-up:   settle(poseAt(0)); waitFrames(settleFrames)                     // progress 'warm-up'
for frame in 0..frameCount-1:
  throwIfCancelled()
  steady = await settle(scene.poseAt(plan.timeAt(frame)), signal)
  if (!steady) steadyTimeouts++
  await waitFrames(settleFrames, signal)
  grab()
  await addFrame(frame)
  progress('recording', frame + 1, eta = elapsed / (frame + 1) × remaining)  // eta null on frame 0
progress('encoding')
```

`planFrames`: `frameCount = max(2, ceil(duration × fps) + 1)`, `timeAt(i) = min(i / fps, duration)`. The last frame lands exactly on `duration`.

### 7.4 `src/support.ts`

```ts
export interface Support { ok: boolean; reasons: string[] }
export function detectSupport(): Support                       // synchronous platform checks
export async function detectInternals(timeoutMs: number): Promise<Support>   // waits for hooks (§9)
```

Platform checks: `'VideoEncoder' in window` → "WebCodecs video encoding is not available (Chrome or Edge needed)."; `window.isSecureContext` → "Recording needs a secure context (https or localhost)."

### 7.5 `src/main.ts` — the record flow

State: `recording: boolean`, `abort: AbortController | null`, `outCanvas` (created once, resized on settings change), `logo: HTMLImageElement` (loaded at startup).

On `#recordBtn` click:

1. Guard: `compiled` exists, not recording, `support.ok`, internals ok.
2. `recording = true`; `abort = new AbortController()`; UI to recording state (§8.1).
3. Resize `outCanvas` to `settings.video`; `encoder = await Mp4Encoder.create(outCanvas, settings.video)`.
4. `grab = () => { ctx.drawImage(internals.canvas, 0, 0, w, h); drawAttribution(ctx, w, h, logo, attributionLine(readAttribution(root)?.providers ?? '', year), barHeight) }`.
5. `settle = (pose, signal) => viewport.setPoseAndSettle(pose, { unsteadyGraceMs: 150, timeoutMs: settings.steady.timeoutMs, signal })`.
6. `result = await recordFrames(compiled, settings, { settle, waitFrames, grab, addFrame: (i) => encoder.addFrame(i), now: () => performance.now() }, onProgress, abort.signal)`.
7. `blob = await encoder.finalize()`; `downloadBlob(blob, `${slug(doc.name)}.mp4`)`; status `Done — name.mp4 (12.3 MB), 2530 frames` plus `, 3 frames captured after a steady timeout` when `> 0`.
8. On `RecordingCancelled` → status `Recording cancelled.`; on other errors → `Recording failed: <message>`, logged to console. `finally`: `encoder.cancel()` if not finalized, restore UI, set the map back to `compiled.poseAt(slider.value)`.

Progress callback: `progressFill.style.width = frame / frameCount × 100 %`; status per phase:

| phase | text |
| --- | --- |
| warm-up | `Warming up: loading the first view…` |
| recording | `Recording frame 120/2530 — ETA 12:34` |
| encoding | `Finalizing MP4…` |

Cancel button: `abort.abort()`, button disabled, status `Cancelling…`. The partially encoded file is discarded.

If the tab is hidden, animation frames pause and the recording simply stalls until the tab is visible again; no abort. The status shows `Paused: bring this tab to the front to continue.` while `document.hidden` is true, and the ETA excludes hidden time.

`downloadBlob`: object URL on an `<a download>`, clicked, revoked.

---

## 8. UI

### 8.1 Record row (`index.html`)

Between the timeline and the controls:

```
┌ #recordRow ──────────────────────────────────────────────────────────┐
│ [● Record]  [Cancel]   ▓▓▓▓▓▓▓▓░░░░░░░░░░  #recordStatus            │
└──────────────────────────────────────────────────────────────────────┘
```

- `#recordBtn`: enabled only when a compiled scene exists, no recording is running, and both support checks pass. Red background.
- `#cancelBtn`, `#progressBar`: hidden unless recording.
- `#recordStatus`: recording-specific status, separate from the scene `#status`.

While recording: Record hidden, Cancel visible, progress visible; scene select, params form, settings form, presets, Reset, Frame scene and the slider disabled; `#stageShield` shown and `viewport.setInteractive(false)`. After any outcome everything is re-enabled, the shield hidden, and the camera returned to the slider's time. `#recordStatus` keeps the final message until the next recording starts.

### 8.2 Output & quality panel

A `<details id="settings">` in `#controls`, closed by default: presets row, `#settingsForm`, "Reset to defaults", and an info line: `Rendering at 1920×1080 · 2530 frames at 30 fps · ~21 min at 0.5 s/frame`. The per-frame estimate starts at 0.5 s and is replaced by the measured average after the first recording of the session.

Settings edits persist after validation (250 ms debounce). Width/height changes re-apply the stage layout immediately. Invalid settings highlight the field, disable Record and show `Fix the highlighted settings.` in `#recordStatus`. Settings edits never rebuild the scene.

---

## 9. Internals guard

Recording depends on Google's private structure. `detectInternals(5000)` runs after the viewport is created:

- Waits for both the map root and the `webgl2` canvas from `hooks.ts`.
- Confirms `internals.gl.getContextAttributes().preserveDrawingBuffer === true`.
- Performs one test copy after the first steady: draws the canvas into a 64×64 scratch canvas and checks that not every pixel is identical.

Any failure disables Record with `Recording is unavailable: the map's internals changed (…reason…). Scrubbing still works.` and logs details. The scene preview is unaffected. This turns a Google update into a visible message instead of black frames.

---

## 10. Testing (`npm test`)

No DOM, WebGL or media APIs; recorder logic is exercised through the `deps` interfaces.

- `recorder.test.ts`
  - `planFrames(10, 30)` → `frameCount = 301`, `timeAt(0) = 0`, `timeAt(150) = 5`, `timeAt(300) = 10`; `planFrames(0.01, 30)` → `frameCount = 2`, `timeAt(1) = 0.01`.
  - `recordFrames` on a 1 s / 10 fps stub scene records exactly 11 frames in order and, per frame, calls `settle` → `waitFrames(settleFrames)` → `grab` → `addFrame(i)` in that sequence (assert on a call log); reports `warm-up` first, `recording` with increasing `frame`, `encoding` last; counts steady timeouts when `settle` resolves `false`; returns `{ frameCount: 11, steadyTimeouts }`.
  - Aborting from inside a stubbed `settle` on frame 5 rejects with `RecordingCancelled` and calls `addFrame` at most 5 times.
  - ETA is `null` on the first frame and positive afterwards with an injectable `now()`.
- `settings.test.ts`: defaults round-trip through `settingsToParams`/`applyParams`; odd sizes round to even; wrong version or out-of-range stored JSON falls back to defaults; unit conversions.
- `stage.test.ts`: `layoutStage(1920, 1080, 2, 1000, 500)` → `cssWidth 960, cssHeight 540, scale 0.9259…`; `layoutStage(1280, 720, 1, 2000, 2000)` → `scale 1`; `layoutStage(3840, 2160, 2, 1085, 421)` → `scale = 421/1080`; scale is `min(availW/cssW, availH/cssH, 1)`.
- `attribution.test.ts`: `attributionLine('Vexcel, NOAA', 2026)` → `Map data ©2026 Google · Vexcel, NOAA`; empty providers → `Map data ©2026 Google`; a leaf-text parser helper (pure function over an array of strings) drops `Map data`, `Google Maps Terms`, blanks, and dedupes.

Manual acceptance covers the capture path (§11).

---

## 11. Acceptance criteria

1. In Chrome, with a compiled scene, pressing Record starts immediately with no browser dialog and shows `Warming up…` then per-frame progress with an ETA.
2. The default orbit at 1080p / 30 fps produces an MP4 with `ceil(duration·30)+1` frames that plays for `duration` seconds at constant speed, with no tile popping when stepped frame by frame in a player.
3. Every frame carries the attribution bar with the Google Maps logo and `Map data ©2026 Google · <providers>`, where the provider list matches what the map's disclosure shows for that view.
4. The video contains no UI: no badge, no Google alpha banner, no controls, no compass. Only the imagery layer plus our bar.
5. The frame size equals the configured resolution. At 1080p on a 2x display the info line reads `Rendering at 1920×1080`; at 4K it reads either `Rendering at 3840×2160` or the capped size with the upscale note, and the file is 3840×2160 either way.
6. Cancel stops within about a second and no file is downloaded.
7. During recording, the map ignores mouse and wheel input, and no control can change the scene or settings.
8. Hiding the tab pauses progress with the `Paused` message and resumes on return; the finished file is unaffected.
9. After any outcome, the map returns to the slider's time and all controls work.
10. Settings persist across reloads; the stage follows the configured resolution and scales to fit on resize.
11. With the hooks deliberately broken in a dev build (e.g. `getContext` patch disabled), Record is disabled with the internals message and scrubbing still works.
12. `npm test` passes; `npm run build` type-checks with `strict: true`.

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Google changes shadow/canvas internals | Recording breaks | Internals guard (§9) with a clear message; Appendix A fallback |
| `isSteady` fires before the final present | A frame shows the previous pose or a coarse tile | `settleFrames` wait (default 2, tunable to 10); `preserveDrawingBuffer` means the copy always sees the last full render |
| A tiny camera step never leaves steady | Loop hangs | 150 ms unsteady grace in `setPoseAndSettle` |
| Google sizes the buffer from the transformed rect or caps it | Large outputs upscaled | Detect and report actual size; recording continues |
| `preserveDrawingBuffer: true` costs performance | Slightly slower preview | Negligible on desktop GPUs; only the map canvas is affected |
| Attribution elements missing or renamed | Provider text lost | Fallback line + warning; logo always drawn |
| Long recordings (2500+ frames × ~0.5 s) | Many minutes per clip | ETA, cancel, time estimate in the panel; README resets expectations |
| WebCodecs cannot encode the chosen size | No file | Codec fallback chain; explicit error suggesting a lower resolution |
| Google Maps Platform terms on recording | Legal | Attribution is burned into every frame exactly as the map shows it. Whether exporting video is permitted is the same open question as `scene-recorder/plans.md` §10; settle it with the current terms before distributing videos. |

---

## 13. Optional stretch (only if the core is done)

- **Live preview of the output frame**: a small thumbnail of `outCanvas` next to the record row while recording.
- **Warm-up per segment** for composite scenes: pre-settle the first pose of each segment before recording so cut joins have no load stall.
- **Custom file name** field in the settings panel.
- **Frame-change check**: hash a few pixels before and after `settle` and wait one more frame if unchanged, guarding against a steady event that arrives before the render.

---

## Appendix A — Fallback: tab capture

If Google moves rendering into a worker or an iframe, the canvas route dies and this design applies instead. It is not implemented in Milestone 2.

- `navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude' })`, called from the click handler; the user must choose "This tab" every time (permission cannot be persisted). Verify `track.getSettings().displaySurface === 'browser'`.
- Chrome Region Capture: `await track.cropTo(await CropTarget.fromElement(stageEl))` crops the stream to the stage's bounding box (occluders included, so overlays must be hidden). Chrome/Edge 104+.
- Bind the stream to a hidden `<video>`; after each `setPoseAndSettle`, wait `settleFrames` calls of `requestVideoFrameCallback`, then `drawImage(video)` onto the output canvas and encode as above.
- Captured resolution is the on-screen size × dpr, so output larger than the window is upscaled. The CSS-scale trick does not help here because tab capture sees the transformed pixels.
- Google's own attribution is inside the cropped box, so no compositing is needed.
- The recording must abort when the tab is hidden, since the stream stops.
