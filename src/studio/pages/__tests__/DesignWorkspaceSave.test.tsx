// The save on move rule with the real Design step: a move the shell cannot intercept (the kit command palette calls navigate())
// still saves a Design draft, and Discard in the "cannot be saved yet" question really throws the Design changes away.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import { APP_ID } from '../../__tests__/harness';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { featuresApi } from '../../services/studioApi';
import AppWorkspace from '../AppWorkspace';

vi.mock('../DescribeTab', () => ({ default: () => <p>Describe tab</p> }));
vi.mock('../PreviewTab', () => ({ default: () => <p>Preview tab</p> }));
vi.mock('../DataTab', () => ({ default: () => <p>Data tab</p> }));
vi.mock('../BuildTab', () => ({ default: () => <p>Build tab</p> }));
vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));
vi.mock('@local-app-studio/runtime/runtime/dataClient.js', () => ({
  createHttpDataSource: () => ({
    list: async () => ({ rows: [], total: 0 }),
    stats: async () => ({ table: 'crews', count: 0, fields: {} }),
    get: async () => null,
    create: async () => ({}),
    update: async () => ({}),
    remove: async () => undefined,
  }),
}));

const server = vi.hoisted(() => ({ fail: false, specs: [] as unknown[] }));

function mockServer(): void {
  server.fail = false;
  server.specs = [];
  let revision = 3;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url === `/api/studio/apps/${APP_ID}`) return json(200, { data: recordOf(baseSpec(), { revision }) });
      if (method === 'PUT') {
        const body = JSON.parse(init?.body as string) as { spec: AppSpec; baseRevision: number };
        if (server.fail) return json(500, { error: 'server_error', message: 'The server said no.' });
        server.specs.push(body.spec);
        revision = body.baseRevision + 1;
        return json(200, { data: recordOf(body.spec, { revision }) });
      }
      return json(404, { error: 'not_found' });
    }),
  );
}

function Palette({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      Palette
    </button>
  );
}

const renderDesign = (palette = '/features') =>
  render(
    <MemoryRouter initialEntries={[`/apps/${APP_ID}/design`]}>
      <Palette to={palette} />
      <Routes>
        <Route path="/features" element={<p>Features page</p>} />
        <Route path="/apps/:appId/*" element={<AppWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );

const detached = () => document.querySelector('[data-testid="detached-announcer"]')?.textContent ?? '';
const putCalls = (): unknown[][] => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT');
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

/** Deletes the heading, so the page has a change to save. */
async function deleteHeading(): Promise<void> {
  const find = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-canvas-block][data-layer-id="heading_1"]');
  await waitFor(() => expect(find()).not.toBeNull(), { timeout: 15_000 });
  const block = find() as HTMLElement;
  fireEvent.click(block);
  fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

configure({ asyncUtilTimeout: 4000 });

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.querySelectorAll('[data-testid="detached-announcer"]').forEach((n) => n.remove());
  vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  }
  mockServer();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AppWorkspace saves with the real Design step', () => {
  it('saves a Design draft that a navigate() call closes, and says so', async () => {
    renderDesign(`/apps/${APP_ID}/data`);
    await deleteHeading();
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    expect(await screen.findByText('Data tab')).toBeTruthy();
    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(server.specs).toHaveLength(1);
    expect((server.specs[0] as AppSpec).pages[0].layout.children).toEqual([]);
    await waitFor(() => expect(detached()).toBe('Saved your changes on Design.'));
  });

  it('says the changes were not saved when a navigate() call closes a Design step that cannot save', async () => {
    server.fail = true;
    renderDesign(`/apps/${APP_ID}/data`);
    await deleteHeading();
    fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
    expect(await screen.findByText('Data tab')).toBeTruthy();
    await waitFor(() => expect(detached()).toBe('Your changes on Design were not saved.'));
  });

  it('Discard in the cannot-be-saved question moves on and sends nothing to the server (the reset of the draft is tested in DesignTab.test.tsx)', async () => {
    server.fail = true;
    renderDesign();
    await deleteHeading();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('link', { name: /Data/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Your changes on Design cannot be saved yet' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Data tab')).toBeTruthy();
    expect(putCalls().length).toBeGreaterThan(0);
    expect(server.specs).toHaveLength(0);
    // Discard reset the draft, so leaving the step queues no later save of it.
    const sent = putCalls().length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(putCalls()).toHaveLength(sent);
    expect(detached()).toBe('');
  });
});
