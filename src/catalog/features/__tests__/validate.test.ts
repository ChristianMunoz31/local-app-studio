import { describe, expect, it } from 'vitest';
import { layer } from '../../__tests__/fixtures.ts';
import { SEED_FEATURES } from '../seeds.ts';
import type { FeatureBody } from '../types.ts';
import { findCycle, isReservedFeatureId, validateFeatureInput } from '../validate.ts';
import { defOf, headingBody, libOf, seedLib, wrapperBody } from './helpers.ts';

type Rec = Record<string, unknown>;
const record = (body: FeatureBody, extra: Rec = {}): Rec => ({
  id: 'my_feature',
  label: 'My feature',
  description: 'Shows a heading.',
  ...body,
  ...extra,
});
const codes = (input: unknown, lib = libOf()): string[] => {
  const r = validateFeatureInput(input, lib);
  return r.ok ? [] : [...new Set(r.issues.map((i) => i.code))];
};
const seed = (id: string): Rec => {
  const d = SEED_FEATURES.find((s) => s.id === id);
  if (!d) throw new Error(id);
  return { id: d.id, label: d.label, description: d.description, params: d.params, fragment: d.fragment, bindings: d.bindings };
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('seed features', () => {
  it.each(SEED_FEATURES.map((s) => s.id))('%s passes validateFeatureInput', (id) => {
    const r = validateFeatureInput(seed(id), libOf());
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it('still passes when replacing itself in a library that holds it', () => {
    expect(validateFeatureInput(seed('kpi_row'), seedLib(), { replacingId: 'kpi_row' }).ok).toBe(true);
  });
});

describe('validateFeatureInput', () => {
  it('accepts a minimal text feature', () => {
    expect(validateFeatureInput(record(headingBody()), libOf()).ok).toBe(true);
  });

  it('rejects non-JSON, non-objects and unknown keys with invalid_feature', () => {
    const cyc: Rec = {};
    cyc.self = cyc;
    expect(codes(cyc)).toEqual(['invalid_feature']);
    expect(codes(null)).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { extra: 1 }))).toEqual(['invalid_feature']);
  });

  it('applies the id regex and reserved words (same as table ids)', () => {
    expect(codes(record(headingBody(), { id: 'Bad Id' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { id: 'a'.repeat(32) }))).toEqual(['invalid_feature']);
    for (const id of ['select', 'items', 'studio_x', 'con', 'apps']) {
      expect(codes(record(headingBody(), { id })), id).toEqual(['reserved_word']);
      expect(isReservedFeatureId(id)).toBe(true);
    }
    expect(isReservedFeatureId('kpi_row')).toBe(false);
  });

  it('applies label and description rules', () => {
    expect(codes(record(headingBody(), { label: '' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { label: 'x'.repeat(41) }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { label: ' padded' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { description: 'two\nlines' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { description: 'x'.repeat(161) }))).toEqual(['invalid_feature']);
  });

  it('rejects C0 control characters in the label and the description', () => {
    expect(codes(record(headingBody(), { label: 'bell' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { label: 'tab	here' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { description: 'esc[0m' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody(), { description: 'del' }))).toEqual(['invalid_feature']);
    expect(codes(record(headingBody()))).toEqual([]);
  });

  it('checks params: count, names, duplicates, mode, of, fieldTypes', () => {
    const p = (extra: Rec): Rec => ({ name: 'title', label: 'Title', type: 'text', ...extra });
    const with_ = (params: unknown[]): Rec => record(headingBody(), { params });
    expect(codes(with_(Array.from({ length: 7 }, (_, i) => p({ name: `p${i}` }))))).toContain('invalid_feature');
    expect(codes(with_([p({ name: 'Bad' })]))).toEqual(['invalid_feature']);
    expect(codes(with_([p({ name: 'x'.repeat(25) })]))).toEqual(['invalid_feature']);
    expect(codes(with_([p({ name: 'id' })]))).toEqual(['reserved_word']);
    expect(codes(with_([p({}), p({})]))).toContain('duplicate_param');
    expect(codes(with_([p({ type: 'source' })]))).toContain('invalid_param'); // source without mode
    expect(codes(with_([p({ mode: 'list' })]))).toContain('invalid_param'); // mode on text
    expect(codes(with_([p({ type: 'field' })]))).toContain('invalid_param'); // field without of
    expect(codes(with_([p({ type: 'field', of: 'title' })]))).toContain('invalid_param'); // of itself
    expect(codes(with_([p({ type: 'sauce' })]))).toContain('invalid_param');
    expect(codes(with_([p({ fieldTypes: ['text'] })]))).toContain('invalid_param');
  });

  it('checks fieldTypes values', () => {
    const base = seed('kpi_row') as { params: Rec[] };
    for (const fieldTypes of [[], ['integer', 'integer'], ['bogus']]) {
      const input = clone(seed('kpi_row')) as { params: Rec[] };
      input.params[1].fieldTypes = fieldTypes;
      expect(codes(input), JSON.stringify(fieldTypes)).toContain('invalid_param');
    }
    expect(base.params.length).toBe(3);
  });

  it('refuses a fragment that is oversized, deep, duplicated, or has a bad root', () => {
    const wide = layer('r', 'Section', {}, Array.from({ length: 61 }, (_, i) => layer(`d${i}`, 'Divider')));
    expect(codes(record({ ...headingBody(), fragment: wide, bindings: [], params: [] }))).toContain('fragment_too_large');
    let deep = layer('l8', 'Divider');
    for (let i = 7; i >= 0; i -= 1) deep = layer(`l${i}`, 'Section', {}, [deep]);
    expect(codes(record({ params: [], bindings: [], fragment: deep }))).toContain('fragment_too_large');
    const dup = layer('r', 'Section', {}, [layer('r', 'Divider')]);
    expect(codes(record({ params: [], bindings: [], fragment: dup }))).toEqual(['invalid_fragment']);
    const huge = layer('r', 'Text', {}, 'x'.repeat(2000));
    const many = layer('r', 'Section', {}, Array.from({ length: 10 }, (_, i) => ({ ...huge, id: `t${i}` })));
    expect(codes(record({ params: [], bindings: [], fragment: many }))).toContain('fragment_too_large');
    for (const type of ['Page', 'Tab', 'Feature', 'Nope']) {
      expect(codes(record({ params: [], bindings: [], fragment: layer('r', type) })), type).toContain('invalid_fragment');
    }
    expect(codes(record({ params: [], bindings: [], fragment: 'nope' as unknown as FeatureBody['fragment'] }))).toEqual(['invalid_fragment']);
  });

  it('refuses a marker inside the fragment', () => {
    const marked = { ...layer('r', 'Divider'), feature: { id: 'x', version: 1, params: {} } };
    expect(codes(record({ params: [], bindings: [], fragment: marked }))).toEqual(['invalid_fragment']);
  });

  it('refuses className, style and handlers in the fragment (the sample check)', () => {
    for (const key of ['className', 'style', 'onClick']) {
      const frag = layer('r', 'Section', { [key]: 'x' });
      expect(codes(record({ params: [], bindings: [], fragment: frag })), key).toEqual(['invalid_fragment']);
    }
  });

  it('checks bindings: count, unknown param or layer, non-slot target, kind and mode mismatch, duplicates', () => {
    const run = (mutate: (i: { bindings: Rec[]; params: Rec[] }) => void): string[] => {
      const input = clone(seed('kpi_row')) as { bindings: Rec[]; params: Rec[] };
      mutate(input);
      return codes(input);
    };
    expect(run((i) => { i.bindings[0].param = 'nope'; })).toContain('invalid_binding');
    expect(run((i) => { i.bindings[0].layer = 'nope'; })).toContain('invalid_binding');
    expect(run((i) => { i.bindings[0].target = 'props.variant'; })).toContain('invalid_binding');
    expect(run((i) => { i.bindings[0].target = 'props.className'; })).toContain('invalid_binding');
    expect(run((i) => { i.bindings[0].target = 'props.__proto__'; })).toContain('invalid_binding');
    expect(run((i) => { i.bindings[1].param = 'title'; })).toContain('invalid_binding'); // text param into a source slot
    expect(run((i) => { i.params[0].mode = 'record'; })).toContain('invalid_binding'); // record source into a list slot
    expect(run((i) => { i.bindings.push({ ...i.bindings[1] }); })).toContain('invalid_binding'); // bound twice
    expect(run((i) => { i.bindings = [...i.bindings, ...i.bindings, ...i.bindings, ...i.bindings, ...i.bindings]; })).toContain('invalid_binding');
    expect(run((i) => { (i.bindings[0] as Rec).extra = 1; })).toContain('invalid_binding');
  });

  it('refuses a field param whose fieldTypes do not fit the slot, and a field param bound next to the wrong source', () => {
    const wrongTypes = clone(seed('kpi_row')) as { params: Rec[] };
    wrongTypes.params[1].fieldTypes = ['integer', 'text'];
    expect(codes(wrongTypes)).toContain('invalid_binding');
    const none = clone(seed('kpi_row')) as { params: Rec[] };
    delete none.params[1].fieldTypes;
    expect(codes(none)).toContain('invalid_binding');
    const other = clone(seed('kpi_row')) as { params: Rec[]; bindings: Rec[] };
    other.params.push({ name: 'other', label: 'Other', type: 'source', mode: 'list' });
    other.bindings[2].param = 'other'; // f3's source is another param than the "of" of f3's field
    expect(codes(other)).toContain('invalid_binding');
  });

  it('refuses an unused param', () => {
    const input = clone(seed('kpi_row')) as { params: Rec[] };
    input.params.push({ name: 'spare', label: 'Spare', type: 'text' });
    expect(codes(input)).toEqual(['invalid_param']);
  });

  it('refuses a source slot with no binding (unbound_slot), also for tables and pages', () => {
    const input = clone(seed('kpi_row')) as { bindings: Rec[] };
    input.bindings = input.bindings.filter((b) => !(b.layer === 'f4' && b.target === 'props.source'));
    expect(codes(input)).toContain('unbound_slot');
    const table = record({
      params: [],
      bindings: [],
      fragment: layer('r', 'RecordForm', { table: 'crews' }),
    });
    expect(codes(table)).toContain('unbound_slot');
    const page = record({
      params: [],
      bindings: [],
      fragment: layer('r', 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go'),
    });
    expect(codes(page)).toContain('unbound_slot');
  });

  it('refuses kept field ids in a fields list unless each entry is bound (dropped lists are fine)', () => {
    const kept = clone(seed('search_list')) as { bindings: Rec[] };
    kept.bindings = kept.bindings.filter((b) => b.target !== 'props.fields.0');
    expect(codes(kept)).toContain('unbound_slot');
    const dropped = clone(seed('search_list')) as { fragment: { children: { props: Rec }[] } };
    dropped.fragment.children[1].props = { source: 's' };
    expect(Array.isArray(dropped.fragment.children)).toBe(true);
  });

  it('accepts a table-driven form with a dropped fields list', () => {
    const input = record({
      params: [{ name: 'tbl', label: 'Table', type: 'table' }, { name: 'go', label: 'After saving', type: 'page' }],
      fragment: layer('r', 'RecordForm', { table: 'crews', afterSave: { action: 'navigate', pageId: 'home', withRecord: false } }),
      bindings: [
        { param: 'tbl', layer: 'r', target: 'props.table' },
        { param: 'go', layer: 'r', target: 'props.afterSave.pageId' },
      ],
    });
    const r = validateFeatureInput(input, libOf());
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('detects cycles and depth through the library', () => {
    const self = record(wrapperBody('my_feature'));
    expect(codes(self)).toEqual(['feature_cycle']);
    const lib = libOf(defOf('bb', wrapperBody('my_feature')), defOf('l1', headingBody()));
    expect(codes(record(wrapperBody('bb')), lib)).toEqual(['feature_cycle']);
    const chain = libOf(defOf('l1', headingBody()), defOf('l2', wrapperBody('l1')), defOf('l3', wrapperBody('l2')));
    expect(codes(record(wrapperBody('l3')), chain)).toEqual(['feature_too_deep']);
    expect(codes(record(wrapperBody('l2')), chain)).toEqual([]);
    expect(codes(record(wrapperBody('ghost')), chain)).toEqual(['unknown_feature']);
  });

  it('findCycle returns the chain, or null', () => {
    const lib = libOf(defOf('bb', wrapperBody('aa')));
    expect(findCycle('aa', wrapperBody('bb'), lib)).toEqual(['aa', 'bb', 'aa']);
    expect(findCycle('aa', headingBody(), lib)).toBeNull();
  });

  it('replacing a feature uses the new body, not the stored one, in cycle checks', () => {
    const stored = libOf(defOf('aa', headingBody()), defOf('bb', wrapperBody('aa')));
    const edited = { ...record(wrapperBody('bb')), id: 'aa' };
    expect(validateFeatureInput(edited, stored, { replacingId: 'aa' }).ok).toBe(false);
  });
});
