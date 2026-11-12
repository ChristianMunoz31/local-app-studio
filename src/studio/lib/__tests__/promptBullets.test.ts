import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { PART_NAMES } from '@/catalog/definitions';
import type { PartNeed } from '../../design/indicator';
import { diffSpecs } from '../specDiff';
import { CHANGES_SHOWN, changeBullets, pageBullet, promptBullets, shortQuote } from '../promptBullets';
import type { PromptBullets } from '../promptBullets';
import { crewRosterSpec, loansSpec, tasksSpec } from './promptBulletsFixtures';

const view = (spec: AppSpec, before: AppSpec | null = null, needs: PartNeed[] = []): PromptBullets =>
  promptBullets({ spec, before, changes: before === null ? [] : diffSpecs(before, spec), needs });
const texts = (b: PromptBullets): string[] => b.pages.map((p) => p.text);

// Every part type name written as one CamelCase word is a code word (a plain one like Chart is also the part's own name).
const PART_CODE_NAMES = [...PART_NAMES].filter((n) => /[a-z][A-Z]/.test(n));
const GLOSSARY = new RegExp(`\\b(spec|source|layer|fragment|binding|revision|migration|id|featureId|AppSpec|schema|JSON|route|prop|bind|${PART_CODE_NAMES.join('|')})s?\\b`, 'i');

describe('promptBullets on the seeds', () => {
  it('Crew Roster, the idle view', () => {
    const b = view(crewRosterSpec());
    // No page shows People (a lookup the Crews list links to), so the lead keeps only Crews on the page and says so.
    expect(b.lead).toBe('Crew Roster keeps Crews on 1 page. No page shows People yet.');
    expect(b.tables.map((t) => t.text)).toEqual(['People: Name', 'Crews: Name, Size, Lead, Status']);
    expect(b.tables[1].detail).toBe('Crews: Name (text), Size (whole number), Lead (link to People), Status (choice)');
    expect(texts(b)).toEqual(['Home shows a Crews list.']);
    expect(b.look).toBeNull();
    expect(b.menu).toBeNull();
    expect(b.changes).toEqual([]);
  });

  it('Tasks, a create proposal', () => {
    const b = view(tasksSpec());
    expect(b.lead).toBe('Team tasks keeps Projects and Tasks on 2 pages.');
    expect(b.tables.map((t) => t.text)).toEqual(['Projects: Name, Status', 'Tasks: Name, Project, Done, Due']);
    expect(texts(b)).toEqual(['Open tasks shows a Tasks list.', 'Projects shows a Projects list.']);
  });

  it('Loans, a create proposal', () => {
    const b = view(loansSpec());
    expect(b.lead).toBe('Tool loans keeps Items, People and Loans on 4 pages.');
    expect(b.tables.map((t) => t.text)).toEqual([
      'Items: Name, Serial number, Condition',
      'People: Name, Phone',
      'Loans: Name, Item, Person, Date out, Due date, Returned',
    ]);
    expect(texts(b)).toEqual([
      'Open loans shows a Loans list.',
      'Items shows an Items list.',
      'People shows a People list.',
      'Loan has words only. It opens from a list.',
    ]);
  });

  it('the glossary covers every part type name', () => {
    expect(PART_CODE_NAMES).toEqual(expect.arrayContaining(['DataTable', 'RecordList', 'RecordDetail', 'StatCard', 'RecordForm', 'FilterBar', 'SearchBox', 'QuickAdd']));
    for (const name of PART_CODE_NAMES) expect(GLOSSARY.test(name)).toBe(true);
  });

  it('pins the counts and never produces a code word', () => {
    const counts = [crewRosterSpec(), tasksSpec(), loansSpec()].map((s) => {
      const b = view(s);
      for (const line of [b.lead, ...b.tables.flatMap((t) => [t.text, t.detail ?? '']), ...texts(b)]) expect(line).not.toMatch(GLOSSARY);
      return [b.tables.length, b.pages.length];
    });
    expect(counts).toEqual([
      [2, 1],
      [2, 2],
      [3, 4],
    ]);
  });
});

describe('promptBullets grammar', () => {
  it('names a table once per bullet, and uses an before a vowel', () => {
    const spec = crewRosterSpec();
    const form: LayoutLayer = { id: 'f1', type: 'RecordForm', props: { table: 'crews' }, children: [] };
    spec.pages[0].layout.children = [...(spec.pages[0].layout.children as LayoutLayer[]), form];
    expect(pageBullet(spec, 'home')).toBe('Home shows a Crews list and a form.');
    expect(pageBullet(loansSpec(), 'things')).toBe('Items shows an Items list.');
  });

  it('uses a before a label that starts with a vowel letter but a consonant sound (Units)', () => {
    const spec = crewRosterSpec();
    for (const t of spec.tables) if (t.id === 'crews') t.label = 'Units';
    const form: LayoutLayer = { id: 'f1', type: 'RecordForm', props: { table: 'crews' }, children: [] };
    spec.pages[0].layout.children = [...(spec.pages[0].layout.children as LayoutLayer[]), form];
    expect(pageBullet(spec, 'home')).toBe('Home shows a Units list and a form.');
  });

  it('names the table once when a Chart does not print it, then a list does', () => {
    const spec = crewRosterSpec();
    const chart: LayoutLayer = { id: 'ch', type: 'Chart', props: { table: 'crews' }, children: [] };
    const list = (spec.pages[0].layout.children as LayoutLayer[]).slice();
    spec.pages[0].layout.children = [chart, ...list];
    expect(pageBullet(spec, 'home')).toBe('Home shows a Chart and a Crews list.');
  });

  it('says a page that is not in the menu, and counts parts past four', () => {
    const spec = crewRosterSpec();
    spec.nav = [];
    expect(pageBullet(spec, 'home')).toBe('Home shows a Crews list. It is not in the menu.');
    const kids: LayoutLayer[] = [
      { id: 'a', type: 'DataTable', props: { table: 'crews' }, children: [] },
      { id: 'b', type: 'RecordForm', props: { table: 'crews' }, children: [] },
      { id: 'c', type: 'FilterBar', props: { table: 'crews' }, children: [] },
      { id: 'd', type: 'SearchBox', props: { table: 'crews' }, children: [] },
      { id: 'e', type: 'StatCard', props: { table: 'crews' }, children: [] },
      { id: 'f', type: 'StatCard', props: { label: 'Total' }, children: [] },
    ];
    spec.pages[0].layout.children = kids;
    expect(pageBullet(spec, 'home')).toBe('Home shows a Crews list, a form, filters, a search box and 2 more. It is not in the menu.');
    expect(pageBullet(spec, 'nope')).toBeNull();
  });

  it('puts a need bullet right after its page', () => {
    const need: PartNeed = { pageId: 'home', pageTitle: 'Home', layerId: 'c1', part: 'Checklist', text: 'needs a yes or no field' };
    expect(texts(view(crewRosterSpec(), null, [need]))).toEqual(['Home shows a Crews list.', 'Home: a Checklist that needs a yes or no field']);
  });

  it('says the lead with no tables, and a number of tables past three', () => {
    const none = crewRosterSpec();
    none.tables = [];
    expect(view(none).lead).toBe('Crew Roster has 1 page and no tables yet.');
    const many = crewRosterSpec();
    many.tables = [...many.tables, { ...many.tables[0], id: 'a', label: 'A' }, { ...many.tables[0], id: 'b', label: 'B' }];
    expect(view(many).lead).toBe('Crew Roster keeps Crews on 1 page. No page shows People, A and B yet.');
  });

  it('L-V-1: the lead counts every table and a source no layer reads is not a list', () => {
    const spec = crewRosterSpec();
    const extra = ['a', 'b', 'c'].map((id) => ({ ...spec.tables[0], id, label: id.toUpperCase() }));
    spec.tables = [...spec.tables, ...extra];
    const kids: LayoutLayer[] = ['crews', 'people', 'a', 'b'].map((t) => ({ id: `t_${t}`, type: 'DataTable', props: { table: t }, children: [] }));
    spec.pages[0].layout.children = kids;
    expect(view(spec).lead).toBe('Crew Roster keeps People, Crews and 2 more on 1 page. No page shows C yet.');
    kids.push({ id: 't_c', type: 'DataTable', props: { table: 'c' }, children: [] });
    expect(view(spec).lead).toBe('Crew Roster keeps 5 tables on 1 page.');
    const before = crewRosterSpec();
    const after = crewRosterSpec();
    const src = { id: 'unused', table: 'people', mode: 'list' as const, where: [], orderBy: [], limit: 50 };
    after.pages[0].sources.push(src);
    expect(view(after, before).changes).toEqual([]);
    (after.pages[0].layout.children as LayoutLayer[]).push({ id: 'u', type: 'DataTable', props: { source: 'unused' }, children: [] });
    expect(view(after, before).changes).toContain('Added a list of People to Home');
  });

  it('B-3: a page that shows none of the tables is not their home', () => {
    const bare = crewRosterSpec();
    bare.pages = bare.pages.map((p) => ({ ...p, sources: [], layout: { ...p.layout, children: [] } }));
    expect(view(bare).lead).toBe('Crew Roster has 1 page and 2 tables. No page shows People and Crews yet.');
  });

  it('caps fields at six', () => {
    const spec = crewRosterSpec();
    spec.tables[0].fields = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, type: 'text' as const, required: false }));
    expect(view(spec).tables[0].text).toBe('People: F0, F1, F2, F3, F4, F5 and 3 more');
  });

  it('says the look and the menu only when set, and for an edit only when changed', () => {
    const spec = crewRosterSpec();
    spec.theme = { preset: 'forest', radius: 'md', id: 'forest' };
    spec.menu = { position: 'side', style: 'labels', start: [], end: [] } as unknown as AppSpec['menu'];
    const created = view(spec);
    expect(created.look).toBe('Look: Forest');
    expect(created.menu).toBe('Menu bar: down the side, words only');
    const edited = view(spec, structuredClone(spec));
    expect(edited.look).toBeNull();
    expect(edited.menu).toBeNull();
  });
});

describe('promptBullets changes', () => {
  it('says a new field as a sentence', () => {
    const before = crewRosterSpec();
    const after = crewRosterSpec();
    after.tables[0].fields.push({ id: 'notes', label: 'Notes', type: 'longtext', required: false });
    expect(view(after, before).changes).toEqual(['Added a Notes field to People']);
  });

  it('says a new table, turns the rest to the past and counts the unshown', () => {
    const before = crewRosterSpec();
    const after = crewRosterSpec();
    after.tables.push({ id: 'gear', label: 'Gear', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] });
    after.app.name = 'Renamed';
    after.tables[1].label = 'Teams';
    const b = view(after, before);
    expect(b.changes).toContain('Added the table Gear');
    expect(b.changes).toContain('Renamed the app from Crew Roster to Renamed');
    expect(b.changes).toContain('Renamed the table Crews to Teams');
    const many = crewRosterSpec();
    many.tables[0].fields = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, type: 'text' as const, required: false }));
    const big = view(many, before);
    expect(big.changes).toHaveLength(CHANGES_SHOWN);
    expect(big.moreChanges).toBe(diffSpecs(before, many).length - CHANGES_SHOWN);
  });
});

describe('shortQuote and changeBullets (P17-19, P17-02)', () => {
  it('keeps words that fit whole and trims them', () => {
    expect(shortQuote('  Add a page  ', 300)).toBe('Add a page');
    expect(shortQuote('x'.repeat(300), 300)).toBe('x'.repeat(300));
  });

  it('cuts at a word with "...", never in the middle of a word, and never leaves a dangling comma', () => {
    const founder =
      'A membership app for my climbing gym. Members, plans, payments with an amount and a date, a page per member, one number with the total paid, and a chart of payments by month, a';
    const quote = shortQuote(`${founder} and more words after it`, founder.length - 1);
    expect(quote.endsWith('...')).toBe(true);
    expect(quote).toBe('A membership app for my climbing gym. Members, plans, payments with an amount and a date, a page per member, one number with the total paid, and a chart of payments by month...');
    const freelancer = 'Add a Clients table (name, phone, address) and a Jobs table';
    // The freelancer's quote was cut to "addres": now it backs up to a whole word.
    expect(shortQuote(freelancer, 38)).toBe('Add a Clients table (name, phone...');
    expect(shortQuote(freelancer, 41)).toBe('Add a Clients table (name, phone...');
    expect(shortQuote(freelancer, 42)).toBe('Add a Clients table (name, phone, address)...');
  });

  it('words the first changes and counts the rest', () => {
    const before = crewRosterSpec();
    const after = crewRosterSpec();
    after.tables[0].fields.push({ id: 'email', label: 'Email', type: 'text', required: false });
    expect(changeBullets(after, diffSpecs(before, after))).toEqual({ shown: ['Added an Email field to People'], more: 0 });
    const many = crewRosterSpec();
    many.tables[0].fields = Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, label: `F${i}`, type: 'text' as const, required: false }));
    const all = diffSpecs(before, many);
    const part = changeBullets(many, all);
    expect(part.shown).toHaveLength(CHANGES_SHOWN);
    expect(part.more).toBe(all.length - CHANGES_SHOWN);
  });
});
