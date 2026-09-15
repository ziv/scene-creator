# Scene Creator — Milestone 3 Specification: Minimap and compact panel

Milestone 3 adds a 2D minimap for placing points and seeing the path, makes every form denser, and makes the path details collapsible like the "Output & quality" panel. This document specifies it completely enough to implement without further design decisions. It builds on `specs-1.md` and `specs-2.md`; everything there stays unless a section below says otherwise.

---

## 1. Goals

From `plans.md`:

> - Add minimap for picking points and show the path.
> - Make all forms denser (compact)
> - Path details should be collapsable like the video output

### In scope

- A **minimap** (`google.maps.Map`, hybrid imagery) beside the panel that shows every point of the current segment as a labelled, draggable marker, draws the camera's ground track, shows where the camera is at the slider's time, lets the user place points by clicking, and has a place search box.
- **Picking flow**: a point's "Pick" button arms it; the next click on the minimap or the 3D view places it; after placing, the next point of the segment is armed automatically so a fly-by is three clicks. Markers can also be dragged.
- **Compact forms**: one row per point, tighter grid for numbers, smaller type and paddings, a one-line scene description. Same schema-driven renderer.
- **Collapsible Path panel**: the scene selector, description, parameter form, buttons and path notes live in a `<details>` whose summary shows the scene type, duration and length. Open/closed state of both panels persists.
- A pure helper to compute the camera's ground position from a `CameraPose`, with tests, plus tests for track sampling and bounds.

### Out of scope

- Multi-segment editing. The minimap draws the whole compiled scene's track (all segments) but markers are for the edited segment only, which in the current UI is the single one.
- Editing heights on the map (dragging changes lat/lng only).
- Any change to recording.

---

## 2. Layout

The top part is unchanged (stage, timeline, record row). The bottom part becomes two columns: the minimap on the left, the scrollable panel on the right.

```
┌ #viewport (stage) ─────────────────────────────────────────────────────────┐
├ #timeline ─────────────────────────────────────────────────────────────────┤
├ #recordRow ────────────────────────────────────────────────────────────────┤
├ #bottom ───────────────────────────────────────────────────────────────────┤
│ ┌ #mapColumn (360px) ───────┐ ┌ #controls (flex 1, scroll) ─────────────┐ │
│ │ [search box            ]  │ │ ▸ Path · Cinematic orbit · 84.3 s · 5 km│ │
│ │ ┌───────────────────────┐ │ │   Scene [select ▾]  description…        │ │
│ │ │                       │ │ │   ● Centre   [lat][lng][h]   [Pick]     │ │
│ │ │   minimap (hybrid)    │ │ │   Start radius [ ] End radius [ ] …     │ │
│ │ │   markers + track     │ │ │   [Reset] [Frame scene]  notes…         │ │
│ │ │                       │ │ │ ▸ Output & quality                      │ │
│ │ └───────────────────────┘ │ │ status                                  │ │
│ │ #pickHint   [Fit map]     │ │                                         │ │
│ └───────────────────────────┘ └─────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

- `#bottom`: `display: flex`, `height: 42vh`, `min-height: 260px`. The stage area keeps `flex: 1` above it.
- `#mapColumn`: `flex: 0 0 360px`, column flex; the map fills the remaining height. Padding 8px, gap 6px.
- `#controls`: `flex: 1`, `overflow-y: auto`, unchanged behaviour otherwise.
- Below 800px viewport width, `#bottom` stacks: map column full width, 220px tall, then the panel.

Decision note: a left sidebar layout (as in the Cesium reference app) was the alternative. The two-column bottom keeps the Milestone 1 "rendered window on top" layout and the stage width, at the cost of a shorter minimap. If the minimap feels cramped in practice, moving `#mapColumn` into a left sidebar is a CSS-only change; no module depends on its position.

---

## 3. Minimap (`src/minimap.ts`)

### 3.1 Libraries and facts

- `google.maps.importLibrary('maps')` → `Map`; `importLibrary('marker')` → `AdvancedMarkerElement`; `importLibrary('places')` → `PlaceAutocompleteElement`. Loaded alongside `maps3d` and `elevation`; all four come from the same loader and key.
- Advanced markers require a **map ID**. `DEMO_MAP_ID` is accepted by Google for testing. The app reads `VITE_GOOGLE_MAPS_MAP_ID` and falls back to `DEMO_MAP_ID`; `.env.example` documents it.
- `AdvancedMarkerElement` options used: `map`, `position`, `content` (custom HTML), `gmpDraggable`, `title`, `zIndex`. Events: `dragend` (then read `marker.position`), `gmp-click`. Removal: `marker.map = null`.
- `PlaceAutocompleteElement`: append to DOM; on `gmp-select`, `const place = placePrediction.toPlace(); await place.fetchFields({ fields: ['location', 'viewport'] })`. `locationBias` is set to the minimap's current bounds so results prefer the area on screen.
- `google.maps.Polyline` with `icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW }, offset: '100%' }]` draws the ground track with an arrowhead; `repeat: '15%'` adds direction ticks along it.
- Cost: one `google.maps.Map` instantiation per page load (Dynamic Maps SKU) in addition to the 3D map. No per-interaction cost.

### 3.2 Interface

```ts
export interface MapMarker {
  key: string;
  label: string;   // short: "Centre", "Start", "End", "Target"
  color: string;   // CSS colour from the field
  lat: number;
  lng: number;
}

export interface Minimap {
  /** Replaces the point markers (creates, moves, removes as needed; keeps drag state). */
  setMarkers(markers: MapMarker[]): void;
  /** Ground track as lat/lng; empty clears it. */
  setTrack(points: { lat: number; lng: number }[]): void;
  /** Camera position at the slider's time; null hides the dot. */
  setCamera(point: { lat: number; lng: number } | null): void;
  /** Which marker the next map click places; null disables picking (cursor returns to default). */
  setArmed(key: string | null): void;
  /** Zooms to show every marker and the track, padded. */
  fitAll(): void;
  /** Pans to a place chosen in the search box (does not move points). */
  panTo(bounds: google.maps.LatLngBounds | { lat: number; lng: number }): void;
  /** Blocks picking and dragging (while recording). */
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface MinimapOptions {
  mapId: string;
  /** Map click while a marker is armed. */
  onPick(key: string, lat: number, lng: number): void;
  /** A marker was dragged to a new place. */
  onDrag(key: string, lat: number, lng: number): void;
}

export async function createMinimap(container: HTMLElement, searchContainer: HTMLElement, options: MinimapOptions): Promise<Minimap>
```

### 3.3 Behaviour

- Map options: `mapTypeId: 'hybrid'`, `mapId`, `disableDefaultUI: true`, `zoomControl: true`, `gestureHandling: 'greedy'`, `clickableIcons: false`, `keyboardShortcuts: false`, initial view Toronto at zoom 12 (replaced by `fitAll` as soon as the first scene builds).
- Marker content: a 12px dot in the field colour with a 2px dark outline and a 11px white label with dark text shadow above it. `title` = label. `gmpDraggable: true` while enabled. `zIndex` by index so later points sit on top.
- Track: `Polyline`, `strokeColor: '#ffd54f'`, `strokeOpacity: 0.9`, `strokeWeight: 3`, arrowhead at the end, direction ticks every 15 %. Hidden when fewer than 2 points.
- Camera dot: a white 8px dot with black outline, `zIndex` above markers, non-draggable, `title: 'Camera'`.
- Picking: a map `click` listener reads `event.latLng` and calls `onPick` only when armed and enabled. While armed the map's `draggableCursor` is `crosshair`.
- Dragging: `dragend` → `onDrag(key, position.lat, position.lng)`.
- `fitAll`: `LatLngBounds` extended with every marker and track point; `map.fitBounds(bounds, 24)`; if the bounds are a single point, `setCenter` + `setZoom(14)` instead. The pure helper `boundsOf(points, padFraction)` returns `{ north, south, east, west }` padded by half the span per side with a floor of 0.005° and is unit-tested; `fitAll` feeds it to `fitBounds`.
- Search: `PlaceAutocompleteElement` in `searchContainer`, placeholder "Search a place…". On select, fetch `location`/`viewport`; `panTo(viewport ?? location)`. Selecting a place never moves a point; the user then clicks or drags.
- `setEnabled(false)`: clears armed, disables dragging on all markers, and ignores clicks.

### 3.4 Track sampling and camera position

The compiled scene gives camera **poses**; the minimap needs ground positions. Two pure helpers in `src/geo/trajectory.ts`:

```ts
/** Camera location for a pose: `range` metres from the centre, opposite the view heading, tilted up by `tilt`. */
export function cameraPosition(pose: CameraPose): Geodetic
// In the ENU frame at center:
//   horizontal = range · sin(tilt°),  vertical = range · cos(tilt°)
//   east  = horizontal · sin(heading° + 180°)
//   north = horizontal · cos(heading° + 180°)
//   position = toGeodetic(fromEnu(toEcef(center), east, north, vertical))
```

```ts
/** `count` camera ground positions evenly spaced in time over the scene, both ends included. */
export function sampleTrack(scene: Pick<CompiledScene, 'duration' | 'poseAt'>, count: number): Geodetic[]
```

`main.ts` calls `sampleTrack(compiled, 128)` after every successful build and hands the result to `setTrack`. The camera dot is `cameraPosition(compiled.poseAt(t))` on every slider move.

---

## 4. Picking flow (`main.ts`)

Replaces the Milestone 1 flow. One `armed` state drives the form, the minimap, and the 3D view.

- **Arm**: the point row's "Pick" button toggles arming for that key. Arming highlights the button (`.armed`), sets the minimap cursor to crosshair, and shows `#pickHint` under the minimap: `Click the map to place: Start point.`
- **Place**: a click on the minimap or on the 3D view (`gmp-click`) while armed writes lat/lng into the point (height untouched), refreshes the form, persists, schedules a rebuild, and **arms the next point** of the segment in field order, or disarms after the last. `#pickHint` updates accordingly; after the last point it shows `Drag markers or use Pick to adjust.` for 3 s, then clears.
- **Drag**: `onDrag` writes lat/lng the same way but does not change arming.
- **Mount**: when a segment type is mounted, its first point is armed, the markers are replaced, and `fitAfterBuild` is set so the next successful build fits the map. "Reset to defaults" does the same. Editing a coordinate by hand moves the marker (`setMarkers` after every valid change) but does not fit.
- **Recording**: `setEnabled(false)` on the minimap, disarm, and re-enable after.
- "Fit map" button under the minimap calls `fitAll()`.

---

## 5. Compact forms (`form.ts`, `style.css`)

Same `renderForm` API and hooks. Changes:

### 5.1 Point rows

One row per point instead of a fieldset with a header and a 3-column grid:

```
● Start point   Lat [43.62000]  Lng [-79.41000]  Height [400] m   [Pick]
```

- `div.point-row` = flex, `align-items: center`, `gap: 6px`.
- Label cell: dot + label, `flex: 0 0 110px`, ellipsis.
- Three `label.inline` cells: caption (`Lat`, `Lng`, and the field's height label shortened to `Height` with the unit `m` shown after the input); input `flex: 1`, `min-width: 70px`.
- "Pick" button, `flex: 0 0 auto`, 11px text.
- The full height label (e.g. "Look-at height above ground") goes into the input's `title` tooltip.

### 5.2 Number and select fields

- `.number-grid`: `repeat(auto-fill, minmax(150px, 1fr))`, gap `4px 8px`.
- Captions 10px, inputs 12px with `padding: 2px 5px`; the unit stays in the caption.
- Select fields identical height to inputs.

### 5.3 Global density

- Base font 12px (was 13px); buttons `padding: 3px 9px`; section padding 8px; row gaps 6px.
- The scene description becomes one line with ellipsis and the full text as `title`.
- `#summary` (path notes) moves inside the Path panel under the buttons, 11px, muted, monospaced.
- Record row and timeline keep their size (they are the primary controls).

Nothing about validation, arming highlight, or `setEnabled` changes.

---

## 6. Collapsible panels (`index.html`, `main.ts`)

```html
<details id="pathPanel" open>
  <summary><span class="summary-title">Path</span> <span id="pathSummary" class="summary-info">Cinematic orbit · 84.3 s · 5.1 km</span></summary>
  <div class="row">Scene <select id="sceneType"></select></div>
  <div id="sceneDescription"></div>
  <div id="paramsForm"></div>
  <div class="row"><button id="resetBtn">Reset to defaults</button><button id="frameBtn">Frame scene</button></div>
  <div id="summary"></div>
</details>
<details id="settings">
  <summary><span class="summary-title">Output &amp; quality</span> <span id="settingsSummary" class="summary-info">1920×1080 · 30 fps</span></summary>
  …unchanged…
</details>
<div id="status"></div>
```

- `#pathSummary` is updated on every successful build: `${type.name} · ${duration.toFixed(1)} s · ${(length/1000).toFixed(1)} km`; on an invalid scene: `${type.name} · invalid`.
- `#settingsSummary` is updated when settings apply: `${width}×${height} · ${fps} fps`.
- Open/closed state of both panels is stored under `scene-creator:ui:v1` as `{ pathOpen: boolean; settingsOpen: boolean }` on every `toggle` event and restored on load. Defaults: path open, settings closed. Invalid stored JSON falls back to defaults. A pure `parseUiState(raw)` is unit-tested.
- Summary rows use the same style as today's settings summary, with the info span muted and right-trimmed with ellipsis.

`#pickHint` moves under the minimap (§2) and is no longer inside the panel.

---

## 7. Repository changes

```
maps/
  .env.example                 + VITE_GOOGLE_MAPS_MAP_ID= (optional; DEMO_MAP_ID when empty)
  index.html                   #bottom with #mapColumn (#placeSearch, #minimap, #pickHint, #fitMapBtn) and #controls; Path <details>
  src/
    minimap.ts                 createMinimap, boundsOf
    ui-state.ts                parseUiState, loadUiState, saveUiState
    form.ts                    compact point rows; unit shown after height input; tooltips
    main.ts                    minimap wiring, picking flow, panel summaries, ui state
    style.css                  two-column bottom, compact metrics, panel summaries, marker styles
    geo/trajectory.ts          + cameraPosition, sampleTrack
    maps-loader.ts             + readMapId()
  test/
    trajectory.test.ts         + cameraPosition round trip, sampleTrack
    minimap.test.ts            boundsOf
    ui-state.test.ts           parseUiState
```

---

## 8. Testing (`npm test`)

- `cameraPosition(lookAtPose(P, T))` returns `P` within 1 cm for several P/T pairs including P above T (tilt 0) and P level with T (tilt 90).
- `cameraPosition(aheadPose(P, h, p, d))` returns `P` within 1 cm.
- `sampleTrack(scene, 5)` on a stub scene calls `poseAt` with `0, d/4, d/2, 3d/4, d` and returns 5 points; `sampleTrack(scene, 1)` returns the start only.
- `boundsOf` pads by half the span with a 0.005° floor, clamps latitude to ±90, and returns a degenerate padded box for a single point.
- `parseUiState` accepts `{pathOpen, settingsOpen}` booleans, rejects anything else, and returns the defaults for `null`/garbage.

Manual acceptance covers the map (§9).

---

## 9. Acceptance criteria

1. The bottom area shows a hybrid minimap on the left and the panel on the right; below 800px width they stack.
2. On load, the minimap shows the current segment's points as coloured, labelled markers, the yellow ground track with an arrowhead, and a white camera dot at the slider's time; the view is fitted to them.
3. Moving the slider moves the camera dot along the track.
4. Selecting "Fly-by" arms Start; three clicks on the minimap place Start, End and Target in that order, the form updates after each, the track rebuilds, and arming ends after Target.
5. Dragging a marker updates the form and rebuilds; typing a coordinate moves the marker.
6. Clicking the 3D view while a point is armed still places it.
7. The search box pans the minimap to the chosen place without moving points; "Fit map" returns to the scene.
8. The Path panel collapses and expands; its summary shows type, duration and length and stays correct after edits; both panels' states survive a reload.
9. Point rows are single lines; number fields sit in a tighter grid; every previous validation behaviour (highlighting, disabled slider/Record) still works.
10. While recording, the minimap ignores clicks and drags and markers cannot be dragged; afterwards picking works again.
11. `npm test` passes; `npm run build` type-checks with `strict: true`.

---

## 10. Risks and notes

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `DEMO_MAP_ID` shows a console notice or is retired | Markers fail | `VITE_GOOGLE_MAPS_MAP_ID` supported from day one; README explains creating a map ID in Cloud Console |
| Places library adds cost per session | Billing | Autocomplete session pricing applies per search; the box is idle unless typed into. Note it in README |
| Track sampling for long orbits looks polygonal | Cosmetic | 128 samples; raise to 256 if visible |
| Minimap height at 42vh is short on small screens | Usability | Stacked layout below 800px; sidebar layout as the documented alternative (§2) |
| `gmp-click` on the 3D view fires when dragging the camera | Accidental placement | Unchanged from Milestone 1; picking is only active while armed, and the minimap is now the primary picking surface |
