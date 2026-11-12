import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import { baseSpec } from '../../__tests__/fixtures';
import { featuresLine, lookLine, pageLine, pagePhrases, summarizeSpec, tableLine } from '../specSummary';

const clone = (): AppSpec => structuredClone(baseSpec());
const layer = (type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({ id: `${type}_x`, type, props, children });
const withLayout = (children: LayoutLayer[], sources: AppSpec['pages'][number]['sources'] = []): AppSpec => {
  const spec = clone();
  spec.pages[0].sources = sources;
  spec.pages[0].layout = layer('Page', {}, children);
  return spec;
};
const src = (id: string, table = 'crews'): AppSpec['pages'][number]['sources'][number] => ({ id, table, mode: 'list', where: [], orderBy: [], limit: 50 });

describe('the look of a summary', () => {
  it('names the theme, and says nothing for the standard look or junk', () => {
    expect(summarizeSpec(baseSpec()).theme).toBeNull();
    const spec = clone();
    spec.theme = { preset: 'forest', radius: 'md', id: 'forest' };
    expect(summarizeSpec(spec).theme).toBe('Forest');
    spec.theme = { preset: 'forest', radius: 'md', id: 'nope' } as unknown as AppSpec['theme'];
    expect(summarizeSpec(spec).theme).toBeNull();
  });

  it('lookLine only speaks when the look changed', () => {
    expect(lookLine('Forest', null)).toBe('Look: Forest.');
    expect(lookLine('Forest', 'Sand')).toBe('Look: Forest.');
    expect(lookLine('Forest', 'Forest')).toBeNull();
    expect(lookLine(null, 'Forest')).toBeNull();
    expect(lookLine(null, null)).toBeNull();
  });
});

describe('summarizeSpec', () => {
  it('summarizes the crew roster fixture', () => {
    const spec = crewRoster as unknown as AppSpec;
    const s = summarizeSpec(spec);
    expect(s.headline).toBe('2 tables and 1 page.');
    expect(s.tables.map(tableLine)).toEqual(['People: 1 field (Name)', 'Crews: 4 fields (Name, Size, Lead, Status)']);
    expect(s.pages.map(pageLine)).toEqual(['Home: a list of Crews']);
    expect(s.pages[0].inMenu).toBe(true);
  });

  it('says no tables yet and uses singular words', () => {
    const spec = clone();
    spec.tables = [];
    expect(summarizeSpec(spec).headline).toBe('No tables yet and 1 page.');
    expect(summarizeSpec(baseSpec()).headline).toBe('1 table and 1 page.');
  });

  it('caps fields at 6 and counts the rest', () => {
    const spec = clone();
    spec.tables[0].fields = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, type: 'text' as const, required: false }));
    const [t] = summarizeSpec(spec).tables;
    expect(t.fieldCount).toBe(9);
    expect(t.fieldLabels).toHaveLength(6);
    expect(t.moreFields).toBe(3);
    expect(tableLine(t)).toBe('Crews: 9 fields (F0, F1, F2, F3, F4, F5 and 3 more)');
  });

  it('words each part type and resolves tables through sources or props', () => {
    const spec = withLayout(
      [
        layer('DataTable', { source: 'all' }),
        layer('RecordForm', { table: 'crews' }),
        layer('StatCard', { label: 'Open crews', source: 'all' }),
        layer('StatCard', { source: 'all' }),
        layer('RecordDetail', { source: 'all' }),
        layer('FilterBar', { source: 'all' }),
        layer('SearchBox', { source: 'all' }),
        layer('RecordList', { source: 'nope' }),
      ],
      [src('all')],
    );
    const [p] = summarizeSpec(spec).pages;
    expect(p.parts).toEqual([
      'a list of Crews',
      'a form for Crews',
      'a number: Open crews',
      'a number about Crews',
      'the details of one Crews record',
      'filters for Crews',
    ]);
    expect(p.moreParts).toBe(2);
    expect(pageLine(p)).toBe(
      'Home: a list of Crews, a form for Crews, a number: Open crews, a number about Crews, the details of one Crews record, filters for Crews and 2 more',
    );
  });

  it('falls back to your data, dedupes and skips other parts', () => {
    const spec = withLayout([layer('Heading'), layer('Text'), layer('Button'), layer('Mystery'), layer('DataTable'), layer('DataTable'), layer('RecordList', { source: 'gone' })]);
    const [p] = summarizeSpec(spec).pages;
    expect(p.parts).toEqual(['a list of your data']);
    expect(pageLine(p)).toBe('Home: a list of your data');
    expect(pageLine({ ...p, parts: [] })).toBe('Home: words only, nothing that shows or adds records');
  });

  it('reads nested layouts in document order, 80 levels deep', () => {
    let inner: LayoutLayer = layer('SearchBox', { table: 'crews' });
    for (let i = 0; i < 80; i += 1) inner = layer('Stack', {}, [inner]);
    const spec = withLayout([layer('DataTable', { table: 'crews' }), inner, layer('RecordForm', { table: 'crews' })]);
    expect(summarizeSpec(spec).pages[0].parts).toEqual(['a list of Crews', 'a search box for Crews', 'a form for Crews']);
  });

  it('marks pages outside the menu', () => {
    const spec = clone();
    spec.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: layer('Page') });
    expect(summarizeSpec(spec).pages.map((p) => p.inMenu)).toEqual([true, false]);
  });

  it('marks pages that open from a list', () => {
    const spec = clone();
    spec.pages.push({ id: 'crew', title: 'Crew', route: '/crews/:id', sources: [], layout: layer('Page') });
    spec.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: layer('Page') });
    expect(summarizeSpec(spec).pages.map((p) => p.opensFromList)).toEqual([false, true, false]);
  });

  it('only prints numbers that are counts computed from the spec', () => {
    const spec = withLayout([layer('DataTable', { table: 'crews' })]);
    const s = summarizeSpec(spec);
    const text = [s.headline, ...s.tables.map(tableLine), ...s.pages.map(pageLine)].join(' ');
    const numbers = (text.match(/\d+/g) ?? []).map(Number);
    expect(numbers).toEqual([spec.tables.length, spec.pages.length, spec.tables[0].fields.length]);
  });
});

describe('features in the summary', () => {
  const block = (id: string, name: string | undefined, children: LayoutLayer[]): LayoutLayer => ({
    id: `${id}_root`,
    type: 'Section',
    ...(name === undefined ? {} : { name }),
    props: {},
    children,
    feature: { id, version: 1, params: {} },
  });

  it('names a feature block by its layer name and skips its inner parts', () => {
    const spec = withLayout([block('kpi_row', 'Number row', [layer('DataTable', { table: 'crews' })]), layer('DataTable', { table: 'crews' })]);
    const s = summarizeSpec(spec);
    expect(s.pages[0].parts).toEqual(['the feature Number row', 'a list of Crews']);
    expect(s.features).toEqual(['Number row']);
  });

  it('falls back to the marker id, lists each name once in document order and joins in words', () => {
    const spec = withLayout([block('b_id', undefined, []), block('a_id', 'Alpha', []), block('b_id', undefined, [])]);
    const s = summarizeSpec(spec);
    expect(s.features).toEqual(['b_id', 'Alpha']);
    expect(featuresLine(['A', 'B', 'C'])).toBe('Uses your features: A, B and C.');
    expect(featuresLine(['Number row'])).toBe('Uses your features: Number row.');
    expect(featuresLine([])).toBeNull();
  });

  it('has no features for a plain spec', () => {
    expect(summarizeSpec(clone()).features).toEqual([]);
  });
});

describe('pagePhrases', () => {
  it('lists distinct parts in document order with their table, label and kind', () => {
    const spec = withLayout(
      [
        layer('DataTable', { source: 'a' }),
        layer('DataTable', { source: 'a' }),
        layer('RecordForm', { table: 'crews' }),
        layer('StatCard', { label: 'Total' }),
        layer('StatCard', { table: 'crews' }),
        layer('Chart', { table: 'crews' }),
        layer('Heading'),
      ],
      [src('a')],
    );
    expect(pagePhrases(spec, spec.pages[0]).map((p) => [p.kind, p.table, p.label])).toEqual([
      ['list', 'Crews', null],
      ['form', 'Crews', null],
      ['number', null, 'Total'],
      ['number', 'Crews', null],
      ['data', 'Crews', null],
    ]);
  });

  it('names a feature block and skips its subtree', () => {
    const block: LayoutLayer = { ...layer('Section', {}, [layer('DataTable', { table: 'crews' })]), name: 'Number row', feature: { id: 'kpi_row', version: 1, params: {} } };
    const spec = withLayout([block]);
    const phrases = pagePhrases(spec, spec.pages[0]);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]).toMatchObject({ kind: 'feature', label: 'Number row' });
  });
});
