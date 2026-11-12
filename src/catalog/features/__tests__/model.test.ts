import { describe, expect, it } from 'vitest';
import { crewCtx, homeCtx, layer } from '../../__tests__/fixtures.ts';
import { SPIKE_PART_CONTEXT } from '../../types.ts';
import { modelFeaturesFor } from '../model.ts';
import type { FeatureDefinition } from '../types.ts';
import { defOf, headingBody, libOf, seedLib } from './helpers.ts';

const numbered = (n: number): FeatureDefinition[] =>
  Array.from({ length: n }, (_, i) => defOf(`f${String(i).padStart(2, '0')}`, headingBody(), { updatedAt: `2026-01-0${(i % 9) + 1}T00:00:00.000Z` }));

describe('modelFeaturesFor', () => {
  it('lists the seeds with plain parameter words', () => {
    const r = modelFeaturesFor(seedLib(), crewCtx());
    expect(r.map((f) => f.id).sort()).toEqual(['kpi_row', 'search_list']);
    expect(r.find((f) => f.id === 'kpi_row')?.params).toEqual([
      { name: 'source', words: 'list source id' },
      { name: 'amount', words: 'field id of source' },
      { name: 'title', words: 'text' },
    ]);
  });

  it('caps at 6, newest first, then by id', () => {
    const r = modelFeaturesFor(libOf(...numbered(9)), crewCtx());
    expect(r).toHaveLength(6);
    const dates = r.map((f) => f.id);
    expect(dates).toEqual(['f08', 'f07', 'f06', 'f05', 'f04', 'f03']);
    const same = libOf(defOf('bb', headingBody()), defOf('aa', headingBody()));
    expect(modelFeaturesFor(same, crewCtx()).map((f) => f.id)).toEqual(['aa', 'bb']);
  });

  it('keeps only features whose params can be filled on this page', () => {
    expect(modelFeaturesFor(seedLib(), SPIKE_PART_CONTEXT)).toEqual([]);
    const noNumbers = { ...homeCtx(), fields: { crews: [{ id: 'name', type: 'text' as const }], people: [] } };
    expect(modelFeaturesFor(seedLib(), noNumbers).map((f) => f.id)).toEqual(['search_list']);
    const recordOnly = defOf('rec', {
      params: [{ name: 'one', label: 'One', type: 'source', mode: 'record' }],
      fragment: layer('r', 'RecordDetail', { source: 's' }),
      bindings: [{ param: 'one', layer: 'r', target: 'props.source' }],
    });
    expect(modelFeaturesFor(libOf(recordOnly), homeCtx())).toEqual([]);
    expect(modelFeaturesFor(libOf(recordOnly), crewCtx())).toHaveLength(1);
    expect(modelFeaturesFor(libOf(defOf('say', headingBody())), SPIKE_PART_CONTEXT)).toHaveLength(1);
  });

  it('cuts descriptions at 100 characters on a word, with ...', () => {
    const long = 'word '.repeat(40).trim();
    const [f] = modelFeaturesFor(libOf(defOf('longone', headingBody(), { description: long })), crewCtx());
    expect(f.description.endsWith('...')).toBe(true);
    expect(f.description.length).toBeLessThanOrEqual(103);
    expect(f.description.slice(0, -3)).toBe('word '.repeat(20).trim());
    const exact = 'x'.repeat(100);
    expect(modelFeaturesFor(libOf(defOf('exact', headingBody(), { description: exact })), crewCtx())[0].description).toBe(exact);
    const noSpace = 'x'.repeat(150);
    expect(modelFeaturesFor(libOf(defOf('nospace', headingBody(), { description: noSpace })), crewCtx())[0].description).toBe(`${'x'.repeat(100)}...`);
  });
});
