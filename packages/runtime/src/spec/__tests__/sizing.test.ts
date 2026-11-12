// The optional layer sizing block (DESIGN-phase9.md 2.1 to 2.3 and 3): shape, defaults, the tolerant reader, the
// catalog's sizing_not_allowed check, and the byte-identical guarantee for specs without the block.
import * as z from 'zod';
import { describe, expect, expectTypeOf, it } from 'vitest';
import crewRoster from '../fixtures/crew-roster.json';
import { FeatureMarkerSchema, LAYER_ID_RE, LAYER_TYPE_RE, LIMITS, LayerSizingSchema, LayoutLayerSchema, validateAppSpec } from '../schema.ts';
import type { AppSpecInput, JsonValue, LayerSizing as SchemaLayerSizing, LayoutLayer } from '../schema.ts';
import { LAYER_WIDTHS, SHARE_WIDTHS, SIZING_DEFAULTS, isSideBySide, readSizing } from '../sizing.ts';
import type { LayerSizing } from '../sizing.ts';
import { SPEC_DEFAULTS } from '../../runtime/normalizeSpec.js';
import { checkLayout } from '../../../../../src/catalog/validateLayout.ts';
import { exampleSpec } from '../../../../../src/catalog/__tests__/fixtures.ts';

const MENU_FIXTURES = import.meta.glob('./fixtures/menu/*.json', { import: 'default', eager: true }) as Record<string, unknown>;
const THEME_FIXTURES = import.meta.glob('./fixtures/theme/*.json', { import: 'default', eager: true }) as Record<string, unknown>;

const base = (): AppSpecInput => JSON.parse(JSON.stringify(crewRoster)) as AppSpecInput;
const at = (layout: unknown): AppSpecInput => {
  const spec = base();
  (spec.pages[0] as { layout: unknown }).layout = layout;
  return spec;
};
const heading = { id: 'h1', type: 'Heading', props: { size: 'lg' }, children: 'Open crews' };
const table = (sizing?: unknown): Record<string, unknown> => ({
  id: 't1',
  type: 'DataTable',
  ...(sizing === undefined ? {} : { sizing }),
  props: { source: 'open_crews', columns: ['name', 'size', 'status'] },
  children: [],
});
const page = (...children: unknown[]): Record<string, unknown> => ({ id: 'root', type: 'Page', props: {}, children });
const childrenOf = (layer: LayoutLayer): LayoutLayer[] => (Array.isArray(layer.children) ? layer.children : []);

/** The phase 8 layer schema, copied: the same shape without `sizing`. */
interface LegacyLayer {
  id: string;
  type: string;
  name?: string;
  feature?: z.output<typeof FeatureMarkerSchema>;
  props: Record<string, JsonValue>;
  children: LegacyLayer[] | string;
}
const LegacyLayerSchema: z.ZodType<LegacyLayer> = z.lazy(() =>
  z.strictObject({
    id: z.string().regex(LAYER_ID_RE),
    type: z.string().regex(LAYER_TYPE_RE),
    name: z.string().max(LIMITS.labelChars).optional(),
    feature: FeatureMarkerSchema.optional(),
    props: z.record(z.string(), z.json()),
    children: z.union([z.array(LegacyLayerSchema), z.string().max(LIMITS.layerTextChars)]),
  }),
);

describe('the sizing block shape', () => {
  it.each(LAYER_WIDTHS.map((w) => [w]))('accepts width %s and fills grow', (width) => {
    expect(LayerSizingSchema.parse({ width })).toEqual({ width, grow: false });
    const result = validateAppSpec(at(page(heading, table({ width }))));
    expect(result.ok).toBe(true);
    if (result.ok) expect(childrenOf(result.value.pages[0].layout)[1].sizing).toEqual({ width, grow: false });
  });

  it('accepts an empty block (defaults) and full with grow', () => {
    expect(LayerSizingSchema.parse({})).toEqual({ width: 'full', grow: false });
    expect(LayerSizingSchema.parse({ width: 'full', grow: true })).toEqual({ width: 'full', grow: true });
    expect(validateAppSpec(at(page(heading, table({})))).ok).toBe(true);
  });

  const REFUSED: Array<[string, unknown]> = [
    ['an extra basis key', { width: 'half', basis: '50%' }],
    ['className', { width: 'half', className: 'w-1/2' }],
    ['style', { style: { width: '50%' } }],
    ['a JSON __proto__ key', JSON.parse('{"width":"half","__proto__":{"grow":true}}')],
    ['a percent width', { width: '50%' }],
    ['a capitalized width', { width: 'Half' }],
    ['a number width', { width: 6 }],
    ['a null width', { width: null }],
    ['grow as text', { grow: 'true' }],
    ['grow as a number', { grow: 1 }],
    ['sizing null', null],
    ['sizing as text', 'half'],
    ['sizing as an array', []],
    ['sizing as a number', 3],
  ];
  it.each(REFUSED)('refuses %s', (_name, sizing) => {
    const result = validateAppSpec(at(page(heading, table(sizing))));
    expect(result.ok).toBe(false);
    // A wrong type deep in a layer comes out of the children union as one issue on the children list (the phase 8
    // behavior for every nested layer); an unknown key keeps its full path.
    const paths = result.issues.map((i) => i.path);
    expect(paths.every((p) => p === 'pages.0.layout.children' || p.startsWith('pages.0.layout.children.1.sizing')), JSON.stringify(result.issues)).toBe(true);
    expect(validateAppSpec(at({ ...page(heading), sizing })).ok).toBe(false);
    expect(LayerSizingSchema.optional().safeParse(sizing).success).toBe(false);
  });

  it('names the sizing path for a bad block on the page root', () => {
    expect(validateAppSpec(at({ ...page(heading), sizing: { width: '50%' } })).issues.map((i) => i.path)).toEqual(['pages.0.layout.sizing.width']);
    expect(validateAppSpec(at({ ...page(heading), sizing: { width: 'half', basis: 1 } })).issues.map((i) => i.path)).toEqual(['pages.0.layout.sizing']);
  });
});

describe('sizing_not_allowed', () => {
  const issuesOf = (layout: unknown) => validateAppSpec(at(layout), { checkLayout }).issues;

  it('refuses sizing on the Page root, a Tab and a Column', () => {
    const root = { ...page(heading), sizing: { width: 'half' } };
    expect(issuesOf(root)).toEqual([
      { path: 'pages.0.layout.sizing', code: 'sizing_not_allowed', message: 'Page takes the width of the part it is in, so it cannot have sizing. Remove sizing.' },
    ]);
    const tabs = { id: 'tabs_1', type: 'Tabs', props: {}, children: [{ id: 'tab_1', type: 'Tab', sizing: { width: 'full' }, props: { label: 'First' }, children: [] }] };
    expect(issuesOf(page(tabs))).toEqual([
      {
        path: 'pages.0.layout.children.0.children.0.sizing',
        code: 'sizing_not_allowed',
        message: 'Tab takes the width of the part it is in, so it cannot have sizing. Remove sizing.',
      },
    ]);
    const columns = {
      id: 'columns_1',
      type: 'Columns',
      props: {},
      children: [
        { id: 'column_1', type: 'Column', props: {}, children: [] },
        { id: 'column_2', type: 'Column', sizing: { width: 'third', grow: true }, props: {}, children: [] },
      ],
    };
    expect(issuesOf(page(columns)).map((i) => [i.path, i.code])).toEqual([['pages.0.layout.children.0.children.1.sizing', 'sizing_not_allowed']]);
  });

  it('accepts sizing on children of Grid, Row and PageHeader (kept and ignored)', () => {
    const half = { width: 'half' };
    const grid = { id: 'grid_1', type: 'Grid', props: { columns: 2 }, children: [{ id: 'x1', type: 'Text', sizing: half, props: {}, children: 'Left' }] };
    const row = { id: 'row_1', type: 'Row', props: {}, children: [{ id: 'x2', type: 'Text', sizing: half, props: {}, children: 'Mid' }] };
    const header = {
      id: 'ph',
      type: 'PageHeader',
      props: { title: 'Crews' },
      children: [{ id: 'b1', type: 'Button', sizing: half, props: { action: { action: 'navigate', pageId: 'home', withRecord: false } }, children: 'Go' }],
    };
    expect(issuesOf(page(grid, row, header))).toEqual([]);
  });
});

describe('readSizing and isSideBySide', () => {
  it('reads a block, filling defaults', () => {
    expect(readSizing({ width: 'half' })).toEqual({ width: 'half', grow: false });
    expect(readSizing({ grow: true })).toEqual({ width: 'full', grow: true });
    expect(readSizing({ width: 'fit', grow: true })).toEqual({ width: 'fit', grow: true });
  });

  it('turns junk into the default and never reads the prototype', () => {
    for (const junk of [undefined, null, 'half', 3, true, [], ['half'], { width: 'huge' }, { width: 6, grow: 'yes' }, { grow: 1 }]) {
      expect(readSizing(junk), JSON.stringify(junk)).toEqual({ width: 'full', grow: false });
    }
    const inherited = Object.create({ width: 'half', grow: true }) as object;
    expect(readSizing(inherited)).toEqual({ width: 'full', grow: false });
    expect(readSizing(JSON.parse('{"__proto__":{"width":"half"}}'))).toEqual({ width: 'full', grow: false });
    expect(readSizing({ width: 'third' })).not.toBe(SIZING_DEFAULTS);
    expect(readSizing(null)).not.toBe(SIZING_DEFAULTS);
  });

  it('is side by side only when the width is not full', () => {
    expect(isSideBySide({ width: 'half' })).toBe(true);
    expect(isSideBySide({ width: 'fit' })).toBe(true);
    expect(isSideBySide({ width: 'full', grow: true })).toBe(false);
    expect(isSideBySide(undefined)).toBe(false);
    expect(isSideBySide({ width: 'huge' })).toBe(false);
  });

  it('lists the widths and the share widths', () => {
    expect(LAYER_WIDTHS).toEqual(['full', 'three-quarters', 'two-thirds', 'half', 'third', 'quarter', 'fit']);
    expect(SHARE_WIDTHS).toEqual(['quarter', 'third', 'half', 'two-thirds', 'three-quarters']);
    for (const w of SHARE_WIDTHS) expect(LAYER_WIDTHS).toContain(w);
  });
});

describe('defaults parity', () => {
  it('normalizeSpec, sizing.ts and the schema agree on the defaults', () => {
    expect(SPEC_DEFAULTS.sizing).toEqual(SIZING_DEFAULTS);
    expect(LayerSizingSchema.parse({})).toEqual(SIZING_DEFAULTS);
    expect(Object.isFrozen(SIZING_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(SPEC_DEFAULTS.sizing)).toBe(true);
  });

  it('the schema output type is LayerSizing, both ways', () => {
    expectTypeOf<z.output<typeof LayerSizingSchema>>().toEqualTypeOf<LayerSizing>();
    expectTypeOf<SchemaLayerSizing>().toEqualTypeOf<LayerSizing>();
    const a: LayerSizing = LayerSizingSchema.parse({});
    const b: z.output<typeof LayerSizingSchema> = a;
    expect(b).toEqual(a);
  });
});

describe('specs without sizing are stored byte for byte as before', () => {
  const inputs: Array<[string, unknown]> = [
    ['crew-roster.json', base()],
    ['exampleSpec()', exampleSpec()],
    ...Object.entries(MENU_FIXTURES),
    ...Object.entries(THEME_FIXTURES),
  ];

  it.each(inputs)('%s', (_name, input) => {
    const result = validateAppSpec(input);
    // A fixture that is meant to fail says nothing about the stored value.
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain('"sizing"');
    for (const [i, p] of result.value.pages.entries()) {
      const raw = (input as { pages: Array<{ layout: unknown }> }).pages[i].layout;
      expect(JSON.stringify(p.layout)).toBe(JSON.stringify(LegacyLayerSchema.parse(raw)));
      expect(JSON.stringify(LayoutLayerSchema.parse(raw))).toBe(JSON.stringify(LegacyLayerSchema.parse(raw)));
    }
  });

  it('checks at least the Crew Roster and the example spec', () => {
    expect(validateAppSpec(base()).ok).toBe(true);
    expect(validateAppSpec(exampleSpec()).ok).toBe(true);
  });

  it('keeps an explicit full block as written', () => {
    const result = validateAppSpec(at(page(heading, table({ width: 'full', grow: false }))));
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(childrenOf(result.value.pages[0].layout)[1].sizing)).toBe('{"width":"full","grow":false}');
  });

  it('puts sizing after name and feature and before props in the stored layer', () => {
    const result = validateAppSpec(at(page(heading, { ...table({ grow: true }), name: 'List' })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(childrenOf(result.value.pages[0].layout)[1])).toEqual(['id', 'type', 'name', 'sizing', 'props', 'children']);
  });
});
