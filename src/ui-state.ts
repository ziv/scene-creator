/** Open/closed state of the collapsible panels, remembered across reloads. */
export interface UiState {
  pathOpen: boolean;
  settingsOpen: boolean;
}

export const defaultUiState: UiState = { pathOpen: true, settingsOpen: false };

const STORAGE_KEY = 'scene-creator:ui:v1';

/** Parses stored JSON; anything not exactly two booleans falls back to the defaults. Pure. */
export function parseUiState(raw: string | null): UiState {
  if (!raw) return { ...defaultUiState };
  try {
    const v = JSON.parse(raw) as Partial<UiState> | null;
    if (typeof v !== 'object' || v === null) return { ...defaultUiState };
    if (typeof v.pathOpen !== 'boolean' || typeof v.settingsOpen !== 'boolean') return { ...defaultUiState };
    return { pathOpen: v.pathOpen, settingsOpen: v.settingsOpen };
  } catch {
    return { ...defaultUiState };
  }
}

export function loadUiState(): UiState {
  try {
    return parseUiState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...defaultUiState };
  }
}

export function saveUiState(state: UiState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable; nothing to do.
  }
}
