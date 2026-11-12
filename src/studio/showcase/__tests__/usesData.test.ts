import { describe, expect, it } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import type { FeatureLibrary } from '@/catalog/features';
import { node, recordOf } from '../../components/__tests__/featureFixtures';
import { buildShowcaseEntries, partEntries } from '../entries';
import { entryShowsData } from '../usesData';

const library: FeatureLibrary = new Map(SEED_FEATURES.map((d) => [d.id, d]));

describe('entryShowsData', () => {
  const parts = partEntries();
  const by = (id: string) => {
    const e = parts.find((x) => x.id === id);
    if (e === undefined) throw new Error(id);
    return e;
  };

  it('is true for parts that read or write a table', () => {
    for (const id of ['DataTable', 'RecordList', 'RecordDetail', 'StatCard', 'Chart', 'Timeline', 'Checklist', 'ProgressBar', 'FilterBar', 'SearchBox', 'SortControl', 'ReferencePicker', 'QuickAdd', 'RecordForm']) {
      expect(entryShowsData(by(id), library), id).toBe(true);
    }
  });

  it('is false for layout, text, navigation and action parts', () => {
    for (const id of ['Section', 'Card', 'Columns', 'Heading', 'Text', 'Button', 'Link', 'NavLinks', 'Breadcrumb', 'BackLink', 'PageHeader', 'Divider']) {
      expect(entryShowsData(by(id), library), id).toBe(false);
    }
  });

  it('is true for a feature whose fragment holds a data part anywhere, from the seeds', () => {
    const entries = buildShowcaseEntries(SEED_FEATURES.map((d) => recordOf(d)));
    for (const e of entries.filter((x) => x.kind === 'feature')) expect(entryShowsData(e, library), e.id).toBe(true);
  });

  it('is false for a feature with only static parts, and for an unknown feature', () => {
    const plain = { ...SEED_FEATURES[0], id: 'plain_one', fragment: node('f1', 'Section', [node('f2', 'Heading', 'Hi' as never)]), params: [], bindings: [] };
    const entries = buildShowcaseEntries([recordOf(plain)]);
    const entry = entries.find((e) => e.id === 'plain_one');
    if (entry === undefined) throw new Error('entry');
    expect(entryShowsData(entry, new Map([['plain_one', plain]]))).toBe(false);
    expect(entryShowsData(entry, new Map())).toBe(false);
  });

  it('finds a data part nested deep in a fragment', () => {
    const deep = { ...SEED_FEATURES[0], id: 'deep_one', fragment: node('a', 'Section', [node('b', 'Card', [node('c', 'Row', [node('d', 'DataTable', [], { source: 'x' })])])]), params: [], bindings: [] };
    const entry = buildShowcaseEntries([recordOf(deep)]).find((e) => e.id === 'deep_one');
    if (entry === undefined) throw new Error('entry');
    expect(entryShowsData(entry, new Map([['deep_one', deep]]))).toBe(true);
  });
});
