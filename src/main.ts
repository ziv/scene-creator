// Hooks must be installed before the Maps API loads (see hooks.ts).
import './hooks';
import { loadMapsApi, readApiKey, readMapId } from './maps-loader';
import { createMinimap } from './minimap';
import { cameraPosition, sampleTrack } from './geo/trajectory';
import { loadUiState, saveUiState } from './ui-state';
import { createViewport, type Viewport } from './viewport';
import { createGroundSampler } from './elevation';
import { renderForm, shortPointLabel, type FormHandle } from './form';
import { defaultDocument, defaultSegment, load, save } from './storage';
import {
  applyParams,
  loadSettings,
  presets,
  saveSettings,
  settingsFields,
  settingsToParams,
  defaultSettings,
  type RecordingSettings,
} from './settings';
import { applyStage, layoutStage } from './stage';
import { attributionLine, drawAttribution, readAttribution } from './attribution';
import { Mp4Encoder } from './encoder';
import { planFrames, recordFrames, RecordingCancelled, type RecordProgress } from './recorder';
import { detectInternals, detectSupport, internals } from './support';
import {
  compile,
  getSegmentType,
  segmentTypes,
  type CompiledScene,
  type Params,
  type PointField,
  type SceneDocument,
  type SegmentType,
  type Waypoint,
} from './scenes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const viewportEl = $<HTMLElement>('viewport');
const stageEl = $<HTMLDivElement>('stage');
const stageShield = $<HTMLDivElement>('stageShield');
const steadyBadge = $<HTMLDivElement>('steady');
const timeSlider = $<HTMLInputElement>('timeSlider');
const timeLabel = $<HTMLDivElement>('timeLabel');
const recordBtn = $<HTMLButtonElement>('recordBtn');
const cancelBtn = $<HTMLButtonElement>('cancelBtn');
const progressBar = $<HTMLDivElement>('progressBar');
const progressFill = $<HTMLDivElement>('progressFill');
const recordStatus = $<HTMLDivElement>('recordStatus');
const sceneSelect = $<HTMLSelectElement>('sceneType');
const sceneDescription = $<HTMLDivElement>('sceneDescription');
const pickHint = $<HTMLDivElement>('pickHint');
const paramsForm = $<HTMLDivElement>('paramsForm');
const resetBtn = $<HTMLButtonElement>('resetBtn');
const frameBtn = $<HTMLButtonElement>('frameBtn');
const minimapEl = $<HTMLDivElement>('minimap');
const placeSearchEl = $<HTMLDivElement>('placeSearch');
const fitMapBtn = $<HTMLButtonElement>('fitMapBtn');
const pathPanel = $<HTMLDetailsElement>('pathPanel');
const pathSummary = $<HTMLSpanElement>('pathSummary');
const settingsPanel = $<HTMLDetailsElement>('settings');
const settingsSummary = $<HTMLSpanElement>('settingsSummary');
const presetsEl = $<HTMLDivElement>('presets');
const settingsForm = $<HTMLDivElement>('settingsForm');
const resetSettingsBtn = $<HTMLButtonElement>('resetSettingsBtn');
const renderInfo = $<HTMLDivElement>('renderInfo');
const summaryEl = $<HTMLDivElement>('summary');
const statusEl = $<HTMLDivElement>('status');

const REBUILD_DEBOUNCE_MS = 250;
const UNSTEADY_GRACE_MS = 150;
const INTERNALS_TIMEOUT_MS = 5000;
const TRACK_SAMPLES = 128;



function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function setRecordStatus(text: string, isError = false): void {
  recordStatus.textContent = text;
  recordStatus.classList.toggle('error', isError);
}

function pointFields(type: SegmentType): PointField[] {
  return type.fields.filter((f): f is PointField => f.kind === 'point');
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return ` — ETA ${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  return `${Math.round(seconds / 60)} min`;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'scene';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Waits `count` animation frames; rejects on abort. */
function waitFrames(count: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let left = count;
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    const tick = () => {
      if (signal.aborted) return;
      if (--left <= 0) {
        signal.removeEventListener('abort', onAbort);
        resolve();
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
}

async function main(): Promise<void> {
  // ---- API key & libraries --------------------------------------------------
  const key = readApiKey();
  if (!key) {
    setStatus('Missing Google Maps API key. Create .env.local with VITE_GOOGLE_MAPS_API_KEY=<key>', true);
    steadyBadge.textContent = 'No API key';
    return;
  }
  await loadMapsApi(key);

  // ---- Settings & stage (before the map exists, so it is created at the right size) --
  const settings: RecordingSettings = loadSettings();
  let settingsParams: Params = settingsToParams(settings);

  function fitStage(): void {
    const layout = layoutStage(
      settings.video.width,
      settings.video.height,
      window.devicePixelRatio || 1,
      viewportEl.clientWidth,
      viewportEl.clientHeight,
    );
    applyStage(stageEl, layout);
  }
  fitStage();
  window.addEventListener('resize', fitStage);
  const watchDpr = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => {
      fitStage();
      watchDpr();
    }, { once: true });
  };
  watchDpr();

  const [viewport, sampleGround, logo, minimap] = await Promise.all([
    createViewport(stageEl),
    createGroundSampler(),
    loadImage('/google-maps-logo.svg'),
    createMinimap(minimapEl, placeSearchEl, {
      mapId: readMapId(),
      onPick: (key, lat, lng) => placePoint(key, lat, lng, true),
      onDrag: (key, lat, lng) => placePoint(key, lat, lng, false),
    }),
  ]);

  // ---- Collapsible panels ---------------------------------------------------
  const uiState = loadUiState();
  pathPanel.open = uiState.pathOpen;
  settingsPanel.open = uiState.settingsOpen;
  const persistUi = () => saveUiState({ pathOpen: pathPanel.open, settingsOpen: settingsPanel.open });
  pathPanel.addEventListener('toggle', persistUi);
  settingsPanel.addEventListener('toggle', persistUi);

  viewport.onSteadyChange((steady) => {
    steadyBadge.textContent = steady ? 'Ready' : 'Loading tiles…';
    steadyBadge.classList.toggle('ready', steady);
    if (steady) renderInfoLine(); // the canvas has taken its new size by now
  });
  viewport.onError((message) => setStatus(`Map error: ${message}`, true));

  // ---- Document state -------------------------------------------------------
  const doc: SceneDocument = load() ?? defaultDocument();
  // Milestone 1 edits exactly one segment; the model and compiler handle any number.
  let segment = doc.segments[0];
  let type: SegmentType = getSegmentType(segment.type);
  /** Per-type param edits kept for the session so switching types back and forth loses nothing. */
  const paramsByType: Record<string, Params> = { [segment.type]: segment.params };

  let compiled: CompiledScene | null = null;
  let form: FormHandle | null = null;
  let armed: string | null = null;
  let recording = false;
  let settingsValid = true;
  /** Fit the minimap once the next trajectory is built (so the track is included). */
  let fitAfterBuild = true;
  let hintTimer: number | undefined;
  /** Measured seconds per frame from the last recording of the session; 0.5 s until then. */
  let secondsPerFrame = 0.5;

  const persist = () => save(doc);

  // ---- Scene selector -------------------------------------------------------
  for (const t of segmentTypes) {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = t.name;
    sceneSelect.append(option);
  }

  // ---- Picking (minimap or 3D view) ----------------------------------------
  function setArmed(next: string | null, hint?: string): void {
    armed = next;
    form?.setArmed(next);
    minimap.setArmed(next);
    window.clearTimeout(hintTimer);
    const field = next ? pointFields(type).find((f) => f.key === next) : undefined;
    pickHint.textContent = field ? `Click the map to place: ${field.label}.` : hint ?? '';
    if (!field && hint) hintTimer = window.setTimeout(() => (pickHint.textContent = ''), 3000);
  }

  function syncMarkers(): void {
    minimap.setMarkers(
      pointFields(type).map((f) => {
        const w = segment.params[f.key] as Waypoint;
        return { key: f.key, label: shortPointLabel(f.label), color: f.color, lat: w.lat, lng: w.lng };
      }),
    );
  }

  /** Writes a picked or dragged location into a point; `advance` arms the next point of the segment. */
  function placePoint(key: string, lat: number, lng: number, advance: boolean): void {
    if (recording) return;
    const point = segment.params[key] as Waypoint | undefined;
    if (!point) return;
    point.lat = lat;
    point.lng = lng;
    form?.refresh();
    syncMarkers();
    persist();
    scheduleRebuild();
    if (advance) {
      const keys = pointFields(type).map((f) => f.key);
      const next = keys[keys.indexOf(key) + 1] ?? null;
      setArmed(next, next ? undefined : 'Drag markers or use Pick to adjust.');
    }
  }

  viewport.onClick((p) => {
    if (armed) placePoint(armed, p.lat, p.lng, true);
  });
  fitMapBtn.addEventListener('click', () => minimap.fitAll());

  // ---- Scene form -----------------------------------------------------------
  function mountSegment(): void {
    type = getSegmentType(segment.type);
    sceneSelect.value = type.id;
    sceneDescription.textContent = type.description;
    sceneDescription.title = type.description;
    form?.destroy();
    form = renderForm(paramsForm, type.fields, segment.params, {
      onChange(valid) {
        if (!valid) {
          compiled = null;
          timeSlider.disabled = true;
          updateRecordButton();
          setStatus('Fix the highlighted fields.', true);
          return;
        }
        syncMarkers();
        persist();
        scheduleRebuild();
      },
      onPick(key) {
        setArmed(armed === key ? null : key);
      },
    });
    syncMarkers();
    minimap.setTrack([]);
    setArmed(pointFields(type)[0]?.key ?? null);
    fitAfterBuild = true;
    persist();
  }

  sceneSelect.addEventListener('change', () => {
    const id = sceneSelect.value;
    const params = paramsByType[id] ?? structuredClone(getSegmentType(id).defaults);
    paramsByType[id] = params;
    segment = { ...defaultSegment(id), params };
    doc.segments[0] = segment;
    mountSegment();
    scheduleRebuild();
  });

  resetBtn.addEventListener('click', () => {
    segment.params = structuredClone(type.defaults);
    paramsByType[type.id] = segment.params;
    mountSegment();
    scheduleRebuild();
  });

  frameBtn.addEventListener('click', () => {
    if (!compiled) return;
    viewport.setPose({
      center: compiled.focus,
      range: Math.max(2.5 * compiled.radius, 500),
      heading: 0,
      tilt: 45,
      roll: 0,
    });
  });

  mountSegment();

  // ---- Output & quality settings -------------------------------------------
  let settingsTimer: number | undefined;
  const mountSettingsForm = (): FormHandle =>
    renderForm(settingsForm, settingsFields, settingsParams, {
      onChange(valid) {
        settingsValid = valid;
        if (!valid) {
          setRecordStatus('Fix the highlighted settings.', true);
          updateRecordButton();
          return;
        }
        window.clearTimeout(settingsTimer);
        settingsTimer = window.setTimeout(applyCurrentSettings, REBUILD_DEBOUNCE_MS);
      },
      onPick() {},
    });
  let settingsForm_ = mountSettingsForm();

  function renderSettingsSummary(): void {
    settingsSummary.textContent = `${settings.video.width}×${settings.video.height} · ${settings.video.fps} fps`;
  }
  renderSettingsSummary();

  function applyCurrentSettings(): void {
    applyParams(settingsParams, settings);
    settingsForm_.refresh(); // shows rounded (even) sizes
    saveSettings(settings);
    fitStage();
    renderInfoLine();
    renderSettingsSummary();
    setRecordStatus('');
    updateRecordButton();
  }

  for (const preset of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.label;
    button.addEventListener('click', () => {
      settingsParams.width = preset.width;
      settingsParams.height = preset.height;
      settingsForm_.refresh();
      settingsValid = true;
      applyCurrentSettings();
    });
    presetsEl.append(button);
  }

  resetSettingsBtn.addEventListener('click', () => {
    settingsParams = settingsToParams(defaultSettings);
    settingsForm_.destroy();
    settingsForm_ = mountSettingsForm();
    settingsValid = true;
    applyCurrentSettings();
  });

  function renderInfoLine(): void {
    const { width, height, fps } = settings.video;
    const lines: string[] = [];
    const actual = internals.canvas;
    if (actual && (actual.width !== width || actual.height !== height)) {
      lines.push(`Rendering at ${actual.width}×${actual.height} (browser capped; output ${width}×${height} will be scaled)`);
    } else {
      lines.push(`Rendering at ${width}×${height}`);
    }
    if (compiled) {
      const { frameCount } = planFrames(compiled.duration, fps);
      lines.push(`${frameCount} frames at ${fps} fps · ~${formatDuration(frameCount * secondsPerFrame)} at ${secondsPerFrame.toFixed(2)} s/frame`);
    }
    renderInfo.textContent = lines.join('\n');
  }

  // ---- Recording support ----------------------------------------------------
  const support = detectSupport();
  let internalsSupport = { ok: false, reasons: ['Checking the map…'] };

  function updateRecordButton(): void {
    const ok = support.ok && internalsSupport.ok && settingsValid && compiled !== null && !recording;
    recordBtn.disabled = !ok;
    if (!recording) {
      const reasons = [...support.reasons, ...internalsSupport.reasons];
      if (reasons.length > 0) setRecordStatus(reasons.join(' '), !internalsSupport.ok && support.ok ? true : !support.ok);
    }
  }
  updateRecordButton();

  void detectInternals(INTERNALS_TIMEOUT_MS, () => viewport.whenSteady()).then((result) => {
    internalsSupport = result;
    if (result.ok) setRecordStatus('');
    else console.warn(result.reasons.join(' '));
    updateRecordButton();
    renderInfoLine();
  });

  // ---- Compiling ------------------------------------------------------------
  let rebuildTimer: number | undefined;
  let generation = 0;

  function scheduleRebuild(): void {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => void rebuild(), REBUILD_DEBOUNCE_MS);
  }

  async function rebuild(): Promise<void> {
    const gen = ++generation;
    // Keep the scrub position as a fraction so it survives duration changes.
    const fraction = compiled && compiled.duration > 0 ? Number(timeSlider.value) / compiled.duration : 0;
    timeSlider.disabled = true;
    updateRecordButton();
    setStatus('Sampling ground…');
    try {
      const built = await compile(doc, { sampleGround });
      if (gen !== generation) return; // superseded by a newer edit
      compiled = built;
      Object.assign(window, { compiled });
      timeSlider.max = String(built.duration);
      timeSlider.value = String(fraction * built.duration);
      timeSlider.disabled = false;
      minimap.setTrack(sampleTrack(built, TRACK_SAMPLES));
      if (fitAfterBuild) {
        minimap.fitAll();
        fitAfterBuild = false;
      }
      showTime(Number(timeSlider.value));
      renderSummary();
      renderInfoLine();
      updateRecordButton();
      pathSummary.textContent = `${type.name} · ${built.duration.toFixed(1)} s · ${(built.length / 1000).toFixed(1)} km`;
      if (sampleGround.fallbackReason) setStatus(`Ready (with a caveat). ${sampleGround.fallbackReason}`, true);
      else setStatus('Ready.');
    } catch (err) {
      if (gen !== generation) return;
      compiled = null;
      summaryEl.textContent = '';
      timeLabel.textContent = '—';
      minimap.setTrack([]);
      minimap.setCamera(null);
      pathSummary.textContent = `${type.name} · invalid`;
      updateRecordButton();
      setStatus(`Invalid scene: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  function renderSummary(): void {
    if (!compiled) {
      summaryEl.textContent = '';
      return;
    }
    const lines = compiled.segments.flatMap((s, i) => [
      `${i + 1}. ${getSegmentType(s.segment.type).name}`,
      ...s.trajectory.notes.map((n) => `   ${n}`),
    ]);
    lines.push(`Path: ${compiled.length.toFixed(0)} m → ${compiled.duration.toFixed(1)} s`);
    summaryEl.textContent = lines.join('\n');
  }

  // ---- Timeline -------------------------------------------------------------
  function showTime(t: number): void {
    if (!compiled) return;
    const pose = compiled.poseAt(t);
    viewport.setPose(pose);
    minimap.setCamera(cameraPosition(pose));
    const { index } = compiled.locate(t);
    const name = getSegmentType(compiled.segments[index].segment.type).id;
    timeLabel.textContent =
      `${t.toFixed(1)} s / ${compiled.duration.toFixed(1)} s · ` +
      `segment ${index + 1}/${compiled.segments.length} (${name}) · ${(compiled.length / 1000).toFixed(1)} km`;
  }

  timeSlider.addEventListener('input', () => showTime(Number(timeSlider.value)));
  timeSlider.addEventListener('keydown', (event) => {
    if (!compiled) return;
    const t = Number(timeSlider.value);
    let next: number | null = null;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = compiled.duration;
    else if (event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowUp')) next = t + 1;
    else if (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowDown')) next = t - 1;
    if (next === null) return;
    event.preventDefault();
    timeSlider.value = String(Math.min(Math.max(next, 0), compiled.duration));
    showTime(Number(timeSlider.value));
  });

  // ---- Recording ------------------------------------------------------------
  const outCanvas = document.createElement('canvas');
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.imageSmoothingQuality = 'high';
  let abort: AbortController | null = null;

  function setEditingEnabled(enabled: boolean): void {
    form?.setEnabled(enabled);
    settingsForm_.setEnabled(enabled);
    for (const el of [sceneSelect, timeSlider, resetBtn, frameBtn, resetSettingsBtn, fitMapBtn]) el.disabled = !enabled;
    minimap.setEnabled(enabled);
    for (const el of presetsEl.querySelectorAll('button')) el.disabled = !enabled;
    stageShield.hidden = enabled;
    viewport.setInteractive(enabled);
    if (!enabled) setArmed(null);
  }

  cancelBtn.addEventListener('click', () => {
    abort?.abort();
    cancelBtn.disabled = true;
    setRecordStatus('Cancelling…');
  });

  recordBtn.addEventListener('click', async () => {
    if (!compiled || recording || recordBtn.disabled) return;
    const scene = compiled;
    const root = internals.root;
    const mapCanvas = internals.canvas;
    if (!root || !mapCanvas) return;

    recording = true;
    abort = new AbortController();
    const signal = abort.signal;
    recordBtn.hidden = true;
    cancelBtn.hidden = false;
    cancelBtn.disabled = false;
    progressBar.hidden = false;
    progressFill.style.width = '0%';
    setEditingEnabled(false);
    updateRecordButton();

    const { width, height } = settings.video;
    outCanvas.width = width;
    outCanvas.height = height;
    const year = new Date().getFullYear();
    let lastProviders: string | null = null;
    let lastLine = attributionLine('', year);
    let attributionWarned = false;

    const grab = () => {
      outCtx.drawImage(mapCanvas, 0, 0, width, height);
      const read = readAttribution(root);
      if (!read && !attributionWarned) {
        attributionWarned = true;
        console.warn('Provider attribution not found in the map; only "Map data ©year Google" will be shown.');
      }
      const providers = read?.providers ?? '';
      if (providers !== lastProviders) {
        lastProviders = providers;
        lastLine = attributionLine(providers, year);
      }
      drawAttribution(outCtx, width, height, logo, lastLine, settings.attribution.barHeight);
    };

    // Time hidden in the background is excluded from the ETA.
    let hiddenSince: number | null = null;
    let hiddenTotal = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenSince = performance.now();
        setRecordStatus('Paused: bring this tab to the front to continue.');
      } else if (hiddenSince !== null) {
        hiddenTotal += performance.now() - hiddenSince;
        hiddenSince = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const now = () => performance.now() - hiddenTotal - (hiddenSince !== null ? performance.now() - hiddenSince : 0);

    let encoder: Mp4Encoder | null = null;
    const startedAt = performance.now();
    try {
      encoder = await Mp4Encoder.create(outCanvas, settings.video);
      const enc = encoder;
      const result = await recordFrames(
        scene,
        settings,
        {
          settle: (pose, s) =>
            viewport.setPoseAndSettle(pose, { unsteadyGraceMs: UNSTEADY_GRACE_MS, timeoutMs: settings.steady.timeoutMs, signal: s }),
          waitFrames,
          grab,
          addFrame: (i) => enc.addFrame(i),
          now,
        },
        (p: RecordProgress) => {
          progressFill.style.width = `${(p.frame / p.frameCount) * 100}%`;
          if (document.hidden) return;
          if (p.phase === 'warm-up') setRecordStatus('Warming up: loading the first view…');
          else if (p.phase === 'recording') setRecordStatus(`Recording frame ${p.frame}/${p.frameCount}${formatEta(p.etaSeconds)}`);
          else setRecordStatus('Finalizing MP4…');
        },
        signal,
      );
      const blob = await encoder.finalize();
      encoder = null;
      secondsPerFrame = Math.max(0.05, (performance.now() - startedAt - hiddenTotal) / 1000 / result.frameCount);
      const filename = `${slug(doc.name)}.mp4`;
      Object.assign(window, { lastRecording: blob });
      downloadBlob(blob, filename);
      const timeouts = result.steadyTimeouts > 0 ? `, ${result.steadyTimeouts} frames captured after a steady timeout` : '';
      setRecordStatus(`Done — ${filename} (${(blob.size / 1e6).toFixed(1)} MB), ${result.frameCount} frames${timeouts}`);
    } catch (err) {
      if (err instanceof RecordingCancelled) {
        setRecordStatus('Recording cancelled.');
      } else {
        console.error(err);
        setRecordStatus(`Recording failed: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
      await encoder?.cancel().catch(() => {});
      recording = false;
      abort = null;
      progressBar.hidden = true;
      cancelBtn.hidden = true;
      recordBtn.hidden = false;
      setEditingEnabled(true);
      timeSlider.disabled = compiled === null;
      updateRecordButton();
      renderInfoLine();
      showTime(Number(timeSlider.value));
    }
  });

  // Debugging access from the browser console.
  Object.assign(window, { viewport, minimap, doc, settings, internals, readAttribution });

  await rebuild();
}

main().catch((err) => {
  console.error(err);
  setStatus(`Startup failed: ${err instanceof Error ? err.message : String(err)}`, true);
});
