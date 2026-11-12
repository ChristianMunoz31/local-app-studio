// Import rows in Preview (DESIGN-phase28.md 4.4): a button while the preview runs, the lazy panel with the Preview limits,
// no mapping editor, paste box or backup offer.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { StepChromeContext } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import type { PreviewStatus, WorkspaceValue } from '../../types';
import PreviewTab from '../PreviewTab';

vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: false, installer: false, licensing: false, cloud: false } }));
const api = vi.hoisted(() => ({ previewStatus: vi.fn(), previewStart: vi.fn(), previewStop: vi.fn(), previewReset: vi.fn(), getApp: vi.fn() }));
vi.mock('../../services/studioApi', () => api);
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('@local-app-studio/runtime/runtime', () => ({
  SpecApp: () => {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return <div data-testid="spec-app" />;
  },
}));
const panel = vi.hoisted(() => ({ props: null as null | Record<string, unknown>, fail: false }));
vi.mock('@local-app-studio/runtime/runtime/data/ImportPanel.jsx', () => ({
  default: (props: Record<string, unknown> & { onDone?(r: object): void }) => {
    panel.props = props;
    if (panel.fail) throw new Error('chunk failed');
    return (
      <button type="button" onClick={() => props.onDone?.({ added: 1 })}>
        Finish the import
      </button>
    );
  },
}));
vi.mock('@/hooks/useOllamaSetup.js', () => ({ useOllamaSetup: () => ({ setup: null, isLoading: false }) }));
vi.mock('../../hooks/useDescribeSession', () => ({ useOptionalDescribeSession: () => null }));
const chrome = vi.hoisted(() => ({ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }));

const createForm = { id: 'f', type: 'RecordForm', props: { table: 'crews', mode: 'create' }, children: [] };
const designed = {
  app: { name: 'Crew Roster' },
  tables: [{ id: 'crews', label: 'Crews' }],
  pages: [{ id: 'home', layout: { id: 'p', type: 'Page', props: {}, children: [createForm] } }],
} as unknown as AppSpec;
const status = (over: Partial<PreviewStatus> = {}): PreviewStatus => ({ state: 'stopped', appId: null, revision: null, startedAt: null, message: null, data: null, ...over });

const wrap = () => {
  const value = { record: { id: 'app-1' }, spec: designed, revision: 3, save: vi.fn(), reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
  return (
    <MemoryRouter initialEntries={['/apps/app-1/preview']}>
      <StepChromeContext.Provider value={chrome}>
        <WorkspaceContext.Provider value={value}>
          <Routes>
            <Route path="/apps/:appId/preview" element={<PreviewTab />} />
          </Routes>
        </WorkspaceContext.Provider>
      </StepChromeContext.Provider>
    </MemoryRouter>
  );
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  // A designed app starts its preview by itself: the stopped case answers that call with a stopped preview.
  api.previewStart.mockResolvedValue(status());
  mounts.count = 0;
  panel.props = null;
  panel.fail = false;
});
afterEach(cleanup);

describe('PreviewTab Import rows', () => {
  it('offers no import while the preview is stopped', async () => {
    api.previewStatus.mockResolvedValue(status());
    render(wrap());
    expect(await screen.findByText('The preview is stopped.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import rows' })).toBeNull();
  });

  it('opens the panel with the Preview limits and none of the built app extras', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    fireEvent.click(await screen.findByRole('button', { name: 'Import rows' }));
    expect(await screen.findByRole('dialog', { name: 'Import rows' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Finish the import' });
    expect(panel.props).toMatchObject({ apiBase: '/api/preview', maxBytes: 1_900_000, maxRows: 5000 });
    expect(panel.props?.renderMapping).toBeUndefined();
    expect(panel.props?.renderPaste).toBeUndefined();
    expect(panel.props?.renderBackup).toBeUndefined();
    expect(panel.props?.table).toBeUndefined();
  });

  it('loads the app below again when an import finishes', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    await screen.findByTestId('spec-app');
    const before = mounts.count;
    fireEvent.click(await screen.findByRole('button', { name: 'Import rows' }));
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Finish the import' }));
    });
    await waitFor(() => expect(mounts.count).toBeGreaterThan(before));
  });

  it('cannot be closed while the import works', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    fireEvent.click(await screen.findByRole('button', { name: 'Import rows' }));
    await screen.findByRole('button', { name: 'Finish the import' });
    act(() => (panel.props?.onBusy as (b: boolean) => void)(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Import rows' })).toBeTruthy();
    act(() => (panel.props?.onBusy as (b: boolean) => void)(false));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Import rows' })).toBeNull();
  });

  it('says in a sentence when the panel cannot load, and Close leaves the dialog', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    panel.fail = true;
    fireEvent.click(await screen.findByRole('button', { name: 'Import rows' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/);
    const closers = within(screen.getByRole('dialog', { name: 'Import rows' })).getAllByRole('button', { name: 'Close' });
    fireEvent.click(closers[closers.length - 1]);
    expect(screen.queryByRole('dialog', { name: 'Import rows' })).toBeNull();
    quiet.mockRestore();
  });
});
