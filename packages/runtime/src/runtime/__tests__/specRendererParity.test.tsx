// SpecRenderer with rows of side by side parts (DESIGN-phase9.md 4.1): a layout with no side by side child renders the
// same markup as the phase 8 renderer (copied below as LegacyRenderer), and sized children are grouped into rows.
import { Component } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PART_COMPONENTS } from '@/catalog/components';
import { CatalogPageProvider } from '@/catalog/context';
import type { CatalogData } from '@/catalog/context';
import { PART_DEFINITIONS } from '@/catalog/definitions';
import { ROW_CLASS, UNSIZED_TYPES, WIDTH_CLASS, itemClass } from '../../catalog/parts/sizingClasses';
import { LayerSizingSchema, validateAppSpec } from '../../spec/schema';
import type { AppSpec, LayoutLayer } from '../../spec/schema';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import { partEntries } from '@/studio/showcase/entries';
import { previewModelFor } from '@/studio/showcase/samples';
import { exampleSpec } from '@/catalog/__tests__/fixtures';
import { makeFakeData } from '@/catalog/__tests__/fakeData';
import { SpecRenderer } from '../SpecRenderer.jsx';

afterEach(cleanup);

// ---- The phase 8 SpecRenderer, verbatim. ----
const NOTE = 'text-sm text-slate-slate400';
class LegacyBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <p className={NOTE}>This part could not be shown.</p>;
    return this.props.children;
  }
}
type Parts = Record<string, ComponentType<Record<string, unknown>>>;
function LegacyRenderer({ layer, components = PART_COMPONENTS as unknown as Parts }: { layer: LayoutLayer; components?: Parts }): ReactNode {
  const Part = Object.hasOwn(components, layer.type) ? components[layer.type] : null;
  if (!Part) return <p className={NOTE}>This part is not available.</p>;
  const children =
    typeof layer.children === 'string'
      ? layer.children
      : (layer.children ?? []).map((child) => <LegacyRenderer key={child.id} layer={child} components={components} />);
  return (
    <LegacyBoundary>
      <Part {...layer.props} data-testid={layer.id} data-layer-id={layer.id}>
        {children}
      </Part>
    </LegacyBoundary>
  );
}
// ---- end of the copy ----

function validated(input: unknown): AppSpec {
  const result = validateAppSpec(input);
  if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  return result.value;
}
const CREW = validated(crewRoster);
const EXAMPLE = validated(exampleSpec());

/** React ids differ between two roots; number them by first appearance so two renders compare. */
function canonical(html: string): string {
  const seen = new Map<string, number>();
  return html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, (id) => {
    if (!seen.has(id)) seen.set(id, seen.size);
    return `ID${seen.get(id)}`;
  });
}

// Six turns of the event loop, each inside act. A turn is setImmediate, not setTimeout(0): on Windows a zero
// timeout waits for the next 15 ms clock tick, so six turns of two renders cost about 190 ms per case.
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise<void>((r) => (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate(r));
    });
  }
}

type DataFor = () => CatalogData;
const dataFor = (spec: AppSpec, pageId: string, recordId: string | null = null): DataFor => () => ({
  apiBase: '/api',
  spec,
  pageId,
  recordId,
  dataSource: makeFakeData(),
});

async function html(node: ReactNode, data: CatalogData): Promise<string> {
  const view = render(<CatalogPageProvider value={data}>{node}</CatalogPageProvider>);
  await settle();
  const out = canonical(view.container.innerHTML);
  view.unmount();
  return out;
}

async function expectSame(layer: LayoutLayer, data: DataFor, legacyLayer: LayoutLayer = layer): Promise<void> {
  const next = await html(<SpecRenderer layer={layer} />, data());
  const legacy = await html(<LegacyRenderer layer={legacyLayer} />, data());
  expect(next).toBe(legacy);
  expect(next).not.toContain(ROW_CLASS);
}

/** A deep copy with `sizing` set on every layer whose type may carry one. */
function withEverywhere(layer: LayoutLayer, sizing: unknown): LayoutLayer {
  const out = { ...layer, props: layer.props } as LayoutLayer;
  if (!UNSIZED_TYPES.has(layer.type)) (out as { sizing?: unknown }).sizing = sizing;
  if (Array.isArray(layer.children)) out.children = layer.children.map((c) => withEverywhere(c, sizing));
  return out;
}

interface Case {
  name: string;
  layer: LayoutLayer;
  data: DataFor;
}
const CASES: Case[] = [
  ...CREW.pages.map((p) => ({ name: `crew-roster ${p.id}`, layer: p.layout, data: dataFor(CREW, p.id) })),
  ...EXAMPLE.pages.map((p) => ({ name: `exampleSpec ${p.id}`, layer: p.layout, data: dataFor(EXAMPLE, p.id, p.id === 'crew' ? 'c1' : null) })),
  ...PART_DEFINITIONS.filter((d) => !UNSIZED_TYPES.has(d.name)).map((d) => ({
    name: `example ${d.name}`,
    layer: { id: 'root', type: 'Page', props: {}, children: [d.example] } as LayoutLayer,
    data: dataFor(EXAMPLE, 'crew', 'c1'),
  })),
  ...partEntries().flatMap((entry) => {
    const model = previewModelFor(entry, new Map());
    if (model === null) return [];
    return [{ name: `showcase ${entry.id}`, layer: { id: 'root', type: 'Page', props: {}, children: [model.layer] } as LayoutLayer, data: () => model.data }];
  }),
];

describe('a layout with nothing side by side renders exactly as in phase 8', () => {
  it('has the cases it claims', () => {
    expect(CASES.length).toBeGreaterThan(40);
  });

  it.each(CASES.map((c) => [c.name, c]))('%s', async (_name, c) => {
    await expectSame(c.layer, c.data);
  });

  it.each(CASES.map((c) => [c.name, c]))('%s with an explicit full block on every layer', async (_name, c) => {
    await expectSame(withEverywhere(c.layer, { width: 'full', grow: false }), c.data, c.layer);
  });
});

const text = (id: string, sizing?: unknown): LayoutLayer =>
  ({ id, type: 'Text', ...(sizing === undefined ? {} : { sizing }), props: {}, children: id }) as LayoutLayer;
const pageOf = (...children: LayoutLayer[]): LayoutLayer => ({ id: 'root', type: 'Page', props: {}, children });
const one = dataFor(CREW, 'home');

async function mount(layer: LayoutLayer): Promise<HTMLElement> {
  const view = render(
    <CatalogPageProvider value={one()}>
      <SpecRenderer layer={layer} />
    </CatalogPageProvider>,
  );
  await settle();
  return view.container;
}
const byId = (root: HTMLElement, id: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
  if (el === null) throw new Error(`no layer ${id}`);
  return el;
};

describe('raw and junk sizing', () => {
  it('a raw block and its parsed form render the same markup', async () => {
    const raw = await html(<SpecRenderer layer={pageOf(text('a'), text('b', { width: 'half' }), text('c', { width: 'half' }))} />, one());
    const parsed = LayerSizingSchema.parse({ width: 'half' });
    expect(parsed).toEqual({ width: 'half', grow: false });
    const full = await html(<SpecRenderer layer={pageOf(text('a'), text('b', parsed), text('c', parsed))} />, one());
    expect(raw).toBe(full);
    expect(raw).toContain(ROW_CLASS);
  });

  it.each([
    ['an unknown width', { width: 'huge' }],
    ['text', 'half'],
    ['null', null],
    ['an inherited width', Object.create({ width: 'half' }) as object],
  ])('junk sizing (%s) renders like phase 8', async (_name, sizing) => {
    const layer = pageOf(text('a', sizing), text('b', sizing));
    const legacy = pageOf(text('a'), text('b'));
    await expectSame(layer, one, legacy);
  });
});

describe('grouping', () => {
  it('[full, half, half, full] gives heading, one row of two halves, table', async () => {
    const container = await mount(pageOf(text('h'), text('a', { width: 'half' }), text('b', { width: 'half' }), text('t')));
    const pageEl = byId(container, 'root');
    const kids = [...pageEl.children] as HTMLElement[];
    expect(kids).toHaveLength(3);
    expect(kids[0]).toBe(byId(container, 'h'));
    expect(kids[1].tagName).toBe('DIV');
    expect(kids[1].className).toBe(ROW_CLASS);
    expect(kids[2]).toBe(byId(container, 't'));
    const items = [...kids[1].children] as HTMLElement[];
    expect(items.map((i) => i.className)).toEqual([
      'min-w-0 md:basis-[calc(50%_-_var(--spacing)*2)]',
      'min-w-0 md:basis-[calc(50%_-_var(--spacing)*2)]',
    ]);
    expect(items.map((i) => i.firstElementChild)).toEqual([byId(container, 'a'), byId(container, 'b')]);
    expect(items[0].className).toBe(itemClass({ width: 'half', grow: false }));
  });

  it('[half, full, half] gives two rows, with grow and fit classes', async () => {
    const container = await mount(pageOf(text('a', { width: 'third', grow: true }), text('m'), text('b', { width: 'fit' })));
    const kids = [...byId(container, 'root').children] as HTMLElement[];
    expect(kids.map((k) => k.className === ROW_CLASS)).toEqual([true, false, true]);
    expect((kids[0].firstElementChild as HTMLElement).className).toBe(`min-w-0 ${WIDTH_CLASS.third} md:grow`);
    expect((kids[2].firstElementChild as HTMLElement).className).toBe('min-w-0 md:basis-auto');
  });

  it('a half child under Grid, Row or PageHeader renders without a wrapper', async () => {
    const half = { width: 'half' };
    const grid: LayoutLayer = { id: 'g', type: 'Grid', props: { columns: 2 }, children: [text('g1', half), text('g2', half)] };
    const row: LayoutLayer = { id: 'r', type: 'Row', props: {}, children: [text('r1', half), text('r2', half)] };
    const header: LayoutLayer = {
      id: 'ph',
      type: 'PageHeader',
      props: { title: 'Crews' },
      children: [{ id: 'b1', type: 'Button', sizing: { width: 'half', grow: false }, props: { action: { action: 'navigate', pageId: 'home', withRecord: false } }, children: 'Go' }],
    };
    const container = await mount(pageOf(grid, row, header));
    expect(container.innerHTML).not.toContain(ROW_CLASS);
    expect(byId(container, 'g1').parentElement).toBe(byId(container, 'g'));
    expect(byId(container, 'r1').parentElement).toBe(byId(container, 'r'));
    expect(byId(container, 'ph').querySelector('[data-layer-id="b1"]')).not.toBeNull();
    const legacy = await html(<LegacyRenderer layer={pageOf(grid, row, header)} />, one());
    expect(canonical(container.innerHTML)).toBe(legacy);
  });

  it('a half child of a Tab inside Tabs renders in a row', async () => {
    const tabs: LayoutLayer = {
      id: 'tabs',
      type: 'Tabs',
      props: {},
      children: [{ id: 'tab', type: 'Tab', props: { label: 'First' }, children: [text('x', { width: 'half' }), text('y', { width: 'half' })] }],
    };
    const container = await mount(pageOf(tabs));
    const row = byId(container, 'x').parentElement?.parentElement;
    expect(row?.className).toBe(ROW_CLASS);
    expect(byId(container, 'y').parentElement?.parentElement).toBe(row);
  });

  it('Columns still counts its columns and PageHeader still sees its buttons', async () => {
    const col = (id: string): LayoutLayer => ({ id, type: 'Column', props: {}, children: [text(`${id}t`, { width: 'half' })] });
    const columns: LayoutLayer = { id: 'cols', type: 'Columns', props: { layout: 'wide-left' }, children: [col('c1'), col('c2')] };
    const header: LayoutLayer = { id: 'ph', type: 'PageHeader', props: { title: 'Crews' }, children: [] };
    const sized = await mount(pageOf(columns, header));
    const colsClass = byId(sized, 'cols').className;
    const headerHtml = byId(sized, 'ph').innerHTML;
    expect(byId(sized, 'c1t').parentElement?.parentElement?.className).toBe(ROW_CLASS);
    cleanup();
    const plainCols: LayoutLayer = { ...columns, children: [col('c1'), col('c2')].map((c) => ({ ...c, children: [text(`${c.id}t`)] })) };
    const plain = await mount(pageOf(plainCols, header));
    expect(byId(plain, 'cols').className).toBe(colsClass);
    expect(byId(plain, 'ph').innerHTML).toBe(headerHtml);
  });
});
