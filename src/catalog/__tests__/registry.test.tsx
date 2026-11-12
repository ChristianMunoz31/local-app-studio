import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LayerRenderer from '@/vendor/ui-builder/components/ui/ui-builder/layer-renderer';
import type { ComponentLayer } from '@/vendor/ui-builder/components/ui/ui-builder/types';
import type { CatalogData } from '../context.tsx';
import { CatalogDataContext, useRecord, useSource } from '../context.tsx';
import { PART_DEFINITIONS } from '../definitions.ts';
import { buildRegistry } from '../registry.tsx';
import { SPIKE_PART_CONTEXT } from '../types.ts';

const layer = (id: string, type: string, props: ComponentLayer['props'] = {}, children: ComponentLayer['children'] = []): ComponentLayer => ({
  id,
  type,
  props,
  children,
});

const registry = buildRegistry(SPIKE_PART_CONTEXT);

afterEach(cleanup);

const renderPage = (page: ComponentLayer, data: CatalogData = { apiBase: '/api' }) =>
  render(
    <CatalogDataContext.Provider value={data}>
      <LayerRenderer page={page} componentRegistry={registry} />
    </CatalogDataContext.Provider>,
  );

describe('buildRegistry', () => {
  it('has one entry per part, with a component and a strict schema', () => {
    expect(Object.keys(registry)).toHaveLength(34);
    expect(Object.keys(registry)).toEqual(PART_DEFINITIONS.map((d) => d.name));
    for (const def of PART_DEFINITIONS) {
      const entry = registry[def.name];
      expect(entry.component, def.name).toBeTypeOf('function');
      expect(entry.from).toBe(`@/catalog/parts/${def.name}`);
    }
  });

  it('is memoized on the context content', () => {
    expect(buildRegistry({ ...SPIKE_PART_CONTEXT })).toBe(registry);
    expect(buildRegistry({ ...SPIKE_PART_CONTEXT, pageIds: ['home', 'other'] })).not.toBe(registry);
    expect(buildRegistry(SPIKE_PART_CONTEXT)).not.toBe(registry);
  });

  it('exposes no className, style or handler prop to the editor', () => {
    for (const def of PART_DEFINITIONS) {
      const shape = (registry[def.name].schema as unknown as { shape: Record<string, unknown> }).shape;
      for (const key of Object.keys(shape)) expect(key, def.name).not.toMatch(/^(className|style|on[A-Z].*)$/);
    }
  });

  it('gives text parts a string children field with their default text and container parts an open one', () => {
    expect(registry.Heading.defaultChildren).toBe('Heading');
    expect(registry.Text.defaultChildren).toBe('Text');
    expect(registry.Button.defaultChildren).toBe('Button');
    expect(registry.Link.defaultChildren).toBe('Link');
    expect(registry.Section.defaultChildren).toEqual([]);
    expect(registry.Page.defaultChildren).toEqual([]);
    const shapes = (name: string) => (registry[name].schema as unknown as { shape: Record<string, unknown> }).shape;
    expect(shapes('Heading')).toHaveProperty('children');
    expect(shapes('Section')).toHaveProperty('children');
  });

  it('keeps Page out of every add menu (childOf is empty)', () => {
    expect(registry.Page.childOf).toEqual([]);
    expect(registry.Section.childOf).toBeUndefined();
    expect(registry.Tab.childOf).toEqual(['Tabs']);
  });
});

describe('rendering the parts through LayerRenderer', () => {
  it('renders a page of every spike part with kit tokens and no className from props', () => {
    const page = layer('root', 'Page', { width: 'wide' }, [
      layer('h', 'Heading', { size: 'lg', tone: 'accent' }, 'Open crews'),
      layer('s', 'Section', { title: 'Overview', subtitle: 'The crews', icon: 'users' }, [layer('t', 'Text', { tone: 'muted', size: 'sm' }, 'Body text')]),
      layer('p', 'Section', { title: 'Plain block', variant: 'plain' }, [layer('t2', 'Text', {}, 'Inside plain')]),
      layer('b', 'Button', { variant: 'secondary', size: 'sm', icon: 'star', action: { action: 'navigate', pageId: 'home', withRecord: false } }, 'Go home'),
    ]);
    const { container } = renderPage(page);
    expect(screen.getByRole('heading', { name: 'Open crews', level: 2 }).className).toContain('text-3xl');
    expect(screen.getByRole('heading', { name: 'Open crews' }).className).toContain('text-accent-indigo');
    expect(screen.getByRole('heading', { name: 'Overview', level: 3 })).toBeTruthy();
    expect(screen.getByText('The crews')).toBeTruthy();
    expect(screen.getByText('Body text').className).toContain('text-xs');
    expect(screen.getByText('Body text').className).toContain('text-slate-slate400');
    expect(screen.getByRole('heading', { name: 'Plain block' })).toBeTruthy();
    expect(screen.getByText('Inside plain').className).toContain('text-sm');
    const button = screen.getByRole('button', { name: 'Go home' });
    expect(button.className).toContain('text-xs');
    expect(button.className).not.toContain('text-sm');
    expect(container.querySelector('[data-layer-id="root"]')?.className).toContain('max-w-6xl');
    expect(container.querySelector('.glass')).toBeTruthy();
  });

  it('uses the primary, secondary and danger kit button styles', () => {
    const page = layer('root', 'Page', {}, [
      layer('a', 'Button', { variant: 'primary', action: { action: 'navigate', pageId: 'home' } }, 'One'),
      layer('b', 'Button', { variant: 'secondary', action: { action: 'navigate', pageId: 'home' } }, 'Two'),
      layer('c', 'Button', { variant: 'danger', action: { action: 'navigate', pageId: 'home' } }, 'Three'),
    ]);
    renderPage(page);
    expect(screen.getByRole('button', { name: 'One' }).className).toContain('bg-slate-brand');
    expect(screen.getByRole('button', { name: 'Two' }).className).toContain('text-slate-slate300');
    expect(screen.getByRole('button', { name: 'Three' }).className).toContain('text-accent-red');
  });
});

describe('Button actions', () => {
  const buttonPage = (action: ComponentLayer['props']['action']) => layer('root', 'Page', {}, [layer('b', 'Button', { action }, 'Do it')]);

  it('navigate calls the provider with the page and withRecord false', () => {
    const navigate = vi.fn();
    renderPage(buttonPage({ action: 'navigate', pageId: 'home', withRecord: false }), { apiBase: '/api', navigate });
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(navigate).toHaveBeenCalledWith('home', { withRecord: false });
    expect(screen.queryByText('Not available yet')).toBeNull();
  });

  it('navigate with withRecord and no current record asks to open a record and does not navigate', () => {
    const navigate = vi.fn();
    renderPage(buttonPage({ action: 'navigate', pageId: 'home', withRecord: true }), { apiBase: '/api', navigate });
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Open a record first.');
  });

  it.each([
    ['open-form', { action: 'open-form', table: 'crews', mode: 'create' }],
    ['delete-record', { action: 'delete-record', table: 'crews' }],
  ])('%s shows "Not available yet" and runs nothing', (_name, action) => {
    const navigate = vi.fn();
    renderPage(buttonPage(action), { apiBase: '/api', navigate });
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(screen.getByRole('status').textContent).toBe('Not available yet');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigate without a provider handler is not available either', () => {
    renderPage(buttonPage({ action: 'navigate', pageId: 'home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(screen.getByRole('status').textContent).toBe('Not available yet');
  });

  it('a button without an action does nothing', () => {
    renderPage(layer('root', 'Page', {}, [layer('b', 'Button', {}, 'Idle')]));
    fireEvent.click(screen.getByRole('button', { name: 'Idle' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('data hooks without a provider or data source', () => {
  it('return nothing and no-op setters', () => {
    expect(renderHook(() => useSource('open_crews')).result.current).toMatchObject({ rows: [], total: 0, loading: false, error: null });
    expect(renderHook(() => useRecord('one_crew')).result.current).toMatchObject({ record: null, loading: false, error: null });
  });
});
