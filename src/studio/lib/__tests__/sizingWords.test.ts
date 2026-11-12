import { describe, expect, it } from 'vitest';
import { LAYER_WIDTHS } from '@local-app-studio/runtime/spec/sizing';
import { WIDTH_LABELS, pairChange, sizingChange, sizingLine, summarySuffix, widthPhrase } from '../sizingWords';

describe('sizing in plain words', () => {
  it('labels every width, widest first', () => {
    expect(Object.keys(WIDTH_LABELS)).toEqual([...LAYER_WIDTHS]);
    expect(Object.values(WIDTH_LABELS)).toEqual(['Whole row', 'Three quarters', 'Two thirds', 'Half', 'A third', 'A quarter', 'Only what it needs']);
  });

  it('has a phrase for every width', () => {
    expect(LAYER_WIDTHS.map(widthPhrase)).toEqual([
      'the whole row',
      'three quarters of the row',
      'two thirds of the row',
      'half the row',
      'a third of the row',
      'a quarter of the row',
      'only the space it needs',
    ]);
  });

  it('says what the settings line says', () => {
    expect(sizingLine({ width: 'half', grow: false })).toBe('Takes half the row');
    expect(sizingLine({ width: 'third', grow: true })).toBe('Takes at least a third of the row and fills the rest');
    expect(sizingLine({ width: 'fit', grow: true })).toBe('Fills the rest of the row');
    expect(sizingLine({ width: 'fit', grow: false })).toBe('Takes only the space it needs');
    expect(sizingLine({ width: 'full', grow: false })).toBe('Takes the whole row');
    expect(sizingLine({ width: 'full', grow: true })).toBe('Takes the whole row');
  });

  it('words a change', () => {
    expect(sizingChange('Quick add', { width: 'half', grow: false })).toBe('Quick add now takes half the row.');
    expect(sizingChange('Quick add', { width: 'fit', grow: true })).toBe('Quick add now fills the rest of the row.');
    expect(sizingChange('Quick add', { width: 'full', grow: false })).toBe('Quick add now takes the whole row.');
    expect(sizingChange('Quick add', { width: 'quarter', grow: true })).toBe('Quick add now takes at least a quarter of the row and fills the rest.');
  });

  it('words a pair change', () => {
    expect(pairChange('Table of records', 'two-thirds', 'Number tile', 'third')).toBe(
      'Table of records now takes two thirds of the row and Number tile a third of the row.',
    );
    expect(pairChange('A', 'quarter', 'B', 'three-quarters')).toBe('A now takes a quarter of the row and B three quarters of the row.');
  });

  it('adds a suffix to a summary sentence', () => {
    expect(summarySuffix({ width: 'full', grow: false })).toBe('');
    expect(summarySuffix({ width: 'full', grow: true })).toBe('');
    expect(summarySuffix({ width: 'half', grow: false })).toBe(' (half the row)');
    expect(summarySuffix({ width: 'fit', grow: false })).toBe(' (only the space it needs)');
    expect(summarySuffix({ width: 'fit', grow: true })).toBe(' (fills the rest of the row)');
    expect(summarySuffix({ width: 'third', grow: true })).toBe(' (fills the rest of the row)');
  });
});
