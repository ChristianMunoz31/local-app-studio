import { describe, expect, it } from 'vitest';
import { PART_DEFINITIONS } from '@/catalog/definitions';
import { SEED_FEATURES } from '@/catalog/features';
import { recordOf } from '../../components/__tests__/featureFixtures';
import { boardDef } from '../../lib/__tests__/boardFeature';
import { CATEGORY_LABELS, CATEGORY_ORDER, SHOWCASE_HIDDEN_PARTS, SUBGROUP_LABELS, buildShowcaseEntries, filterEntries, groupEntries, partEntries, partLabel } from '../entries';

const shownTypes = PART_DEFINITIONS.map((d) => d.name).filter((n) => !SHOWCASE_HIDDEN_PARTS.has(n));

describe('part entries', () => {
  it('covers every part except Page, Tab and Column exactly once', () => {
    const ids = partEntries().map((e) => e.id);
    expect([...ids].sort()).toEqual([...shownTypes].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(31);
    for (const hidden of ['Page', 'Tab', 'Column']) expect(ids).not.toContain(hidden);
    expect([...SHOWCASE_HIDDEN_PARTS].sort()).toEqual(['Column', 'Page', 'Tab']);
  });

  it('puts the parts in the category and sub-group of the design, in display order', () => {
    const by = (type: string) => partEntries().find((e) => e.id === type);
    expect(by('Grid')?.name).toBe('Auto grid');
    expect(by('Columns')).toMatchObject({ name: 'Columns', category: 'layout', subgroup: 'structure' });
    expect(by('Collapsible')?.name).toBe('Show and hide section');
    expect(by('Callout')).toMatchObject({ category: 'layout', subgroup: 'text' });
    for (const type of ['NavLinks', 'Breadcrumb', 'BackLink', 'PageHeader']) expect(by(type), type).toMatchObject({ category: 'navigation', subgroup: null });
    expect(by('NavLinks')?.name).toBe('Page links');
    expect(by('Timeline')).toMatchObject({ category: 'data', subgroup: 'show' });
    expect(by('ProgressBar')).toMatchObject({ category: 'data', subgroup: 'summarize' });
    expect(by('Chart')).toMatchObject({ category: 'data', subgroup: 'charts' });
    for (const type of ['SortControl', 'QuickAdd']) expect(by(type)?.category, type).toBe('input');
    const order = partEntries().map((e) => CATEGORY_ORDER.indexOf(e.category));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(partEntries().filter((e) => e.subgroup !== null).every((e) => e.category === 'layout' || e.category === 'data')).toBe(true);
    expect(Object.keys(SUBGROUP_LABELS)).toEqual(['structure', 'text', 'show', 'summarize', 'charts']);
  });

  it('gives each part keywords in plain words, and no created date or usage', () => {
    for (const e of partEntries()) {
      expect(e.keywords.length, e.id).toBeGreaterThan(0);
      for (const word of e.keywords) {
        expect(word, `${e.id}: ${word}`).toBe(word.trim().toLowerCase());
        expect(word, `${e.id}: ${word}`).not.toMatch(/[\u2013\u2014]/);
      }
      expect(e.createdAt).toBeNull();
      expect(e.usedInApps).toBeNull();
    }
    expect(partEntries().find((e) => e.id === 'DataTable')?.keywords).toContain('spreadsheet');
    expect(partEntries().find((e) => e.id === 'Columns')?.keywords).toContain('side by side');
  });

  it('gives each a plain name and a short plain description', () => {
    for (const e of partEntries()) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.description.length).toBeLessThanOrEqual(90);
      for (const word of `${e.name} ${e.description}`.split(/\s+/)) expect(word, `${e.id}: ${word}`).not.toMatch(/[a-z][A-Z]/);
      expect(`${e.name} ${e.description}`).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('is memoized and keyed', () => {
    expect(partEntries()).toBe(partEntries());
    expect(partEntries()[0].key).toBe(`part:${partEntries()[0].id}`);
    expect(partLabel('DataTable')).toBe('Table of records');
    expect(partLabel('Nope')).toBe('Nope');
  });
});

describe('buildShowcaseEntries', () => {
  it('adds saved features as Custom with chips and status', () => {
    const broken = recordOf(SEED_FEATURES[1], { ok: false, fragment: null });
    const entries = buildShowcaseEntries([recordOf(SEED_FEATURES[0]), broken]);
    const custom = entries.filter((e) => e.kind === 'feature');
    expect(custom).toHaveLength(2);
    expect(custom[0]).toMatchObject({ key: `feature:${SEED_FEATURES[0].id}`, category: 'custom', status: 'ok', version: SEED_FEATURES[0].version });
    expect(custom[0].params.length).toBe(SEED_FEATURES[0].params.length);
    expect(custom[0].params[0].words).toMatch(/^(Text|Table|List|Record|Page|Field|Number field)$/);
    expect(custom[1].status).toBe('needs_repair');
    expect(custom[0]).toMatchObject({ subgroup: null, keywords: [], createdAt: recordOf(SEED_FEATURES[0]).createdAt, usedInApps: recordOf(SEED_FEATURES[0]).usedBy.apps.length });
    expect(entries.slice(0, partEntries().length)).toEqual(partEntries());
  });
});

describe('filter and group', () => {
  const entries = buildShowcaseEntries([recordOf(SEED_FEATURES[0])]);
  it('filters by category', () => {
    expect(filterEntries(entries, { category: 'input', query: '' }).every((e) => e.category === 'input')).toBe(true);
    expect(filterEntries(entries, { category: 'all', query: '' })).toHaveLength(entries.length);
    expect(filterEntries(entries, { category: 'custom', query: '' })).toHaveLength(1);
  });
  it('searches name and description, ignoring case and spaces at the ends', () => {
    expect(filterEntries(entries, { category: 'all', query: '  FORM ' }).map((e) => e.id)).toContain('RecordForm');
    expect(filterEntries(entries, { category: 'all', query: 'a title for a page' }).map((e) => e.id)).toEqual(['Heading']);
    expect(filterEntries(entries, { category: 'input', query: 'zzz' })).toEqual([]);
  });
  it('groups in the fixed order and drops empty groups', () => {
    const groups = groupEntries(entries);
    expect(groups.map((g) => g.label)).toEqual(['Layout', 'Navigation', 'Records', 'Input', 'Actions', 'Your features']);
    expect(groups.map((g) => g.category)).toEqual(Object.keys(CATEGORY_LABELS));
    expect(groupEntries(filterEntries(entries, { category: 'data', query: '' })).map((g) => g.category)).toEqual(['data']);
    expect(groupEntries([])).toEqual([]);
  });

  it('folds a list setting into the table setting of its slot, so a slot is one chip in the tile and the drawer', () => {
    const entry = buildShowcaseEntries([recordOf(boardDef())]).find((e) => e.kind === 'feature');
    expect(entry?.params.map((p) => p.label)).toEqual(['Things to track', 'Status', 'Name', 'Board title']);
  });
});
