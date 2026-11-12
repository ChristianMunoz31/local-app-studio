import { describe, expect, it } from 'vitest';
import { PART_DEFINITIONS } from '../../definitions.ts';
import { SPIKE_PART_CONTEXT } from '../../types.ts';
import { slotsOf, TEXT_PROPS } from '../slots.ts';
import { layer } from '../../__tests__/fixtures.ts';
import { defOf, headingBody, libOf } from './helpers.ts';

interface ZodNode {
  _zod: { def: { type: string; innerType?: ZodNode } };
}

describe('TEXT_PROPS', () => {
  it('equals the free-text props derived from the zod shapes of every part', () => {
    const derived: Record<string, string[]> = {};
    for (const d of PART_DEFINITIONS) {
      const shape = d.props(SPIKE_PART_CONTEXT).shape as unknown as Record<string, ZodNode>;
      const bound = new Set(d.binds.map((b) => b.prop.split('.')[0]));
      const names = Object.entries(shape)
        .filter(([key, schema]) => {
          let t = schema;
          while ((t._zod.def.type === 'optional' || t._zod.def.type === 'default') && t._zod.def.innerType) t = t._zod.def.innerType;
          return t._zod.def.type === 'string' && !bound.has(key);
        })
        .map(([key]) => key);
      if (names.length > 0) derived[d.name] = names;
    }
    expect(derived).toEqual(TEXT_PROPS);
  });

  it('lists the free text of the new parts and no enum, number or id', () => {
    expect(TEXT_PROPS).toMatchObject({
      PageHeader: ['title', 'subtitle'],
      Callout: ['title'],
      Collapsible: ['title'],
      Chart: ['title'],
      ProgressBar: ['label'],
      Timeline: ['emptyText'],
      Checklist: ['emptyText'],
      SortControl: ['label'],
      QuickAdd: ['placeholder', 'buttonLabel'],
    });
    const callout = slotsOf(layer('c', 'Callout', { tone: 'warning', title: 'Heads up' }, 'Paused crews are hidden.'));
    expect(callout.map((s) => s.target)).toEqual(['children', 'props.title']);
    const bar = slotsOf(layer('p', 'ProgressBar', { source: 'a', stat: 'sum', field: 'size', target: 20, label: 'Goal', tone: 'accent' }));
    expect(bar.map((s) => s.target)).toEqual(['props.source', 'props.field', 'props.label']);
  });
});

describe('slotsOf', () => {
  it('lists binds, text props and children in a fixed order', () => {
    const slots = slotsOf(layer('s', 'StatCard', { source: 'a', stat: 'sum', field: 'size', label: 'Total', tone: 'accent' }));
    expect(slots.map((s) => `${s.kind}:${s.target}`)).toEqual(['source:props.source', 'field:props.field', 'text:props.label']);
    expect(slotsOf(layer('h', 'Heading', { size: 'lg' }, 'Hi')).map((s) => s.target)).toEqual(['children']);
  });

  it('reports the table of an action object and the page ids, but only for props that exist', () => {
    const btn = layer('b', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' }, label: 'x' });
    expect(slotsOf(btn).map((s) => s.target)).toContain('props.action.table');
    const table = layer('t', 'DataTable', { source: 'a', rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } });
    expect(slotsOf(table).map((s) => s.target)).toEqual(['props.source', 'props.rowAction.pageId']);
  });

  it('turns each entry of a fields list into a field slot', () => {
    const slots = slotsOf(layer('s', 'SearchBox', { source: 'a', fields: ['name', 'notes'] }));
    expect(slots.filter((s) => s.kind === 'field').map((s) => s.target)).toEqual(['props.fields.0', 'props.fields.1']);
    expect(slots.find((s) => s.target === 'props.fields.0')?.of).toBe('props.source');
  });

  it('never offers className, style, handlers, enums, booleans or numbers', () => {
    const l = layer('s', 'Section', { title: 'T', variant: 'card', className: 'x', style: 'y', onClick: 'z', pageSize: 10, icon: 'home' });
    expect(slotsOf(l).map((s) => s.target)).toEqual(['props.title']);
    const everything = PART_DEFINITIONS.flatMap((d) => slotsOf({ ...layer('x', d.name, {}), props: { className: 'a', style: 'b', onClick: 'c', tone: 'danger', size: 'lg' } }));
    expect(everything.filter((s) => /className|style|\.on[A-Z]|tone|size/.test(s.target))).toEqual([]);
  });

  it('gives a Feature node one slot per param of the referenced feature', () => {
    const lib = libOf(defOf('say', headingBody()));
    const node = layer('n', 'Feature', { featureId: 'say', params: { title: 'x' } });
    expect(slotsOf(node, lib).map((s) => `${s.kind}:${s.target}`)).toEqual(['text:props.params.title']);
    expect(slotsOf(node)).toEqual([]);
    expect(slotsOf(layer('n', 'Feature', { featureId: 'nope', params: {} }), lib)).toEqual([]);
  });
});
