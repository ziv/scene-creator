import { describe, expect, it } from 'vitest';
import { defaultUiState, parseUiState } from '../src/ui-state';

describe('parseUiState', () => {
  it('accepts two booleans', () => {
    expect(parseUiState(JSON.stringify({ pathOpen: false, settingsOpen: true }))).toEqual({ pathOpen: false, settingsOpen: true });
  });

  it('falls back to the defaults for null, garbage or partial data', () => {
    expect(parseUiState(null)).toEqual(defaultUiState);
    expect(parseUiState('{')).toEqual(defaultUiState);
    expect(parseUiState(JSON.stringify({ pathOpen: 'yes', settingsOpen: true }))).toEqual(defaultUiState);
    expect(parseUiState(JSON.stringify({ pathOpen: true }))).toEqual(defaultUiState);
    expect(parseUiState('null')).toEqual(defaultUiState);
  });
});
