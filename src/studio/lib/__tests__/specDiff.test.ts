import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import { diffSpecs, summarizeChanges } from '../specDiff';

const clone = (): AppSpec => structuredClone(baseSpec());
const sentences = (a: AppSpec, b: AppSpec): string[] => diffSpecs(a, b).map((c) => c.sentence);

describe('diffSpecs', () => {
  it('gives nothing for identical specs', () => {
    expect(diffSpecs(baseSpec(), clone())).toEqual([]);
    expect(summarizeChanges([])).toBe('No changes.');
  });

  it('describes added tables and flags removed ones as destructive', () => {
    const next = clone();
    next.tables.push({ id: 'people', label: 'People', fields: [{ id: 'name', label: 'Name', type: 'text', required: false }] });
    expect(sentences(baseSpec(), next)).toEqual(['Adds the table "People" with 1 field.']);
    const gone = clone();
    gone.tables = [];
    const changes = diffSpecs(baseSpec(), gone);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'removed', area: 'table', destructive: true, sentence: 'Removes the table "Crews" and its data.' });
  });

  it('describes table label and title changes', () => {
    const next = clone();
    next.tables[0].label = 'Teams';
    next.tables[0].titleField = 'status';
    expect(sentences(baseSpec(), next)).toEqual(['Renames the table "Crews" to "Teams".', 'Shows "Status" as the title of "Teams" records.']);
  });

  it('describes field changes with the destructive ones marked', () => {
    const next = clone();
    const fields = next.tables[0].fields;
    fields[1] = { id: 'size', label: 'Size', type: 'real', required: false };
    fields[0] = { id: 'name', label: 'Name', type: 'text', required: false };
    fields[2] = { id: 'status', label: 'Status', type: 'select', required: true, options: ['active', 'closed'] };
    fields.push({ id: 'notes', label: 'Notes', type: 'longtext', required: false });
    const changes = diffSpecs(baseSpec(), next);
    const by = (s: string) => changes.find((c) => c.sentence === s);
    expect(by('Changes "Size" in "Crews" from whole number to number.')?.destructive).toBe(true);
    expect(by('Makes "Name" in "Crews" optional.')?.destructive).toBe(false);
    expect(by('Makes "Status" in "Crews" required.')?.destructive).toBe(true);
    expect(by('Removes the choices paused from "Status" in "Crews".')?.destructive).toBe(true);
    expect(by('Adds the choices closed to "Status" in "Crews".')?.destructive).toBe(false);
    expect(by('Adds the field "Notes" (long text) to "Crews".')).toBeTruthy();
  });

  it('describes removed fields, defaults and select field wording', () => {
    const next = clone();
    next.tables[0].fields = [
      { id: 'name', label: 'Name', type: 'text', required: true, default: 'Crew' },
      { id: 'kind', label: 'Kind', type: 'select', required: false, options: ['a', 'b'] },
    ];
    const s = sentences(baseSpec(), next);
    expect(s).toContain('Sets the default of "Name" in "Crews" to "Crew".');
    expect(s).toContain('Adds the field "Kind" (choice of: a, b) to "Crews".');
    expect(s).toContain('Removes the field "Size" from "Crews".');
    expect(diffSpecs(baseSpec(), next).find((c) => c.area === 'field' && c.kind === 'removed')?.destructive).toBe(true);
  });

  it('describes reference fields', () => {
    const a = clone();
    a.tables.push({ id: 'people', label: 'People', fields: [{ id: 'name', label: 'Name', type: 'text', required: false }] });
    const b = structuredClone(a);
    b.tables[0].fields.push({ id: 'owner', label: 'Owner', type: 'reference', required: false, table: 'people' });
    expect(sentences(a, b)).toEqual(['Adds the field "Owner" (link to "People") to "Crews".']);
  });

  it('describes pages, sources, menu and theme', () => {
    const next = clone();
    next.pages[0].title = 'Start';
    next.pages[0].layout = { id: 'root_home', type: 'Page', props: {}, children: [] };
    next.pages[0].sources = [{ id: 'open_crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 }];
    next.pages.push({ id: 'dash', title: 'Dashboard', route: '/dashboard', sources: [], layout: { id: 'root_dash', type: 'Page', props: {}, children: [] } });
    next.nav = [
      { pageId: 'dash', label: 'Dashboard' },
      { pageId: 'home', label: 'Start', icon: 'home' },
    ];
    next.theme = { preset: 'ocean', radius: 'lg' };
    expect(sentences(baseSpec(), next)).toEqual([
      'Renames the page "Home" to "Start".',
      'Changes the layout of "Start" (1 part).',
      'Adds the page Dashboard.',
      'Adds a list of Crews to Start.',
      'Adds "Dashboard" to the menu.',
      'Renames the menu item "Home" to "Start".',
      'Changes the background to Ocean.',
      'Changes the corners to Large.',
    ]);
  });

  it('says a page opens from a list instead of showing its address', () => {
    const next = clone();
    next.pages.push({ id: 'crew', title: 'Crew', route: '/crews/:id', sources: [], layout: { id: 'root_crew', type: 'Page', props: {}, children: [] } });
    expect(sentences(baseSpec(), next)).toEqual(['Adds the page Crew (opens from a list).']);
    next.pages[1].route = '/crew/:id';
    next.pages[1].sources = [{ id: 'one', table: 'crews', mode: 'record', where: [], orderBy: [], limit: 1 }];
    const moved = structuredClone(next);
    moved.pages[1].route = '/team/:id';
    expect(sentences(next, moved)).toEqual(['Changes the web address of the page "Crew".']);
  });

  it('names sources by their table, the corners and the look in plain words', () => {
    const a = clone();
    a.pages[0].sources = [{ id: 'one', table: 'crews', mode: 'record', where: [], orderBy: [], limit: 1 }];
    const b = clone();
    expect(sentences(a, b)).toEqual(['Removes one record of Crews from Home.']);
    const radii = (radius: 'none' | 'sm' | 'md' | 'lg'): string[] => {
      const next = clone();
      next.theme = { ...next.theme, radius };
      return sentences(baseSpec(), next);
    };
    expect(radii('none')).toEqual(['Changes the corners to Square.']);
    expect(radii('sm')).toEqual(['Changes the corners to Small.']);
    expect(radii('lg')).toEqual(['Changes the corners to Large.']);
    const forest = clone();
    forest.theme = { preset: 'forest', radius: 'md', id: 'forest' };
    expect(sentences(baseSpec(), forest)).toEqual(['Changes the look to Forest.']);
  });

  it('describes removed pages, removed menu items and app changes', () => {
    const next = clone();
    next.pages = [{ ...next.pages[0], id: 'other', title: 'Other', route: '/other' }];
    next.nav = [];
    next.app.version = '1.1.0';
    next.app.icon = 'star';
    const s = sentences(baseSpec(), next);
    expect(s[0]).toBe('Changes the app icon to Star.');
    expect(s).toContain('Changes the version from 1.0.0 to 1.1.0.');
    expect(s).toContain('Removes the page "Home".');
    expect(s).toContain('Removes "Home" from the menu.');
  });

  it('summarizes counts', () => {
    const next = clone();
    next.tables.push({ id: 'a', label: 'A', fields: [{ id: 'x', label: 'X', type: 'text', required: false }] });
    next.tables.push({ id: 'b', label: 'B', fields: [{ id: 'x', label: 'X', type: 'text', required: false }] });
    next.pages[0].title = 'Start';
    expect(summarizeChanges(diffSpecs(baseSpec(), next))).toBe('2 tables added, 1 page changed');
  });

  it('keeps the order: tables, fields, pages', () => {
    const next = clone();
    next.tables[0].label = 'Teams';
    next.tables[0].fields.pop();
    next.pages[0].title = 'Start';
    expect(diffSpecs(baseSpec(), next).map((c) => c.area)).toEqual(['table', 'field', 'page']);
  });
});
