// checkMenu: the catalog checks of the menu slots (props, bindings, actions), and that every production caller of
// validateAppSpec passes both catalog hooks. Synthetic data.
import { describe, expect, it } from 'vitest';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { CATALOG_CHECKS, checkLayout, checkMenu, menuPartContext } from '../validateLayout.ts';
import { crewSpec, layer } from './fixtures.ts';

const nav = (to: string, extra: Record<string, unknown> = {}): LayoutLayer['props'] => ({ action: { action: 'navigate', pageId: to, withRecord: false, ...extra } });
const create = (table: string): LayoutLayer['props'] => ({ action: { action: 'open-form', table, mode: 'create' } });

function run(menu: unknown) {
  const r = validateAppSpec({ ...crewSpec(), menu }, { ...CATALOG_CHECKS });
  return r.ok ? [] : r.issues.map((i) => [i.path, i.code]);
}

describe('menuPartContext', () => {
  it('offers every table, page and field, no sources, and is not a record page', () => {
    const ctx = menuPartContext(crewSpec());
    expect(ctx.tableIds).toEqual(['people', 'crews']);
    expect(ctx.pageIds).toContain('crew');
    expect(ctx.sourceIds).toEqual([]);
    expect(ctx.sources).toEqual({});
    expect(ctx.recordPage).toBe(false);
    expect(ctx.fields.crews.map((f) => f.id)).toContain('status');
  });
});

describe('checkMenu', () => {
  it('accepts a Button that opens a create form, a go-to Button, a Link and a QuickAdd', () => {
    expect(run({ end: [layer('b', 'Button', create('crews'), 'New record'), layer('g', 'Button', nav('home'), 'Go'), layer('l', 'Link', nav('home'), 'Home')], start: [layer('q', 'QuickAdd', { table: 'crews', field: 'name' })] })).toEqual([]);
  });

  it('a SearchBox with a source or fields is invalid_props: the runtime binds it', () => {
    expect(run({ start: [layer('s', 'SearchBox', { source: 'open_crews', fields: ['name'] })] })).toEqual([
      ['menu.start.0.props', 'invalid_props'],
    ]);
    expect(run({ start: [layer('s', 'SearchBox', { placeholder: 'Find' })] })).toEqual([]);
    expect(run({ start: [layer('s', 'SearchBox', { placeholder: '' })] })).toEqual([['menu.start.0.props.placeholder', 'invalid_props']]);
  });

  it('on a page the same SearchBox still needs its source', () => {
    const r = validateAppSpec(crewSpec(layer('root', 'Page', {}, [layer('s', 'SearchBox', { placeholder: 'x' })])), { ...CATALOG_CHECKS });
    expect(r.ok).toBe(false);
  });

  it('refuses delete-record, an edit form and withRecord: a menu has no record', () => {
    expect(run({ end: [layer('d', 'Button', { action: { action: 'delete-record', table: 'crews' } }, 'Delete')] })).toEqual([['menu.end.0.props.action', 'action_needs_record']]);
    expect(run({ end: [layer('e', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'edit' } }, 'Edit')] })).toEqual([['menu.end.0.props.action', 'action_needs_record']]);
    const withRecord = run({ end: [layer('n', 'Button', nav('home', { withRecord: true }), 'Go')] });
    expect(withRecord.length).toBeGreaterThan(0);
    expect(withRecord.every(([at, code]) => at === 'menu.end.0.props.action' && code === 'action_needs_record')).toBe(true);
  });

  it('refuses an unknown page and an unknown table, with the path under the slot', () => {
    expect(run({ end: [layer('n', 'Button', nav('nowhere'), 'Go')] }).map((i) => i[1])).toContain('unknown_page');
    expect(run({ end: [layer('n', 'Button', create('ghosts'), 'Go')] })[0][0]).toMatch(/^menu\.end\.0\.props\.action/);
    expect(run({ start: [layer('q', 'QuickAdd', { table: 'ghosts', field: 'name' })] })[0][1]).toBe('invalid_props');
  });

  it('checks the parts inside a Row, with the nested path', () => {
    expect(run({ end: [layer('r', 'Row', {}, [layer('n', 'Button', nav('nowhere'), 'Go')])] })[0][0]).toBe('menu.end.0.children.0.props.action.pageId');
  });

  it('checkMenu is a no-op for a spec with no slots and agrees with validateAppSpec', () => {
    const spec = validateAppSpec(crewSpec());
    expect(spec.ok && checkMenu({ spec: spec.value })).toEqual([]);
  });

  it('CATALOG_CHECKS holds exactly the two hooks and is frozen', () => {
    expect(Object.keys(CATALOG_CHECKS).sort()).toEqual(['checkLayout', 'checkMenu']);
    expect(CATALOG_CHECKS.checkLayout).toBe(checkLayout);
    expect(Object.isFrozen(CATALOG_CHECKS)).toBe(true);
  });
});
