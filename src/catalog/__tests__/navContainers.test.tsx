// NavLinks and PageHeader as containers (docs/CATALOG.md): PageHeader takes Button, Link and QuickAdd, NavLinks takes Button
// and Link after the page links, the old markup is unchanged without children, and an `actions` prop is still refused.
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeSpec } from '@local-app-studio/runtime/runtime/normalizeSpec.js';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider } from '../context.tsx';
import { checkLayer, partContextFor } from '../validateLayout.ts';
import { crewAppSpec, makeFakeData } from './fakeData.ts';
import { layer } from './fixtures.ts';

afterEach(cleanup);

const spec = crewAppSpec();
const listPage = spec.pages.find((p) => !p.route.includes(':id'))!;
const ctx = partContextFor(spec, listPage);
const go = { action: 'navigate', pageId: listPage.id, withRecord: false };
const button = (id: string, text = 'Go') => layer(id, 'Button', { action: go }, text);
const link = (id: string, text = 'Link') => layer(id, 'Link', { action: go }, text);
const quick = (id: string) => layer(id, 'QuickAdd', { table: 'crews', field: 'name', placeholder: 'New crew' });
const codes = (root: LayoutLayer) => checkLayer(root, ctx, 'layout').map((i) => i.code);

function Tree({ node }: { node: LayoutLayer }): ReactNode {
  const component = PART_COMPONENTS[node.type];
  const children = typeof node.children === 'string' ? node.children : node.children.map((c) => <Tree key={c.id} node={c} />);
  return createElement(component, { ...node.props, 'data-testid': node.id, 'data-layer-id': node.id }, children);
}
function html(node: LayoutLayer): string {
  const view = render(
    <CatalogPageProvider value={{ apiBase: '/api', spec, pageId: listPage.id, recordId: null, dataSource: makeFakeData() }}>
      <Tree node={node} />
    </CatalogPageProvider>,
  );
  const out = view.container.innerHTML;
  view.unmount();
  return out;
}

describe('PageHeader children', () => {
  const header = (kids: LayoutLayer[]) => layer('h', 'PageHeader', { title: 'Crews' }, kids);

  it('accepts Button, Link and QuickAdd, up to three', () => {
    expect(codes(header([button('a'), link('b'), quick('c')]))).toEqual([]);
    expect(codes(header([]))).toEqual([]);
  });

  it('refuses DataTable and Text, and a fourth child', () => {
    expect(codes(header([layer('t', 'DataTable', { source: 'open_crews', columns: ['name'] })]))).toEqual(['child_not_allowed']);
    expect(codes(header([layer('x', 'Text', {}, 'x')]))).toEqual(['child_not_allowed']);
    const issues = checkLayer(header([button('a'), button('b'), link('c'), quick('d')]), ctx, 'layout');
    expect(issues.map((i) => [i.code, i.message])).toEqual([['wrong_child_count', 'PageHeader holds at most 3 parts. It has 4.']]);
  });

  it('renders a Link and a QuickAdd beside the title', () => {
    render(
      <CatalogPageProvider value={{ apiBase: '/api', spec, pageId: listPage.id, recordId: null, dataSource: makeFakeData() }}>
        <Tree node={header([link('l', 'Docs'), quick('q')])} />
      </CatalogPageProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Crews' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Docs' })).toBeTruthy();
    expect(screen.getByPlaceholderText('New crew')).toBeTruthy();
  });

  it('with no children the markup has no extra group', () => {
    expect(html(header([]))).not.toContain('flex flex-wrap items-center gap-2');
  });

  it('the old `actions` prop is still refused, so no stored spec can carry it', () => {
    const issues = checkLayer(layer('h', 'PageHeader', { title: 'T', actions: [{ label: 'x' }] }), ctx, 'layout');
    expect(issues.map((i) => i.code)).toEqual(['invalid_props']);
  });

  it('normalizing a PageHeader with three Buttons changes nothing', () => {
    const input = { ...spec, pages: [{ ...listPage, layout: layer('root', 'Page', {}, [header([button('a'), button('b'), button('c')])]) }] };
    const once = normalizeSpec(input);
    expect(JSON.stringify((once as { pages: Array<{ layout: unknown }> }).pages[0].layout)).toBe(JSON.stringify(input.pages[0].layout));
    expect(normalizeSpec(once)).toEqual(once);
  });
});

describe('NavLinks children', () => {
  const nav = (kids: LayoutLayer[]) => layer('n', 'NavLinks', { show: 'menu' }, kids);

  it('accepts Button and Link, up to three, and refuses the rest', () => {
    expect(codes(nav([]))).toEqual([]);
    expect(codes(nav([button('a'), link('b'), button('c')]))).toEqual([]);
    expect(codes(nav([layer('t', 'Text', {}, 'x')]))).toEqual(['child_not_allowed']);
    expect(codes(nav([quick('q')]))).toEqual(['child_not_allowed']);
    expect(checkLayer(nav([button('a'), button('b'), button('c'), button('d')]), ctx, 'layout').map((i) => [i.code, i.message])).toEqual([
      ['wrong_child_count', 'NavLinks holds at most 3 parts. It has 4.'],
    ]);
  });

  it('renders the children as list items after the page links', () => {
    const view = render(
      <CatalogPageProvider value={{ apiBase: '/api', spec, pageId: listPage.id, recordId: null, dataSource: makeFakeData() }}>
        <Tree node={nav([button('a', 'New record'), link('b', 'Help')])} />
      </CatalogPageProvider>,
    );
    const items = [...view.container.querySelectorAll('li')].map((li) => li.textContent);
    expect(items.slice(-2)).toEqual(['New record', 'Help']);
    expect(items.length).toBe(spec.nav.length + 2);
  });

  it('with children and no pages to show, the list shows the children and no empty line', () => {
    const empty = { ...spec, nav: [] };
    const view = render(
      <CatalogPageProvider value={{ apiBase: '/api', spec: empty, pageId: listPage.id, recordId: null, dataSource: makeFakeData() }}>
        <Tree node={nav([button('a', 'New record')])} />
      </CatalogPageProvider>,
    );
    expect(view.container.textContent).toBe('New record');
    cleanup();
    const bare = render(
      <CatalogPageProvider value={{ apiBase: '/api', spec: empty, pageId: listPage.id, recordId: null, dataSource: makeFakeData() }}>
        <Tree node={nav([])} />
      </CatalogPageProvider>,
    );
    expect(bare.container.textContent).toContain('No pages to show yet.');
  });

  it('with no children the markup is the phase 9 list, one item per page and nothing else', () => {
    const out = html(nav([]));
    expect(out.match(/<li/g)?.length).toBe(spec.nav.filter((n) => spec.pages.some((p) => p.id === n.pageId && !p.route.includes(':id'))).length);
    expect(out).toContain('aria-label="Page links"');
  });
});
