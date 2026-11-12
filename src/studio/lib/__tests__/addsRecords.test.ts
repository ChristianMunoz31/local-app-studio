import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { addsRecords } from '../addsRecords';

const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer[] | string = []): LayoutLayer => ({ id, type, props, children });
const specWith = (root: LayoutLayer, menu?: AppSpec['menu']): AppSpec =>
  ({ app: { name: 'A' }, tables: [], pages: [{ id: 'home', title: 'Home', route: '/', sources: [], layout: root }], ...(menu ? { menu } : {}) }) as unknown as AppSpec;

describe('addsRecords', () => {
  it('is false for a page with only a heading and a table', () => {
    expect(addsRecords(specWith(layer('p', 'Page', {}, [layer('h', 'Heading'), layer('t', 'DataTable')])))).toBe(false);
  });

  it('finds a form or a quick add, however deep', () => {
    expect(addsRecords(specWith(layer('p', 'Page', {}, [layer('r', 'Row', {}, [layer('f', 'RecordForm')])])))).toBe(true);
    expect(addsRecords(specWith(layer('p', 'Page', {}, [layer('c', 'Columns', {}, [layer('r', 'Row', {}, [layer('q', 'QuickAdd')])])])))).toBe(true);
  });

  it('counts a button that opens a form to add a record, not one that goes to a page', () => {
    const open = layer('b', 'Button', { action: { action: 'open-form', table: 'crews', mode: 'create' } });
    const go = layer('g', 'Button', { action: { action: 'navigate', pageId: 'home', withRecord: false } });
    expect(addsRecords(specWith(layer('p', 'Page', {}, [open])))).toBe(true);
    expect(addsRecords(specWith(layer('p', 'Page', {}, [go])))).toBe(false);
  });

  it('looks in the menu bar slots too', () => {
    const menu = { start: [layer('q', 'QuickAdd')] } as unknown as AppSpec['menu'];
    expect(addsRecords(specWith(layer('p', 'Page'), menu))).toBe(true);
  });
});
