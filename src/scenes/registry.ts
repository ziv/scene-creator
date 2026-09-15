import type { SegmentType } from './types';
import { cinematicOrbit } from './orbit';
import { flyBy } from './flyby';
import { flyOver } from './flyover';

/** All available segment types, in menu order. Add a new type by appending it here. */
export const segmentTypes: readonly SegmentType[] = [cinematicOrbit, flyBy, flyOver];

export function getSegmentType(id: string): SegmentType {
  const type = segmentTypes.find((s) => s.id === id);
  if (!type) throw new Error(`Unknown segment type "${id}"`);
  return type;
}
