import { getSegmentType, paramsMatchSchema, type SceneDocument, type SceneSegment } from './scenes';

const STORAGE_KEY = 'scene-creator:v1';

export function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A new segment of the given type with its defaults. */
export function defaultSegment(typeId: string): SceneSegment {
  const type = getSegmentType(typeId);
  return { id: newId(), type: type.id, params: structuredClone(type.defaults), join: { kind: 'cut' } };
}

export function defaultDocument(): SceneDocument {
  return { version: 1, id: newId(), name: 'Untitled scene', segments: [defaultSegment('orbit')] };
}

function isValidSegment(s: unknown): s is SceneSegment {
  if (typeof s !== 'object' || s === null) return false;
  const seg = s as Partial<SceneSegment>;
  if (typeof seg.id !== 'string' || typeof seg.type !== 'string') return false;
  let type;
  try {
    type = getSegmentType(seg.type);
  } catch {
    return false;
  }
  if (!paramsMatchSchema(type.fields, seg.params)) return false;
  const join = seg.join as Partial<{ kind: string; seconds: number }> | undefined;
  if (!join || typeof join !== 'object') return false;
  if (join.kind === 'cut') return true;
  return join.kind === 'blend' && typeof join.seconds === 'number' && Number.isFinite(join.seconds);
}

/** Returns the stored document, or null if absent, malformed, or from an unknown version. */
export function load(): SceneDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as Partial<SceneDocument>;
    if (doc.version !== 1 || typeof doc.id !== 'string' || typeof doc.name !== 'string') return null;
    if (!Array.isArray(doc.segments) || doc.segments.length === 0) return null;
    if (!doc.segments.every(isValidSegment)) return null;
    return doc as SceneDocument;
  } catch {
    return null;
  }
}

export function save(doc: SceneDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage unavailable; nothing to do.
  }
}
