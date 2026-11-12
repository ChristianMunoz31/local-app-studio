import { describe, expect, it } from 'vitest';
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpecInput, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { PART_DEFINITIONS, PART_NAMES, getPartDefinition } from '../definitions.ts';
import { SPIKE_PART_CONTEXT } from '../types.ts';
import { checkLayer, checkLayout, partContextFor } from '../validateLayout.ts';
import { crewCtx, crewSpec, exampleCtx, homeCtx, layer } from './fixtures.ts';

const check = (root: LayoutLayer, ctx = SPIKE_PART_CONTEXT) => checkLayer(root, ctx, 'layout');
const page = (...children: LayoutLayer[]) => layer('root', 'Page', {}, children);
const codes = (root: LayoutLayer, ctx = SPIKE_PART_CONTEXT) => check(root, ctx).map((i) => i.code);
const PART_LIST = PART_NAMES.join(', ');

describe('the catalog', () => {
  it('lists the 34 parts in catalog order', () => {
    expect(PART_NAMES).toEqual([
      'Page', 'Section', 'Grid', 'Card', 'Tabs', 'Tab', 'Heading', 'Text', 'Divider', 'DataTable', 'RecordForm', 'RecordDetail',
      'StatCard', 'RecordList', 'FilterBar', 'SearchBox', 'ReferencePicker', 'Button', 'Link', 'Columns', 'Column', 'Row', 'NavLinks',
      'Breadcrumb', 'BackLink', 'PageHeader', 'Callout', 'Collapsible', 'Chart', 'ProgressBar', 'Timeline', 'Checklist', 'SortControl',
      'QuickAdd',
    ]);
    expect(PART_NAMES).toHaveLength(34);
    expect(PART_NAMES).not.toContain('ExportButton');
    expect(getPartDefinition('Heading')?.group).toBe('layout');
    expect(getPartDefinition('DataTable')?.group).toBe('data');
    expect(getPartDefinition('Button')?.group).toBe('action');
    expect(getPartDefinition('Link')?.group).toBe('action');
    expect(getPartDefinition('Nope')).toBeUndefined();
  });

  it('keeps every description within 200 chars and every name equal to its example type', () => {
    for (const def of PART_DEFINITIONS) {
      expect(def.description.length, def.name).toBeLessThanOrEqual(200);
      expect(def.example.type).toBe(def.name);
    }
  });

  it('every example validates in context (Tab inside Tabs, Column inside Columns, the rest inside a Page)', () => {
    const ctx = exampleCtx();
    for (const def of PART_DEFINITIONS) {
      if (def.name === 'Page') expect(check(def.example, ctx), def.name).toEqual([]);
      else if (def.name === 'Tab') expect(check(page(layer('tabs', 'Tabs', {}, [def.example])), ctx), def.name).toEqual([]);
      else if (def.name === 'Column') expect(check(page(layer('cols', 'Columns', {}, [def.example, layer('c2', 'Column')])), ctx), def.name).toEqual([]);
      else expect(check(page(def.example), ctx), def.name).toEqual([]);
    }
  });

  it('keeps Row.allowedChildren equal to every part except Page, Tab, Column, Columns, Tabs and Section', () => {
    const expected = PART_NAMES.filter((n) => !['Page', 'Tab', 'Column', 'Columns', 'Tabs', 'Section'].includes(n));
    expect([...(getPartDefinition('Row')?.allowedChildren ?? [])].sort()).toEqual([...expected].sort());
  });

  it('gives the new parts their group, children kind and child limits', () => {
    expect(getPartDefinition('Columns')).toMatchObject({ group: 'layout', children: 'parts', allowedChildren: ['Column'], childCount: { min: 2, max: 4 } });
    expect(getPartDefinition('Column')).toMatchObject({ group: 'layout', children: 'parts', childOf: ['Columns'] });
    expect(getPartDefinition('PageHeader')).toMatchObject({ group: 'layout', allowedChildren: ['Button', 'Link', 'QuickAdd'], childCount: { min: 0, max: 3 } });
    expect(getPartDefinition('NavLinks')).toMatchObject({ children: 'parts', allowedChildren: ['Button', 'Link'], childCount: { min: 0, max: 3 } });
    for (const name of ['NavLinks', 'Breadcrumb', 'BackLink']) expect(getPartDefinition(name)?.group, name).toBe('action');
    for (const name of ['Chart', 'ProgressBar', 'Timeline', 'Checklist', 'SortControl', 'QuickAdd']) expect(getPartDefinition(name)?.group, name).toBe('data');
    expect(getPartDefinition('BackLink')?.textDefault).toBe('Back');
    expect(getPartDefinition('Callout')?.textDefault).toBe('Something worth knowing.');
  });

  it('gives the new parts the defaults of the design', () => {
    const ctx = exampleCtx();
    const parse = (name: string, props: Record<string, unknown>) => getPartDefinition(name)!.props(ctx).parse(props);
    expect(parse('Columns', {})).toEqual({ layout: 'equal', gap: 'md', align: 'top' });
    expect(parse('Row', {})).toEqual({ gap: 'sm', justify: 'start', wrap: 'wrap' });
    expect(parse('NavLinks', {})).toEqual({ show: 'menu', direction: 'horizontal', icons: 'show' });
    expect(parse('Callout', {})).toEqual({ tone: 'note' });
    expect(parse('Collapsible', { title: 'T' })).toEqual({ title: 'T', start: 'closed' });
    expect(parse('Chart', { source: 'open_crews', groupBy: 'status' })).toEqual({ source: 'open_crews', kind: 'bar', groupBy: 'status', measure: 'count', bucket: 'month' });
    expect(parse('ProgressBar', { source: 'open_crews', label: 'L' })).toEqual({ source: 'open_crews', stat: 'count', target: 10, label: 'L', tone: 'accent' });
    expect(parse('Timeline', { source: 'open_tasks', dateField: 'due' })).toEqual({ source: 'open_tasks', dateField: 'due', order: 'newest' });
  });

  it('limits the choices of the new parts to enums and bounded strings', () => {
    const ctx = exampleCtx();
    const bad = (name: string, props: Record<string, unknown>) => getPartDefinition(name)!.props(ctx).safeParse(props).success;
    expect(bad('Columns', { layout: 'thirds' })).toBe(false);
    expect(bad('Columns', { className: 'x' })).toBe(false);
    expect(bad('ProgressBar', { source: 'open_crews', label: 'L', target: 0 })).toBe(false);
    expect(bad('ProgressBar', { source: 'open_crews', label: 'L', target: 1_000_000_001 })).toBe(false);
    expect(bad('ProgressBar', { source: 'open_crews', label: 'L', target: 2.5 })).toBe(false);
    expect(bad('NavLinks', { show: 'pages', pages: [] })).toBe(false);
    expect(bad('NavLinks', { show: 'pages', pages: ['home', 'home', 'home', 'home', 'home', 'home', 'home', 'home', 'home'] })).toBe(false);
    expect(bad('NavLinks', { show: 'pages', pages: ['crew'] })).toBe(false);
    expect(bad('SortControl', { source: 'open_crews', fields: [] })).toBe(false);
    expect(bad('SortControl', { source: 'open_crews', fields: ['name', 'size', 'status', 'created_at', 'updated_at', 'name', 'size'] })).toBe(false);
    expect(bad('QuickAdd', { table: 'crews', field: 'size' })).toBe(false);
    expect(bad('QuickAdd', { table: 'crews', field: 'created_at' })).toBe(false);
    expect(bad('Chart', { source: 'open_crews', groupBy: 'name' })).toBe(false);
    expect(bad('Chart', { source: 'open_crews', groupBy: 'status', bucket: 'year' })).toBe(false);
    expect(bad('Checklist', { source: 'open_tasks', field: 'title' })).toBe(false);
    expect(bad('Breadcrumb', { page: 'crew' })).toBe(false);
    expect(bad('PageHeader', { title: 'x'.repeat(61) })).toBe(false);
    expect(bad('PageHeader', { title: 'T', subtitle: 'x'.repeat(121) })).toBe(false);
  });

  it('gives defaults in the schema, so empty props are valid', () => {
    expect(getPartDefinition('Section')!.props(SPIKE_PART_CONTEXT).parse({})).toEqual({ variant: 'card' });
    expect(getPartDefinition('Button')!.props(SPIKE_PART_CONTEXT).parse({})).toEqual({
      variant: 'primary',
      size: 'md',
      action: { action: 'navigate', pageId: 'home', withRecord: false },
    });
    expect(getPartDefinition('Grid')!.props(SPIKE_PART_CONTEXT).parse({})).toEqual({ columns: 2, gap: 'md' });
    expect(getPartDefinition('Card')!.props(SPIKE_PART_CONTEXT).parse({})).toEqual({ tone: 'neutral', variant: 'subtle' });
    expect(getPartDefinition('Divider')!.props(SPIKE_PART_CONTEXT).parse({})).toEqual({ spacing: 'md' });
    expect(getPartDefinition('DataTable')!.props(crewCtx()).parse({ source: 'open_crews' })).toEqual({ source: 'open_crews', pageSize: 25 });
    expect(getPartDefinition('StatCard')!.props(crewCtx()).parse({ source: 'open_crews', label: 'Crews' })).toEqual({
      source: 'open_crews',
      stat: 'count',
      label: 'Crews',
      tone: 'neutral',
    });
    expect(getPartDefinition('RecordForm')!.props(crewCtx()).parse({ table: 'crews' })).toEqual({ table: 'crews', mode: 'create' });
  });
});

describe('checkLayer: structure', () => {
  it('accepts a page of the layout and text parts', () => {
    const root = layer('root', 'Page', { width: 'narrow' }, [
      layer('h', 'Heading', { size: 'lg', tone: 'accent' }, 'Title'),
      layer('s', 'Section', { title: 'Block', subtitle: 'About it', icon: 'users', variant: 'plain' }, [
        layer('t', 'Text', { size: 'sm', tone: 'muted' }, 'Body'),
        layer('b', 'Button', { variant: 'danger', size: 'sm', icon: 'star', action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go'),
      ]),
      layer('g', 'Grid', { columns: 3, gap: 'lg' }, [layer('c', 'Card', { title: 'Tile', tone: 'accent', variant: 'outline' }, [layer('l', 'Link', { action: { action: 'navigate', pageId: 'home' } }, 'Home')])]),
      layer('d', 'Divider', { spacing: 'sm' }),
      layer('tabs', 'Tabs', {}, [layer('tab', 'Tab', { label: 'One' }, [layer('t2', 'Text', {}, 'x')])]),
    ]);
    expect(check(root)).toEqual([]);
  });

  it('unknown_part: names the part and lists the catalog', () => {
    expect(check(page(layer('x', 'Carousel')))).toEqual([
      { path: 'layout.children.0.type', code: 'unknown_part', message: `"Carousel" is not a part. Use one of: ${PART_LIST}.` },
    ]);
  });

  it('invalid_props: a bad enum value carries the zod path', () => {
    const issues = check(page(layer('h', 'Heading', { size: 'huge' }, 'x')));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid_props');
    expect(issues[0].path).toBe('layout.children.0.props.size');
    expect(issues[0].message).toMatch(/^Heading: .*\.$/);
  });

  it('invalid_props: an unknown prop (className included) is refused with the allowed props', () => {
    expect(check(page(layer('t', 'Text', { className: 'p-8' }, 'x')))).toEqual([
      { path: 'layout.children.0.props', code: 'invalid_props', message: 'Text has no prop "className". Use: size, tone.' },
    ]);
  });

  it('invalid_props: a Grid with 5 columns, a DataTable with 9 columns', () => {
    expect(check(page(layer('g', 'Grid', { columns: 5 })), crewCtx()).map((i) => [i.code, i.path])).toEqual([['invalid_props', 'layout.children.0.props.columns']]);
    const nine = ['name', 'size', 'status', 'lead_id', 'created_at', 'updated_at', 'name', 'size', 'status'];
    expect(codes(page(layer('t', 'DataTable', { source: 'open_crews', columns: nine })), crewCtx())).toEqual(['invalid_props']);
  });

  it('invalid_props: a nested action id outside the context is reported as unknown_page', () => {
    const issues = check(page(layer('b', 'Button', { action: { action: 'navigate', pageId: 'elsewhere' } }, 'Go')));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['unknown_page', 'layout.children.0.props.action.pageId']]);
    expect(issues[0].message).toBe('Button: there is no page "elsewhere". Use one of: home.');
  });

  it('invalid_props: open-form and delete-record need a table, and the spike has none', () => {
    expect(codes(page(layer('b', 'Button', { action: { action: 'open-form', table: 'crews' } }, 'Add')))).toEqual(['invalid_props']);
    expect(codes(page(layer('b', 'Button', { action: { action: 'delete-record', table: 'crews' } }, 'Del')))).toEqual(['invalid_props']);
  });

  it('child_not_allowed: a Page below the root, a Tab outside Tabs, a Section inside Tabs', () => {
    expect(check(page(layer('p', 'Page')))).toEqual([
      { path: 'layout.children.0.type', code: 'child_not_allowed', message: 'Page can only be the top part of a page.' },
    ]);
    expect(check(page(layer('t', 'Tab', { label: 'x' })))).toEqual([
      { path: 'layout.children.0.type', code: 'child_not_allowed', message: 'Tab can only go inside: Tabs.' },
    ]);
    expect(check(page(layer('t', 'Tabs', {}, [layer('s', 'Section')])))).toEqual([
      { path: 'layout.children.0.children.0.type', code: 'child_not_allowed', message: 'Tabs can only hold: Tab.' },
    ]);
  });

  it('children_not_allowed: parts inside a text part, text inside a container, children on a data part', () => {
    const a = check(page(layer('t', 'Text', {}, [layer('h', 'Heading', {}, 'x')])));
    expect(a.map((i) => [i.path, i.code])).toEqual([['layout.children.0.children', 'children_not_allowed']]);
    const b = check(page(layer('s', 'Section', {}, 'loose text')));
    expect(b.map((i) => [i.path, i.code])).toEqual([['layout.children.0.children', 'children_not_allowed']]);
    expect(b[0].message).toMatch(/holds other parts, not text/);
    expect(check(page(layer('d', 'Divider', {}, 'x'))).map((i) => i.code)).toEqual(['children_not_allowed']);
    expect(codes(page(layer('d', 'DataTable', { source: 'open_crews' }, [layer('t', 'Text')])), crewCtx())).toEqual(['children_not_allowed']);
  });

  it('allows an empty children list on a text part and keeps checking below unknown parts', () => {
    expect(check(page(layer('t', 'Text', {}, [])))).toEqual([]);
    const issues = check(page(layer('x', 'Mystery', {}, [layer('h', 'Heading', { size: 'huge' }, 'x')])));
    expect(issues.map((i) => i.code)).toEqual(['unknown_part', 'invalid_props']);
  });

  it('reports issues in document order and stops at maxIssues', () => {
    const root = page(layer('a', 'Nope'), layer('b', 'Nada'), layer('c', 'Nix'));
    expect(check(root).map((i) => i.path)).toEqual(['layout.children.0.type', 'layout.children.1.type', 'layout.children.2.type']);
    expect(checkLayer(root, SPIKE_PART_CONTEXT, 'layout', 2)).toHaveLength(2);
  });
});

describe('checkLayer: bindings', () => {
  const ctx = crewCtx();
  const one = (type: string, props: LayoutLayer['props']) => check(page(layer('x', type, props)), ctx);

  it('unknown_source: a source the page does not have', () => {
    const issues = one('DataTable', { source: 'nope' });
    expect(issues).toEqual([
      { path: 'layout.children.0.props.source', code: 'unknown_source', message: 'DataTable: this page has no source "nope". Use one of: open_crews, one_crew.' },
    ]);
  });

  it('wrong_source_mode: a record source in a list part and a list source in a record part', () => {
    const a = one('DataTable', { source: 'one_crew' });
    expect(a.map((i) => [i.code, i.path])).toEqual([['wrong_source_mode', 'layout.children.0.props.source']]);
    expect(a[0].message).toBe('DataTable needs a list source, but "one_crew" is a record source. Use one of: open_crews.');
    expect(one('RecordDetail', { source: 'open_crews' }).map((i) => i.code)).toEqual(['wrong_source_mode']);
  });

  it('unknown_field: a column the table does not have, with the allowed fields', () => {
    const issues = one('DataTable', { source: 'open_crews', columns: ['name', 'color'] });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['unknown_field', 'layout.children.0.props.columns.1']]);
    expect(issues[0].message).toContain('table "crews" has no field "color"');
    expect(issues[0].message).toContain('name, size, lead_id, status, created_at, updated_at');
  });

  it('unknown_field: a runtime column is fine in a table but not in a form', () => {
    expect(one('DataTable', { source: 'open_crews', columns: ['created_at'] })).toEqual([]);
    const issues = one('RecordForm', { table: 'crews', fields: ['name', 'created_at'] });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['unknown_field', 'layout.children.0.props.fields.1']]);
    expect(issues[0].message).toContain('cannot be edited');
  });

  it('wrong_field_type: a text field in a StatCard sum, a number field in a SearchBox', () => {
    const a = one('StatCard', { source: 'open_crews', stat: 'sum', field: 'name', label: 'x' });
    expect(a.map((i) => [i.code, i.path])).toEqual([['wrong_field_type', 'layout.children.0.props.field']]);
    expect(a[0].message).toContain('"name" is a text field');
    expect(a[0].message).toContain('integer, real');
    expect(one('SearchBox', { source: 'open_crews', fields: ['size'] }).map((i) => i.code)).toEqual(['wrong_field_type']);
    expect(one('FilterBar', { source: 'open_crews', fields: ['name'] }).map((i) => i.code)).toEqual(['wrong_field_type']);
    expect(one('ReferencePicker', { source: 'open_crews', field: 'status' }).map((i) => i.code)).toEqual(['wrong_field_type']);
    expect(one('RecordList', { source: 'open_crews', badgeField: 'name' }).map((i) => i.code)).toEqual(['wrong_field_type']);
  });

  it('unknown_page: rowAction, afterSave and thenPageId name pages that exist', () => {
    expect(one('DataTable', { source: 'open_crews', rowAction: { action: 'navigate', pageId: 'gone' } }).map((i) => i.code)).toContain('unknown_page');
    expect(one('RecordForm', { table: 'crews', afterSave: { action: 'navigate', pageId: 'gone' } }).map((i) => i.code)).toEqual(['unknown_page']);
    expect(one('Link', { action: { action: 'navigate', pageId: 'gone' } }).map((i) => i.code)).toEqual(['unknown_page']);
    const del = check(page(layer('r', 'RecordDetail', { source: 'one_crew' }), layer('b', 'Button', { action: { action: 'delete-record', table: 'crews', thenPageId: 'gone' } }, 'x')), ctx);
    expect(del.map((i) => [i.code, i.path])).toEqual([['unknown_page', 'layout.children.1.props.action.thenPageId']]);
  });

  it('reports one issue per problem, not an enum error on top of the binding error', () => {
    expect(one('DataTable', { source: 'one_crew', columns: ['color'] }).map((i) => i.code)).toEqual(['wrong_source_mode', 'unknown_field']);
  });

  it('accepts every binding of a valid page', () => {
    const root = page(
      layer('a', 'DataTable', { source: 'open_crews', columns: ['name', 'status', 'lead_id'], pageSize: 10, emptyText: 'No crews' }),
      layer('b', 'FilterBar', { source: 'open_crews', fields: ['status', 'lead_id', 'created_at'] }),
      layer('c', 'SearchBox', { source: 'open_crews', fields: ['name'], placeholder: 'Find a crew' }),
      layer('d', 'ReferencePicker', { source: 'open_crews', field: 'lead_id' }),
      layer('e', 'StatCard', { source: 'open_crews', stat: 'avg', field: 'size', label: 'Average size', tone: 'accent', icon: 'users' }),
      layer('f', 'RecordList', { source: 'open_crews', titleField: 'name', subtitleField: 'size', badgeField: 'status' }),
      layer('g', 'RecordDetail', { source: 'one_crew', fields: ['name', 'lead_id'] }),
      layer('h', 'RecordForm', { table: 'crews', mode: 'edit', source: 'one_crew', fields: ['name', 'size'] }),
    );
    expect(check(root, ctx)).toEqual([]);
  });
});

describe('checkLayer: cross-prop rules', () => {
  const ctx = crewCtx();
  const one = (type: string, props: LayoutLayer['props']) => check(page(layer('x', type, props)), ctx);

  it('RecordForm in edit mode needs a record source of its table', () => {
    const a = one('RecordForm', { table: 'crews', mode: 'edit' });
    expect(a.map((i) => [i.code, i.path])).toEqual([['invalid_props', 'layout.children.0.props.source']]);
    expect(a[0].message).toBe('RecordForm in edit mode needs a record source. Set source to a record source of table "crews".');
    const b = one('RecordForm', { table: 'people', mode: 'edit', source: 'one_crew' });
    expect(b.map((i) => i.code)).toEqual(['invalid_props']);
    expect(b[0].message).toContain('reads table "crews", not "people"');
    expect(one('RecordForm', { table: 'crews', mode: 'create' })).toEqual([]);
  });

  it('StatCard with a stat other than count needs a field', () => {
    const a = one('StatCard', { source: 'open_crews', stat: 'max', label: 'Biggest' });
    expect(a.map((i) => [i.code, i.path])).toEqual([['invalid_props', 'layout.children.0.props.field']]);
    expect(a[0].message).toContain('needs a field');
    expect(one('StatCard', { source: 'open_crews', label: 'All crews' })).toEqual([]);
  });
});

describe('checkLayer: action_needs_record', () => {
  const ctx = crewCtx();
  const home = homeCtx();
  const button = (action: LayoutLayer['props']['action'], at = ctx) => check(page(layer('b', 'Button', { action }, 'Go')), at);

  it('withRecord needs a target page whose route ends in /:id', () => {
    const issues = button({ action: 'navigate', pageId: 'home', withRecord: true });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['action_needs_record', 'layout.children.0.props.action']]);
    expect(issues[0].message).toContain('withRecord must be false');
  });

  it('a page that needs an id needs withRecord true', () => {
    const issues = button({ action: 'navigate', pageId: 'crew', withRecord: false });
    expect(issues.map((i) => i.code)).toEqual(['action_needs_record']);
    expect(issues[0].message).toContain('Set withRecord to true');
  });

  it('withRecord needs a record at hand: a /:id page, a row action or a form', () => {
    expect(button({ action: 'navigate', pageId: 'crew', withRecord: true })).toEqual([]);
    expect(button({ action: 'navigate', pageId: 'crew', withRecord: true }, home).map((i) => i.code)).toEqual(['action_needs_record']);
    const row = check(page(layer('t', 'DataTable', { source: 'open_crews', rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } })), home);
    expect(row).toEqual([]);
    const form = check(page(layer('f', 'RecordForm', { table: 'crews', afterSave: { action: 'navigate', pageId: 'crew', withRecord: true } })), home);
    expect(form).toEqual([]);
  });

  it('open-form edit and delete-record need a record source of the table on a /:id page', () => {
    expect(button({ action: 'open-form', table: 'crews', mode: 'edit' })).toEqual([]);
    expect(button({ action: 'delete-record', table: 'crews', thenPageId: 'home' })).toEqual([]);
    expect(button({ action: 'open-form', table: 'crews', mode: 'create' }, home)).toEqual([]);
    expect(button({ action: 'open-form', table: 'crews', mode: 'edit' }, home).map((i) => i.code)).toEqual(['action_needs_record']);
    expect(button({ action: 'delete-record', table: 'crews' }, home).map((i) => i.code)).toEqual(['action_needs_record']);
    // A record page, but its record is another table's.
    expect(button({ action: 'delete-record', table: 'people' }).map((i) => i.code)).toEqual(['action_needs_record']);
  });

  it('as a rowAction, open-form edit and delete-record act on the row of the source table', () => {
    const ok = check(page(layer('t', 'RecordList', { source: 'open_crews', rowAction: { action: 'delete-record', table: 'crews' } })), home);
    expect(ok).toEqual([]);
    const bad = check(page(layer('t', 'RecordList', { source: 'open_crews', rowAction: { action: 'open-form', table: 'people', mode: 'edit' } })), home);
    expect(bad.map((i) => [i.code, i.path])).toEqual([['action_needs_record', 'layout.children.0.props.rowAction']]);
  });
});

describe('partContextFor and checkLayout as the validateAppSpec hook', () => {
  it('builds the part context from the spec, with runtime columns and record pages', () => {
    const spec = crewSpec();
    expect(partContextFor(spec, spec.pages[1])).toEqual({
      tableIds: ['people', 'crews'],
      pageIds: ['home', 'crew'],
      sourceIds: ['open_crews', 'one_crew'],
      sources: { open_crews: { table: 'crews', mode: 'list' }, one_crew: { table: 'crews', mode: 'record' } },
      fields: {
        people: [
          { id: 'name', type: 'text' },
          { id: 'created_at', type: 'datetime' },
          { id: 'updated_at', type: 'datetime' },
        ],
        crews: [
          { id: 'name', type: 'text' },
          { id: 'size', type: 'integer' },
          { id: 'lead_id', type: 'reference' },
          { id: 'status', type: 'select' },
          { id: 'created_at', type: 'datetime' },
          { id: 'updated_at', type: 'datetime' },
        ],
      },
      recordPage: true,
      recordPageIds: ['crew'],
    });
  });

  it('tolerates a spec that was not normalized', () => {
    const bare: AppSpecInput = {
      specVersion: 1,
      app: { name: 'Bare App', slug: 'bare-app', identifier: 'com.example.bare', version: '1.0.0' },
      pages: [{ id: 'home', title: 'Home', route: '/', layout: layer('root', 'Page') }],
    };
    expect(partContextFor(bare, bare.pages[0])).toEqual({
      tableIds: [],
      pageIds: ['home'],
      sourceIds: [],
      sources: {},
      fields: {},
      recordPage: false,
      recordPageIds: [],
    });
    const withSource: AppSpecInput = crewSpec();
    const raw = { ...withSource.pages[1], sources: [{ id: 's', table: 'crews' }] } as AppSpecInput['pages'][number];
    expect(partContextFor(withSource, raw).sources.s).toEqual({ table: 'crews', mode: 'list' });
  });

  it('passes a valid page and reports catalog issues at the page layout path', () => {
    const good = validateAppSpec(crewSpec(page(layer('h', 'Heading', {}, 'Hi'))), { checkLayout });
    expect(good.ok).toBe(true);
    const bad = validateAppSpec(crewSpec(page(layer('x', 'Gauge'))), { checkLayout });
    expect(bad.ok).toBe(false);
    expect(bad.issues).toEqual([
      { path: 'pages.1.layout.children.0.type', code: 'unknown_part', message: `"Gauge" is not a part. Use one of: ${PART_LIST}.` },
    ]);
  });

  it('the Crew Roster fixture validates with the full catalog', () => {
    const result = validateAppSpec(crewRoster, { checkLayout });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('cross-prop rules and child counts of the new parts', () => {
  const ctx = exampleCtx();
  const only = (layout: LayoutLayer) => check(page(layout), ctx).map((i) => [i.code, i.path, i.message]);
  const col = (id: string) => layer(id, 'Column', {}, [layer(`${id}_t`, 'Text', {}, 'x')]);

  it('Chart: sum and avg need a field, count does not', () => {
    expect(only(layer('c', 'Chart', { source: 'open_crews', groupBy: 'status', measure: 'sum' }))).toEqual([
      ['invalid_props', 'layout.children.0.props.field', 'Chart with measure "sum" needs a field. Set field to an integer or real field, or use measure "count".'],
    ]);
    expect(codes(page(layer('c', 'Chart', { source: 'open_crews', groupBy: 'status', measure: 'avg' })), ctx)).toEqual(['invalid_props']);
    expect(codes(page(layer('c', 'Chart', { source: 'open_crews', groupBy: 'status' })), ctx)).toEqual([]);
    expect(codes(page(layer('c', 'Chart', { source: 'open_crews', groupBy: 'status', measure: 'sum', field: 'size' })), ctx)).toEqual([]);
  });

  it('ProgressBar: sum needs a field on a list source, any stat needs one on a record source', () => {
    expect(only(layer('p', 'ProgressBar', { source: 'open_crews', stat: 'sum', label: 'L' }))).toEqual([
      ['invalid_props', 'layout.children.0.props.field', 'ProgressBar with stat "sum" needs a field. Set field to an integer or real field, or use stat "count".'],
    ]);
    expect(only(layer('p', 'ProgressBar', { source: 'one_crew', label: 'L' }))).toEqual([
      ['invalid_props', 'layout.children.0.props.field', 'ProgressBar on a record source needs a field. Set field to an integer or real field of that record.'],
    ]);
    expect(codes(page(layer('p', 'ProgressBar', { source: 'open_crews', label: 'L' })), ctx)).toEqual([]);
    expect(codes(page(layer('p', 'ProgressBar', { source: 'one_crew', field: 'size', label: 'L' })), ctx)).toEqual([]);
  });

  it('NavLinks: show pages needs pages', () => {
    expect(only(layer('n', 'NavLinks', { show: 'pages' }))).toEqual([
      ['invalid_props', 'layout.children.0.props.pages', 'NavLinks with show "pages" needs pages. Set pages to 1 to 8 page ids, or use show "menu".'],
    ]);
    expect(codes(page(layer('n', 'NavLinks', { show: 'pages', pages: ['home'] })), ctx)).toEqual([]);
  });

  it('Columns: wrong_child_count below 2 and above 4, with the count in the sentence', () => {
    expect(only(layer('c', 'Columns', {}, [col('a')]))).toEqual([['wrong_child_count', 'layout.children.0.children', 'Columns holds 2 to 4 Column parts. It has 1.']]);
    expect(only(layer('c', 'Columns', {}, []))).toEqual([['wrong_child_count', 'layout.children.0.children', 'Columns holds 2 to 4 Column parts. It has 0.']]);
    expect(only(layer('c', 'Columns', {}, ['a', 'b', 'c', 'd', 'e'].map(col)))).toEqual([['wrong_child_count', 'layout.children.0.children', 'Columns holds 2 to 4 Column parts. It has 5.']]);
    expect(codes(page(layer('c', 'Columns', {}, ['a', 'b'].map(col))), ctx)).toEqual([]);
    expect(codes(page(layer('c', 'Columns', {}, ['a', 'b', 'c', 'd'].map(col))), ctx)).toEqual([]);
  });

  it('Columns and Column: only each other, and Column never alone', () => {
    expect(codes(page(layer('c', 'Columns', {}, [col('a'), layer('s', 'Section')])), ctx)).toEqual(['child_not_allowed']);
    expect(check(page(col('a')), ctx).map((i) => [i.code, i.message])).toEqual([['child_not_allowed', 'Column can only go inside: Columns.']]);
    expect(codes(page(layer('c', 'Columns', {}, [col('a'), col('b')])), ctx)).toEqual([]);
  });

  it('PageHeader: at most 3 parts, and only Button, Link and QuickAdd', () => {
    const button = (id: string) => layer(id, 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go');
    const header = (kids: LayoutLayer[]) => layer('h', 'PageHeader', { title: 'T' }, kids);
    expect(codes(page(header([])), ctx)).toEqual([]);
    expect(codes(page(header([button('a'), button('b'), button('c')])), ctx)).toEqual([]);
    expect(only(header([button('a'), button('b'), button('c'), button('d')]))).toEqual([
      ['wrong_child_count', 'layout.children.0.children', 'PageHeader holds at most 3 parts. It has 4.'],
    ]);
    expect(codes(page(header([layer('t', 'Text', {}, 'x')])), ctx)).toEqual(['child_not_allowed']);
  });

  it('Row: holds small parts, not Section, Tabs or Columns', () => {
    const row = (kids: LayoutLayer[]) => layer('r', 'Row', {}, kids);
    expect(codes(page(row([layer('t', 'Text', {}, 'x'), layer('d', 'Divider')])), ctx)).toEqual([]);
    expect(codes(page(row([layer('s', 'Section')])), ctx)).toEqual(['child_not_allowed']);
    expect(codes(page(row([layer('t', 'Tabs')])), ctx)).toEqual(['child_not_allowed']);
  });

  it('binding checks: Breadcrumb needs a record source and a page without :id, Checklist an editable yes/no field', () => {
    expect(codes(page(layer('b', 'Breadcrumb', { page: 'home', source: 'open_crews' })), ctx)).toEqual(['wrong_source_mode']);
    expect(codes(page(layer('b', 'Breadcrumb', { page: 'nowhere' })), ctx)).toEqual(['unknown_page']);
    expect(codes(page(layer('c', 'Checklist', { source: 'open_tasks', field: 'title' })), ctx)).toEqual(['wrong_field_type']);
    expect(codes(page(layer('c', 'Checklist', { source: 'open_tasks', field: 'nope' })), ctx)).toEqual(['unknown_field']);
    expect(codes(page(layer('q', 'QuickAdd', { table: 'crews', field: 'size' })), ctx)).toEqual(['wrong_field_type']);
    expect(codes(page(layer('t', 'Timeline', { source: 'one_crew', dateField: 'created_at' })), ctx)).toEqual(['wrong_source_mode']);
  });
});
