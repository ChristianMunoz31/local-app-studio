// What a menu SearchBox searches: the first list source of the open page, and the fields it gets. Synthetic data.
import { describe, expect, it } from 'vitest';
import { titleFieldOf as runtimeTitleFieldOf } from '@local-app-studio/runtime/runtime/normalizeSpec.js';
import { menuSearchTarget, resolveMenuLayers } from '@local-app-studio/runtime/catalog/parts/menuSearch.ts';
import { layer } from './fixtures.ts';

const table = (fields: Array<[string, string]>, titleField?: string) => ({
  id: 't',
  label: 'T',
  ...(titleField === undefined ? {} : { titleField }),
  fields: fields.map(([id, type]) => ({ id, label: id, type })),
});
const specWith = (tables: unknown[], sources: unknown[]) => ({ tables, pages: [{ id: 'home', route: '/', sources }] });
const list = { id: 'all', table: 't' };

describe('menuSearchTarget', () => {
  it('the first list source, absent mode counts as list, title field first, at most 4 text fields in table order', () => {
    const spec = specWith(
      [table([['a', 'text'], ['n', 'integer'], ['b', 'longtext'], ['c', 'text'], ['d', 'text'], ['e', 'text']], 'c')],
      [{ id: 'one', table: 't', mode: 'record' }, list, { id: 'two', table: 't', mode: 'list' }],
    );
    expect(menuSearchTarget(spec, 'home')).toEqual({ source: 'all', fields: ['c', 'a', 'b', 'd'] });
  });

  it('a titleField that is not searchable, or absent, falls back to table order', () => {
    expect(menuSearchTarget(specWith([table([['s', 'select'], ['a', 'text'], ['b', 'text']], 's')], [list]), 'home')).toEqual({ source: 'all', fields: ['a', 'b'] });
    expect(menuSearchTarget(specWith([table([['a', 'text'], ['b', 'text']])], [list]), 'home')?.fields).toEqual(['a', 'b']);
  });

  it('null with no list source, no searchable field, no page, no table or junk', () => {
    expect(menuSearchTarget(specWith([table([['a', 'text']])], []), 'home')).toBeNull();
    expect(menuSearchTarget(specWith([table([['a', 'text']])], [{ id: 'r', table: 't', mode: 'record' }]), 'home')).toBeNull();
    expect(menuSearchTarget(specWith([table([['n', 'integer']])], [list]), 'home')).toBeNull();
    expect(menuSearchTarget(specWith([table([['a', 'text']])], [list]), 'other')).toBeNull();
    expect(menuSearchTarget(specWith([], [list]), 'home')).toBeNull();
    expect(menuSearchTarget(specWith([table([['a', 'text']])], [list]), undefined)).toBeNull();
    for (const junk of [null, undefined, 3, 'x', [], { pages: 'x' }, { pages: [null], tables: null }]) expect(menuSearchTarget(junk, 'home')).toBeNull();
  });

  it('the title rule is the runtime titleFieldOf', () => {
    const t = table([['a', 'text'], ['b', 'text']], 'b');
    expect(menuSearchTarget(specWith([t], [list]), 'home')?.fields[0]).toBe(runtimeTitleFieldOf(t));
  });
});

describe('resolveMenuLayers', () => {
  const target = { source: 'all', fields: ['a'] };
  const search = layer('s', 'SearchBox', { placeholder: 'Find' });

  it('gives a SearchBox, also inside a Row, its source and fields and keeps its placeholder', () => {
    const out = resolveMenuLayers([search, layer('r', 'Row', {}, [layer('s2', 'SearchBox')])], target);
    expect(out[0].props).toEqual({ placeholder: 'Find', source: 'all', fields: ['a'] });
    const row = out[1].children;
    expect(Array.isArray(row) && row[0].props).toEqual({ source: 'all', fields: ['a'] });
  });

  it('leaves a SearchBox out when there is no target, a Row keeps its other children', () => {
    const btn = layer('b', 'Button');
    const out = resolveMenuLayers([search, layer('r', 'Row', {}, [layer('s2', 'SearchBox'), btn]), btn], null);
    expect(out.map((l) => l.id)).toEqual(['r', 'b']);
    expect(out[0].children).toEqual([btn]);
  });

  it('drops entries that are not objects and never mutates its input', () => {
    const input = [null, 'x', 4, search];
    const copy = JSON.stringify(input);
    expect(resolveMenuLayers(input, target)).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(copy);
    expect(search.props).toEqual({ placeholder: 'Find' });
  });
});
