import { describe, expect, it } from 'vitest';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { buildShowcaseEntries } from '../entries';
import { categoryChoices, categoryCounts, groupHits, parseCategory, parseSort, queryWords, resolveRecent, searchEntries } from '../search';

const entries = buildShowcaseEntries(seedRecords());
const names = (q: string, extra: { category?: 'all' | 'data'; sort?: 'default' | 'az' | 'new' } = {}): string[] =>
  searchEntries(entries, { query: q, category: extra.category ?? 'all', sort: extra.sort ?? 'default' }).map((h) => h.entry.name);

describe('queryWords', () => {
  it('lowercases, splits on non letters and keeps at most 8', () => {
    expect(queryWords('  Table-of, RECORDS! ')).toEqual(['table', 'of', 'records']);
    expect(queryWords('a b c d e f g h i j')).toHaveLength(8);
    expect(queryWords('!!')).toEqual([]);
  });
});

describe('searchEntries', () => {
  it('returns everything in catalog order for an empty query', () => {
    expect(names('')).toHaveLength(entries.length);
    expect(names('  ')[0]).toBe('Section');
  });

  it('finds a part by a keyword and highlights nothing when the name does not match', () => {
    const hits = searchEntries(entries, { query: 'spreadsheet', category: 'all', sort: 'default' });
    expect(hits[0].entry.name).toBe('Table of records');
    expect(hits[0].nameRanges).toEqual([]);
  });

  it('matches the start of the name or of a word in it, not the middle', () => {
    expect(names('rec')).toContain('Table of records');
    expect(names('ecords')).not.toContain('Table of records');
    const hit = searchEntries(entries, { query: 'rec', category: 'all', sort: 'default' }).find((h) => h.entry.name === 'Table of records');
    expect(hit?.nameRanges).toEqual([[9, 12]]);
  });

  it('needs every word (AND), in any field', () => {
    expect(names('table records')).toContain('Table of records');
    expect(names('table zzz')).toEqual([]);
    expect(names('side sidebar')).toContain('Columns');
  });

  it('searches names, keywords, category and sub-group labels and descriptions', () => {
    expect(names('toolbar')).toContain('Row');
    expect(names('navigation')).toContain('Breadcrumb');
    expect(names('charts')).toContain('Chart');
    expect(names('paging')).toContain('Table of records');
  });

  it('ranks a name prefix above a keyword match above a description match', () => {
    const list = names('list');
    expect(list.indexOf('List of records')).toBeLessThan(list.indexOf('Table of records'));
  });

  it('finds a custom feature by the words of its settings', () => {
    const custom = entries.find((e) => e.kind === 'feature');
    const label = custom?.params[0]?.label;
    expect(label).toBeDefined();
    expect(names(String(label))).toContain(custom?.name);
  });

  it('merges overlapping ranges', () => {
    const hit = searchEntries(entries, { query: 'tab table', category: 'all', sort: 'default' }).find((h) => h.entry.name === 'Table of records');
    expect(hit?.nameRanges).toEqual([[0, 5]]);
  });

  it('limits to a category', () => {
    expect(names('', { category: 'data' }).every((n) => entries.find((e) => e.name === n)?.category === 'data')).toBe(true);
  });

  it('sorts A to Z, and puts the newest custom features first for Recently added', () => {
    const az = names('', { category: 'data', sort: 'az' });
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
    const newer = buildShowcaseEntries([
      { ...seedRecords()[0], id: 'old_one', label: 'Old one', createdAt: '2026-01-01T00:00:00.000Z' },
      { ...seedRecords()[0], id: 'new_one', label: 'New one', createdAt: '2026-06-01T00:00:00.000Z' },
    ]);
    const list = searchEntries(newer, { query: '', category: 'custom', sort: 'new' }).map((h) => h.entry.name);
    expect(list).toEqual(['New one', 'Old one']);
    const all = searchEntries(newer, { query: '', category: 'all', sort: 'new' }).map((h) => h.entry.name);
    expect(all.slice(0, 3)).toEqual(['Section', 'Card', 'Columns']);
  });
});

describe('groups and counts', () => {
  it('groups by category with sub-groups and counts', () => {
    const groups = groupHits(searchEntries(entries, { query: '', category: 'all', sort: 'default' }));
    expect(groups.map((g) => g.category)).toEqual(['layout', 'navigation', 'data', 'input', 'action', 'custom']);
    const data = groups.find((g) => g.category === 'data');
    expect(data?.subgroups.map((s) => s.label)).toEqual(['Show', 'Summarize', 'Charts']);
    expect(data?.count).toBe(data?.subgroups.reduce((n, s) => n + s.count, 0));
    expect(groups.find((g) => g.category === 'navigation')?.subgroups).toHaveLength(1);
    expect(groups.find((g) => g.category === 'navigation')?.subgroups[0].label).toBeNull();
  });

  it('counts matches per category, ignoring the category choice', () => {
    const all = categoryCounts(entries, '');
    expect(all.all).toBe(entries.length);
    expect(all.data + all.layout + all.navigation + all.input + all.action + all.custom).toBe(all.all);
    expect(categoryCounts(entries, 'spreadsheet')).toMatchObject({ all: 1, data: 1, layout: 0 });
    expect(categoryChoices(all)[0].label).toBe(`All (${all.all})`);
    expect(categoryChoices(all).map((c) => c.value)).toEqual(['all', 'layout', 'navigation', 'data', 'input', 'action', 'custom']);
  });
});

describe('helpers', () => {
  it('resolves recent keys and skips unknown ones', () => {
    expect(resolveRecent(['part:Text', 'feature:gone', 'part:Card'], entries).map((e) => e.name)).toEqual(['Text', 'Card']);
  });

  it('falls back to the defaults for bad address values', () => {
    expect(parseSort('az')).toBe('az');
    expect(parseSort('zzz')).toBe('default');
    expect(parseSort(null)).toBe('default');
    expect(parseCategory('data')).toBe('data');
    expect(parseCategory('__proto__')).toBe('all');
  });
});
