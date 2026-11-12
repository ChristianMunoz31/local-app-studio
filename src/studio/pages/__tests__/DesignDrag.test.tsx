import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { SEED_FEATURES, expandFeature } from '@/catalog/features';
import { partContextFor } from '@/catalog/validateLayout';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import type { WorkspaceValue } from '../../types';
import { featuresApi } from '../../services/studioApi';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import DesignTab from '../DesignTab';

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

const layer = (id: string, type: string, props: LayoutLayer['props'] = {}, children: LayoutLayer['children'] = []): LayoutLayer => ({ id, type, props, children });

const spec = (): AppSpec => ({
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [
    {
      id: 'crews',
      label: 'Crews',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'size', label: 'Size', type: 'integer', required: false },
      ],
    },
  ],
  pages: [
    {
      id: 'home',
      title: 'Home',
      route: '/',
      sources: [{ id: 'all_crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 }],
      layout: layer('root_home', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Alpha heading'), layer('h2', 'Heading', { size: 'md' }, 'Beta heading')]),
    },
  ],
  nav: [{ pageId: 'home', label: 'Home' }],
  theme: { preset: 'aurora', radius: 'md' },
});

const saves: AppSpec[] = [];

function Workspace({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState(spec);
  const record = (revision: number, s: AppSpec) => ({ id: 'app-1', name: 'Crew Roster', slug: 'crew-roster', revision, spec: s, issues: [], createdAt: '', updatedAt: '' });
  const value: WorkspaceValue = {
    record: record(1, current),
    spec: current,
    revision: 1,
    save: async (next) => {
      saves.push(next);
      setCurrent(next);
      return { ok: true, record: record(2, next) };
    },
    reload: async () => {},
    setDirty: () => {},
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

const order = (): string[] => [...document.querySelectorAll<HTMLElement>('[data-canvas-block]')].map((el) => el.dataset.layerId ?? '');
const rect = (top: number): DOMRect => ({ x: 0, y: top, left: 0, top, width: 300, height: 24, right: 300, bottom: top + 24, toJSON: () => ({}) }) as DOMRect;

/** jsdom measures nothing: the zone the test wants gets a box at y=100, every other zone is far away. */
function aimAt(zone: string): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const key = (this as HTMLElement).dataset?.zone;
    if (key === undefined) return rect(0);
    return rect(key === zone ? 100 : 5000);
  });
}

const pointer = (target: Element | Document, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number): void => {
  fireEvent[type](target, { isPrimary: true, button: 0, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y });
};

async function dragTo(source: Element, x: number, y: number): Promise<void> {
  await act(async () => pointer(source, 'pointerDown', 5, 5));
  await act(async () => pointer(document, 'pointerMove', 20, 40));
  await act(async () => pointer(document, 'pointerMove', x, y));
  await act(async () => pointer(document, 'pointerUp', x, y));
}

beforeEach(() => {
  saves.length = 0;
  vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    <MemoryRouter>
      <Workspace>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );

const tileWrapper = (key: string): HTMLElement => document.querySelector(`[data-entry-key="${key}"]`) as HTMLElement;

describe('Design drag and drop', () => {
  it('drops a tile from the shelf on a place of the page, and shows the places while dragging', async () => {
    mount();
    await screen.findByText('Alpha heading');
    aimAt('root_home:1');
    await act(async () => pointer(tileWrapper('part:Divider'), 'pointerDown', 5, 5));
    await act(async () => pointer(document, 'pointerMove', 20, 40));
    expect(document.querySelectorAll('[data-zone]').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Drop here').length).toBeGreaterThan(0);
    await act(async () => pointer(document, 'pointerMove', 50, 110));
    await act(async () => pointer(document, 'pointerUp', 50, 110));
    await waitFor(() => expect(order()).toEqual(['root_home', 'h1', 'divider_1', 'h2']));
    expect(screen.queryByText('Drop here')).toBeNull();
  });

  it('moves a block by its handle', async () => {
    mount();
    await screen.findByText('Alpha heading');
    fireEvent.click(document.querySelector('[data-canvas-block][data-layer-id="h1"]') as HTMLElement);
    const handle = await screen.findByRole('button', { name: 'Drag to move Heading' });
    aimAt('root_home:2');
    await dragTo(handle, 50, 110);
    await waitFor(() => expect(order()).toEqual(['root_home', 'h2', 'h1']));
  });

  it('offers no place that changes nothing, and Escape cancels the drag', async () => {
    mount();
    await screen.findByText('Alpha heading');
    fireEvent.click(document.querySelector('[data-canvas-block][data-layer-id="h1"]') as HTMLElement);
    const handle = await screen.findByRole('button', { name: 'Drag to move Heading' });
    aimAt('nowhere');
    await act(async () => pointer(handle, 'pointerDown', 5, 5));
    await act(async () => pointer(document, 'pointerMove', 20, 40));
    expect(document.querySelector('[data-zone="root_home:0"]')).toBeNull();
    expect(document.querySelector('[data-zone="root_home:1"]')).toBeNull();
    expect(document.querySelector('[data-zone="root_home:2"]')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });
    await act(async () => pointer(document, 'pointerUp', 20, 40));
    expect(order()).toEqual(['root_home', 'h1', 'h2']);
    expect(screen.queryByText('Drop here')).toBeNull();
  });

  it('drops a feature with values picked from the page, and opens its settings', async () => {
    mount();
    await screen.findByText('Alpha heading');
    await screen.findByRole('button', { name: 'Add Number row' });
    aimAt('root_home:2');
    await dragTo(tileWrapper('feature:kpi_row'), 50, 110);
    await waitFor(() => expect(order()[3]).toBe('kpi_row_1'));
    expect(await screen.findByRole('dialog', { name: 'Settings for Number row' })).toBeTruthy();
  });

  it('saves the same expanded block the feature library makes for the same values', async () => {
    mount();
    await screen.findByText('Alpha heading');
    await screen.findByRole('button', { name: 'Add Number row' });
    aimAt('root_home:2');
    await dragTo(tileWrapper('feature:kpi_row'), 50, 110);
    await waitFor(() => expect(order()[3]).toBe('kpi_row_1'));
    const popover = await screen.findByRole('dialog', { name: 'Settings for Number row' });
    fireEvent.click(within(popover).getByRole('button', { name: 'Cancel' }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(saves).toHaveLength(1));
    const def = SEED_FEATURES.find((d) => d.id === 'kpi_row')!;
    const current = spec();
    // A text setting starts at the words its part holds in the feature (the title the builder canvas showed), not at the setting's label.
    const heldWords = (name: string): string | null => {
      const bound = def.bindings.find((b) => b.param === name);
      const part = bound === undefined ? undefined : (def.fragment.id === bound.layer ? def.fragment : (def.fragment.children as LayoutLayer[]).find((c) => c.id === bound.layer));
      const words = part === undefined || bound === undefined ? undefined : part.props[bound.target.replace(/^props\./, '')];
      return typeof words === 'string' ? words : null;
    };
    const values = Object.fromEntries(def.params.map((p) => [p.name, p.type === 'source' ? 'all_crews' : p.type === 'field' ? 'size' : (heldWords(p.name) ?? p.label)]));
    expect(values.title).toBe('Overview');
    const expected = expandFeature(def, values, partContextFor(current, current.pages[0]), new Map(SEED_FEATURES.map((d) => [d.id, d])), {
      rootId: 'kpi_row_1',
      takenIds: new Set(['root_home', 'h1', 'h2']),
    });
    expect(expected.ok).toBe(true);
    const children = saves[0].pages[0].layout.children as LayoutLayer[];
    expect(children.map((c) => c.id)).toEqual(['h1', 'h2', 'kpi_row_1']);
    expect(children[2]).toEqual(expected.ok ? expected.value : null);
    expect(saves[0].pages[0].layout.children).toEqual([...(current.pages[0].layout.children as LayoutLayer[]), children[2]]);
  });
});
