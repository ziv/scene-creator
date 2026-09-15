import { describe, expect, it } from 'vitest';
import { attributionLine, parseProviderTexts, selectProviderSection } from '../src/attribution';

describe('parseProviderTexts', () => {
  it('drops labels, blanks, inlined CSS and duplicates', () => {
    const texts = [
      'Map data',
      '  ',
      'Vexcel Imaging US, Inc., Landsat / Copernicus, NOAA',
      'dialog.x{display:flex}',
      'Google Maps Terms',
      'Vexcel Imaging US, Inc., Landsat / Copernicus, NOAA',
      'Google Maps',
      'Data SIO,  NOAA, U.S. Navy',
    ];
    expect(parseProviderTexts(texts)).toBe('Vexcel Imaging US, Inc., Landsat / Copernicus, NOAA, Data SIO, NOAA, U.S. Navy');
  });

  it('returns an empty string when nothing remains', () => {
    expect(parseProviderTexts(['Map data', ''])).toBe('');
  });
});

describe('selectProviderSection', () => {
  it('prefers the section labelled "Map data" so UI labels in other sections are ignored', () => {
    const sections = [['Keyboard shortcuts'], ['Map data', 'Vexcel, NOAA'], ['Google Maps Terms']];
    expect(parseProviderTexts(selectProviderSection(sections))).toBe('Vexcel, NOAA');
  });

  it('falls back to every section when none is labelled', () => {
    expect(selectProviderSection([['A'], ['B']])).toEqual(['A', 'B']);
  });
});

describe('attributionLine', () => {
  it('composes the frame line', () => {
    expect(attributionLine('Vexcel, NOAA', 2026)).toBe('Map data ©2026 Google · Vexcel, NOAA');
    expect(attributionLine('', 2026)).toBe('Map data ©2026 Google');
  });
});
