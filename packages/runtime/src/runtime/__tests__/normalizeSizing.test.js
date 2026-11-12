// normalizeSpec and the layer sizing block (DESIGN-phase9.md 2.3 and 3): a present block gets its defaults, nothing
// else changes, and a spec without the block normalizes exactly like the phase 8 normalizer (copied below).
import { describe, expect, it } from 'vitest';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import { SPEC_DEFAULTS, normalizeSpec } from '../normalizeSpec.js';

const MENU_FIXTURES = import.meta.glob('../../spec/__tests__/fixtures/menu/*.json', { import: 'default', eager: true });
const THEME_FIXTURES = import.meta.glob('../../spec/__tests__/fixtures/theme/*.json', { import: 'default', eager: true });

// ---- The phase 8 normalizeSpec, verbatim (without titleFieldOf). ----
const LEGACY_DEFAULTS = Object.freeze({
  sourceLimit: 50,
  theme: Object.freeze({ preset: 'aurora', radius: 'md' }),
  menu: Object.freeze({ position: 'top', style: 'icons-and-labels' }),
});
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const out = {};
    for (const key of Object.keys(value)) out[key] = clone(value[key]);
    return out;
  }
  return value;
}
function fill(obj, key, value) {
  if (obj[key] === undefined) obj[key] = value;
}
function normalizeField(field) {
  if (!isObject(field)) return;
  fill(field, 'required', false);
}
function normalizeTable(table) {
  if (!isObject(table) || !Array.isArray(table.fields)) return;
  table.fields.forEach(normalizeField);
}
function normalizeSource(source) {
  if (!isObject(source)) return;
  fill(source, 'mode', 'list');
  fill(source, 'where', []);
  fill(source, 'orderBy', []);
  if (Array.isArray(source.orderBy)) {
    for (const entry of source.orderBy) if (isObject(entry)) fill(entry, 'dir', 'asc');
  }
  fill(source, 'limit', LEGACY_DEFAULTS.sourceLimit);
}
function normalizePage(page) {
  if (!isObject(page)) return;
  fill(page, 'sources', []);
  if (Array.isArray(page.sources)) page.sources.forEach(normalizeSource);
}
function legacyNormalizeSpec(input) {
  if (input === null || input === undefined) return null;
  const spec = clone(input);
  if (!isObject(spec)) return spec;
  if (isObject(spec.app)) {
    fill(spec.app, 'description', '');
    fill(spec.app, 'icon', null);
  }
  fill(spec, 'tables', []);
  if (Array.isArray(spec.tables)) spec.tables.forEach(normalizeTable);
  if (Array.isArray(spec.pages)) spec.pages.forEach(normalizePage);
  fill(spec, 'nav', []);
  fill(spec, 'theme', { ...LEGACY_DEFAULTS.theme });
  if (isObject(spec.theme)) {
    fill(spec.theme, 'preset', LEGACY_DEFAULTS.theme.preset);
    fill(spec.theme, 'radius', LEGACY_DEFAULTS.theme.radius);
  }
  if (isObject(spec.menu)) {
    fill(spec.menu, 'position', LEGACY_DEFAULTS.menu.position);
    fill(spec.menu, 'style', LEGACY_DEFAULTS.menu.style);
  }
  return spec;
}
// ---- end of the copy ----

const plain = () => JSON.parse(JSON.stringify(crewRoster));
/** Crew Roster with `sizing` set on the table t1 of the home page. */
function withSizing(sizing) {
  const spec = plain();
  spec.pages[0].layout.children[1].sizing = sizing;
  return spec;
}
const t1 = (spec) => spec.pages[0].layout.children[1];

describe('normalizeSpec and the sizing block', () => {
  it('fills grow for a width-only block and width for a grow-only block', () => {
    expect(t1(normalizeSpec(withSizing({ width: 'half' }))).sizing).toEqual({ width: 'half', grow: false });
    expect(t1(normalizeSpec(withSizing({ grow: true }))).sizing).toEqual({ width: 'full', grow: true });
    expect(t1(normalizeSpec(withSizing({}))).sizing).toEqual({ width: 'full', grow: false });
    expect(JSON.stringify(t1(normalizeSpec(withSizing({ grow: true }))).sizing)).toBe('{"grow":true,"width":"full"}');
  });

  it('fills blocks at any depth', () => {
    const spec = plain();
    spec.pages[0].layout.children.push({
      id: 's1',
      type: 'Section',
      props: {},
      children: [{ id: 'c1', type: 'Card', props: {}, children: [{ id: 'x1', type: 'Text', sizing: { width: 'third' }, props: {}, children: 'Hi' }] }],
    });
    const out = normalizeSpec(spec);
    expect(out.pages[0].layout.children[2].children[0].children[0].sizing).toEqual({ width: 'third', grow: false });
  });

  it('is idempotent and does not change its input', () => {
    const input = withSizing({ width: 'quarter' });
    const before = JSON.stringify(input);
    const once = normalizeSpec(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(normalizeSpec(once))).toBe(JSON.stringify(once));
  });

  it('keeps a sizing that is not an object as it is (validation reports it)', () => {
    for (const bad of ['half', 3, null, true, ['half']]) expect(t1(normalizeSpec(withSizing(bad))).sizing).toEqual(bad);
  });

  it('keeps an explicit full block and changes nothing else', () => {
    const out = normalizeSpec(withSizing({ width: 'full', grow: false }));
    expect(t1(out).sizing).toEqual({ width: 'full', grow: false });
    const rest = normalizeSpec(withSizing({ width: 'half' }));
    delete t1(rest).sizing;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(normalizeSpec(plain())));
  });

  it('pins the defaults copy', () => {
    expect(SPEC_DEFAULTS.sizing).toEqual({ width: 'full', grow: false });
    expect(Object.isFrozen(SPEC_DEFAULTS.sizing)).toBe(true);
  });

  it('tolerates junk layouts and stops on a huge tree', () => {
    for (const layout of [null, 'x', 7, [], { children: 'text' }, { children: [null, 3, 'x', { sizing: {} }] }]) {
      const spec = { ...plain(), pages: [{ ...plain().pages[0], layout }] };
      expect(() => normalizeSpec(spec)).not.toThrow();
    }
    const kids = Array.from({ length: 20000 }, (_, i) => ({ id: `x${i}`, type: 'Text', sizing: {}, props: {}, children: '' }));
    const out = normalizeSpec({ ...plain(), pages: [{ ...plain().pages[0], layout: { id: 'root', type: 'Page', props: {}, children: kids } }] });
    expect(out.pages[0].layout.children[0].sizing).toEqual({ width: 'full', grow: false });
  });
});

describe('specs without sizing normalize exactly as in phase 8', () => {
  const inputs = [['crew-roster.json', plain()], ...Object.entries(MENU_FIXTURES), ...Object.entries(THEME_FIXTURES)];

  it.each(inputs)('%s', (_name, input) => {
    const out = normalizeSpec(input);
    expect(JSON.stringify(out)).toBe(JSON.stringify(legacyNormalizeSpec(input)));
    expect(JSON.stringify(out)).not.toContain('"sizing"');
  });
});
