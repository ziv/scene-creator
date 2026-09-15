import { loadMapsApi, readApiKey } from './maps-loader';
import { createViewport, type Viewport } from './viewport';
import { createGroundSampler } from './elevation';
import { renderForm, type FormHandle } from './form';
import { defaultDocument, defaultSegment, load, save } from './storage';
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
const steadyBadge = $<HTMLDivElement>('steady');
const timeSlider = $<HTMLInputElement>('timeSlider');
const timeLabel = $<HTMLDivElement>('timeLabel');
const sceneSelect = $<HTMLSelectElement>('sceneType');
const sceneDescription = $<HTMLDivElement>('sceneDescription');
const pickHint = $<HTMLDivElement>('pickHint');
const paramsForm = $<HTMLDivElement>('paramsForm');
const resetBtn = $<HTMLButtonElement>('resetBtn');
const frameBtn = $<HTMLButtonElement>('frameBtn');
const summaryEl = $<HTMLDivElement>('summary');
const statusEl = $<HTMLDivElement>('status');

const REBUILD_DEBOUNCE_MS = 250;

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function pointFields(type: SegmentType): PointField[] {
  return type.fields.filter((f): f is PointField => f.kind === 'point');
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
  const [viewport, sampleGround] = await Promise.all([createViewport(viewportEl), createGroundSampler()]);

  viewport.onSteadyChange((steady) => {
    steadyBadge.textContent = steady ? 'Ready' : 'Loading tiles…';
    steadyBadge.classList.toggle('ready', steady);
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

  const persist = () => save(doc);

  // ---- Scene selector -------------------------------------------------------
  for (const t of segmentTypes) {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = t.name;
    sceneSelect.append(option);
  }

  // ---- Picking via the 3D view ---------------------------------------------
  function setArmed(next: string | null): void {
    armed = next;
    form?.setArmed(next);
    const field = next ? pointFields(type).find((f) => f.key === next) : undefined;
    pickHint.textContent = field ? `Click the 3D view to place: ${field.label}.` : '';
  }

  viewport.onClick((p) => {
    if (!armed) return;
    const point = segment.params[armed] as Waypoint;
    point.lat = p.lat;
    point.lng = p.lng;
    form?.refresh();
    setArmed(null);
    persist();
    scheduleRebuild();
  });

  // ---- Form -----------------------------------------------------------------
  function mountSegment(): void {
    type = getSegmentType(segment.type);
    sceneSelect.value = type.id;
    sceneDescription.textContent = type.description;
    form?.destroy();
    form = renderForm(paramsForm, type.fields, segment.params, {
      onChange(valid) {
        if (!valid) {
          compiled = null;
          timeSlider.disabled = true;
          setStatus('Fix the highlighted fields.', true);
          return;
        }
        persist();
        scheduleRebuild();
      },
      onPick(key) {
        setArmed(armed === key ? null : key);
      },
    });
    setArmed(null);
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
    setStatus('Sampling ground…');
    try {
      const built = await compile(doc, { sampleGround });
      if (gen !== generation) return; // superseded by a newer edit
      compiled = built;
      Object.assign(window, { compiled });
      timeSlider.max = String(built.duration);
      timeSlider.value = String(fraction * built.duration);
      timeSlider.disabled = false;
      showTime(Number(timeSlider.value));
      renderSummary();
      if (sampleGround.fallbackReason) setStatus(`Ready (with a caveat). ${sampleGround.fallbackReason}`, true);
      else setStatus('Ready.');
    } catch (err) {
      if (gen !== generation) return;
      compiled = null;
      summaryEl.textContent = '';
      timeLabel.textContent = '—';
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
    viewport.setPose(compiled.poseAt(t));
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

  // Debugging access from the browser console.
  Object.assign(window, { viewport, doc });

  await rebuild();
}

main().catch((err) => {
  console.error(err);
  setStatus(`Startup failed: ${err instanceof Error ? err.message : String(err)}`, true);
});
