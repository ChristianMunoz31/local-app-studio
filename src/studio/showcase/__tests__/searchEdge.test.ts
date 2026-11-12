// Edge cases of the showcase search that search.test.ts does not pin: plain-language queries owners type, a query with no
// letters, and highlight ranges that stay inside the name.
import { describe, expect, it } from 'vitest';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { buildShowcaseEntries } from '../entries';
import { searchEntries } from '../search';

const entries = buildShowcaseEntries(seedRecords());
const hits = (query: string) => searchEntries(entries, { query, category: 'all', sort: 'default' });
const names = (query: string): string[] => hits(query).map((h) => h.entry.name);

describe('plain-language queries', () => {
  it('"spreadsheet" ranks Table of records first', () => {
    expect(names('spreadsheet')[0]).toBe('Table of records');
  });

  it('"side by side" finds Columns', () => {
    expect(names('side by side')).toContain('Columns');
  });

  it('"divs" finds Columns', () => {
    expect(names('divs')).toContain('Columns');
  });

  it('"nav" finds Page links', () => {
    expect(names('nav')).toContain('Page links');
  });

  it('ignores case and surrounding spaces', () => {
    expect(names('  SPREADSHEET  ')[0]).toBe('Table of records');
  });
});

describe('queries with no letters or digits', () => {
  const all = entries.map((e) => e.name);
  it.each(['!!!', '---', '?', '/ \\ . , ;', '"', '()[]{}', '%_', '\u2014\u2013'])('"%s" returns every entry in catalog order with no highlight', (q) => {
    expect(names(q)).toEqual(all);
    expect(hits(q).every((h) => h.nameRanges.length === 0 && h.score === 0)).toBe(true);
  });

  it('punctuation around a word does not stop it matching', () => {
    expect(names('(spreadsheet)')[0]).toBe('Table of records');
    expect(names('side-by-side')).toContain('Columns');
  });
});

describe('highlight ranges', () => {
  const queries = ['a', 'e', 'table', 'tab table', 'rec records', 'list of', 'page', 'back link', 'zzz', 'side', 'x y z', 'show and hide section show', 'auto grid', 'columns columns col'];

  it.each(queries)('stay inside the name, ordered and not touching, for "%s"', (q) => {
    for (const h of hits(q)) {
      let prevEnd = -1;
      for (const [start, end] of h.nameRanges) {
        expect(start, h.entry.name).toBeGreaterThanOrEqual(0);
        expect(end, h.entry.name).toBeGreaterThan(start);
        expect(end, h.entry.name).toBeLessThanOrEqual(h.entry.name.length);
        expect(start, h.entry.name).toBeGreaterThan(prevEnd);
        prevEnd = end;
      }
    }
  });

  it('stay inside the name for a word taken from every entry', () => {
    for (const e of entries) {
      for (const word of e.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
        for (const h of hits(word)) for (const [, end] of h.nameRanges) expect(end).toBeLessThanOrEqual(h.entry.name.length);
      }
    }
  });
});
