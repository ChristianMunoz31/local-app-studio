// NavLinks, Breadcrumb, BackLink and PageHeader (DESIGN-phase8.md 4.2): menu and pages mode, a page that needs a record is
// never linked, the breadcrumb title, landmarks and aria-current.
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider } from '../context.tsx';
import type { CatalogData } from '../context.tsx';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { crewAppSpec, makeFakeData } from './fakeData.ts';
import { layer } from './fixtures.ts';

afterEach(cleanup);

function Tree({ node }: { node: LayoutLayer }): ReactNode {
  const component = PART_COMPONENTS[node.type];
  const children = typeof node.children === 'string' ? node.children : node.children.map((c) => <Tree key={c.id} node={c} />);
  return createElement(component, { ...node.props, 'data-testid': node.id, 'data-layer-id': node.id }, children);
}

function mount(node: LayoutLayer, over: Partial<CatalogData> = {}, spec: AppSpec = crewAppSpec()) {
  const navigate = vi.fn();
  const value: CatalogData = { apiBase: '/api', spec, pageId: 'home', recordId: null, dataSource: makeFakeData(), navigate, ...over };
  render(
    <CatalogPageProvider value={value}>
      <Tree node={node} />
    </CatalogPageProvider>,
  );
  return { navigate, spec };
}

const crew = crewAppSpec();
const recordPage = crew.pages.find((p) => p.route.includes(':id'));
const listPage = crew.pages.find((p) => !p.route.includes(':id'))!;

describe('NavLinks', () => {
  it('menu mode: a Page links landmark, one button per menu page without a record, current page marked', () => {
    const { navigate } = mount(layer('n', 'NavLinks', { show: 'menu' }, []), { pageId: listPage.id });
    const nav = screen.getByRole('navigation', { name: 'Page links' });
    expect(nav).toBeTruthy();
    const names = crew.nav.filter((n) => crew.pages.find((p) => p.id === n.pageId && !p.route.includes(':id'))).map((n) => n.label);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(names);
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current.length).toBe(crew.nav.some((n) => n.pageId === listPage.id) ? 1 : 0);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(navigate).toHaveBeenCalledWith(crew.nav[0].pageId, { withRecord: false });
  });

  it('pages mode: the menu label when there is one, else the page title; a page that needs a record is skipped', () => {
    const ids = crew.pages.map((p) => p.id);
    mount(layer('n', 'NavLinks', { show: 'pages', pages: ids, icons: 'hide', direction: 'vertical' }, []));
    const shown = screen.getAllByRole('button').map((b) => b.textContent);
    const expected = crew.pages
      .filter((p) => !p.route.includes(':id'))
      .map((p) => crew.nav.find((n) => n.pageId === p.id)?.label ?? p.title);
    expect(shown).toEqual(expected);
    if (recordPage) expect(shown).not.toContain(recordPage.title);
    expect(document.querySelector('svg')).toBeNull();
  });

  it('says so when there is nothing to show', () => {
    mount(layer('n', 'NavLinks', { show: 'pages', pages: [] }, []));
    expect(screen.getByText('No pages to show yet.')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('where navigating is not available the refusal shows, nothing crashes', () => {
    mount(layer('n', 'NavLinks', {}, []), { navigate: undefined });
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByRole('status').textContent).toBe('Not available yet');
  });
});

describe('Breadcrumb', () => {
  it('without a source: the list page link, then the current page title as the current crumb', () => {
    const record = crew.pages.find((p) => p.id !== listPage.id) ?? listPage;
    const { navigate } = mount(layer('b', 'Breadcrumb', { page: listPage.id }, []), { pageId: record.id });
    const bar = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(bar.querySelector('ol')).not.toBeNull();
    if (record.id !== listPage.id) {
      fireEvent.click(screen.getByRole('button', { name: listPage.title }));
      expect(navigate).toHaveBeenCalledWith(listPage.id, { withRecord: false });
    }
    expect(bar.querySelector('[aria-current="page"]')?.textContent).toBe(record.title);
  });

  it('on the list page itself it shows one current crumb and no link', () => {
    mount(layer('b', 'Breadcrumb', { page: listPage.id }, []), { pageId: listPage.id });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelector('[aria-current="page"]')?.textContent).toBe(listPage.title);
  });

  it('with a record source it ends with the title of the record', async () => {
    const page = crew.pages.find((p) => p.sources.some((s) => s.mode === 'record'));
    if (!page) return;
    const source = page.sources.find((s) => s.mode === 'record')!;
    mount(layer('b', 'Breadcrumb', { page: listPage.id, source: source.id }, []), { pageId: page.id, recordId: 'c1' });
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Alpha').getAttribute('aria-current')).toBe('page');
  });
});

describe('BackLink', () => {
  it('shows an arrow and the text, and goes to its page without a record', () => {
    const { navigate } = mount(layer('l', 'BackLink', { action: { action: 'navigate', pageId: listPage.id, withRecord: false } }, 'Back to crews'));
    const button = screen.getByRole('button', { name: 'Back to crews' });
    expect(button.querySelector('svg')).not.toBeNull();
    fireEvent.click(button);
    expect(navigate).toHaveBeenCalledWith(listPage.id, { withRecord: false });
  });

  it('refuses a record link without a record', () => {
    const { navigate } = mount(layer('l', 'BackLink', { action: { action: 'navigate', pageId: listPage.id, withRecord: true } }, 'Back'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Open a record first.');
  });
});

describe('PageHeader', () => {
  it('a heading, a subtitle and its buttons on the right', () => {
    mount(
      layer('p', 'PageHeader', { title: 'Crews', subtitle: 'Everyone' }, [
        layer('b1', 'Button', {}, 'One'),
        layer('b2', 'Button', {}, 'Two'),
        layer('b3', 'Button', {}, 'Three'),
      ]),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Crews' })).toBeTruthy();
    expect(screen.getByText('Everyone')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['One', 'Two', 'Three']);
    expect(screen.getByTestId('p').className).toContain('sm:flex-row');
  });

  it('with no buttons it has no empty button area', () => {
    mount(layer('p', 'PageHeader', { title: 'Crews' }, []));
    expect(screen.getByTestId('p').children).toHaveLength(1);
  });
});
