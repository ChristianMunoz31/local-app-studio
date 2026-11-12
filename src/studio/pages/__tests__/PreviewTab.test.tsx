import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { StepChromeContext } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { readLaunch } from '../../lib/steps';
import type { PreviewStatus, WorkspaceValue } from '../../types';
import PreviewTab from '../PreviewTab';
import ModalImpl from '@/components/shared/Modal';

const Modal = ModalImpl as ComponentType<{ title: string; onClose(): void; children: ReactNode }>;

// These tests are about the helper's screens, so the helper is in the build they run in (a public run has no helper: helperNotInBuild.test.tsx).
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
const api = vi.hoisted(() => ({
  previewStatus: vi.fn(),
  previewStart: vi.fn(),
  previewStop: vi.fn(),
  previewReset: vi.fn(),
  getApp: vi.fn(),
}));
vi.mock('../../services/studioApi', () => api);
const specApp = vi.hoisted(() => vi.fn());
const mounts = vi.hoisted(() => ({ count: 0, dialog: false }));
vi.mock('@local-app-studio/runtime/runtime', () => ({
  SpecApp: (props: { apiBase: string; basePath: string }) => {
    specApp(props);
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return (
      <div data-testid="spec-app">
        {props.apiBase}
        {mounts.dialog && (
          <Modal title="Add job" onClose={() => {}}>
            <p>Body</p>
          </Modal>
        )}
      </div>
    );
  },
}));

const setupState = vi.hoisted(() => ({ value: null as { ready: boolean } | null }));
vi.mock('@/hooks/useOllamaSetup.js', () => ({ useOllamaSetup: () => ({ setup: setupState.value, isLoading: false }) }));
const session = vi.hoisted(() => ({ value: null as { phase: string } | null }));
vi.mock('../../hooks/useDescribeSession', () => ({ useOptionalDescribeSession: () => session.value }));
const chrome = vi.hoisted(() => ({ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }));

const createForm = { id: 'f', type: 'RecordForm', props: { table: 'crews', mode: 'create' }, children: [] };
const designed = {
  app: { name: 'Crew Roster' },
  tables: [{ id: 'crews', label: 'Crews' }],
  pages: [{ id: 'home', layout: { id: 'p', type: 'Page', props: {}, children: [createForm] } }],
} as unknown as AppSpec;
const starter = { app: { name: 'Crew Roster' }, tables: [], pages: [{ id: 'home', sources: [], layout: { id: 'root_home', type: 'Page', props: {}, children: [] } }] } as unknown as AppSpec;
const status = (over: Partial<PreviewStatus> = {}): PreviewStatus => ({ state: 'stopped', appId: null, revision: null, startedAt: null, message: null, data: null, ...over });

const Probe = () => {
  const location = useLocation();
  return <output data-testid="where" data-path={location.pathname} data-state={JSON.stringify(location.state)} />;
};

const wrap = (revision = 3, spec: AppSpec = designed, state?: unknown, extra?: ReactNode) => {
  const value = { record: { id: 'app-1' }, spec, revision, save: vi.fn(async () => ({ ok: true, record: { revision: revision + 1 } })), reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
  return (
    <MemoryRouter initialEntries={[{ pathname: '/apps/app-1/preview', state }]}>
      <StepChromeContext.Provider value={chrome}>
        <WorkspaceContext.Provider value={value}>
          <Routes>
            <Route path="/apps/:appId/preview" element={<PreviewTab />} />
            <Route path="*" element={<p>Elsewhere</p>} />
          </Routes>
          <Probe />
          {extra}
        </WorkspaceContext.Provider>
      </StepChromeContext.Provider>
    </MemoryRouter>
  );
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.values(api).forEach((fn) => fn.mockReset());
  specApp.mockReset();
  mounts.count = 0;
  mounts.dialog = false;
  Object.values(chrome).forEach((fn) => fn.mockReset());
  setupState.value = null;
  session.value = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PreviewTab', () => {
  it('wraps the running app in a theme scope, so the look stays out of Studio itself', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    const themed = { ...designed, theme: { preset: 'forest', radius: 'md', id: 'forest' } } as unknown as AppSpec;
    render(wrap(3, themed));
    const app = await screen.findByTestId('spec-app');
    const scope = screen.getByTestId('preview-theme-scope');
    expect(scope.contains(app)).toBe(true);
    expect(scope.style.getPropertyValue('--brand')).toMatch(/^\d+ \d+ \d+$/);
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('');
  });

  it('hands a dialog the app opens the look of the Preview, and leaves a Studio dialog alone', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    const themed = { ...designed, theme: { preset: 'forest', radius: 'md', id: 'forest' } } as unknown as AppSpec;
    mounts.dialog = true;
    render(wrap(3, themed));
    await screen.findByTestId('spec-app');
    const overlay = (screen.getByRole('dialog', { name: 'Add job' }).parentElement as HTMLElement);
    expect(overlay.style.getPropertyValue('--brand')).toMatch(/^\d+ \d+ \d+$/);
    expect(overlay.style.colorScheme).toBe('dark');
    expect(overlay.style.backgroundImage).toBe('');
    expect(overlay.getAttribute('data-theme-mode')).toBe('dark');
    cleanup();
    mounts.dialog = false;
    render(
      <Modal title="Studio dialog" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    const studio = screen.getByRole('dialog', { name: 'Studio dialog' }).parentElement as HTMLElement;
    expect(studio.getAttribute('style')).toBeNull();
    expect(studio.hasAttribute('data-theme-mode')).toBe(false);
  });

  it('shows a Classic app in light, and the Show as choice switches and is kept per app', async () => {
    window.localStorage.clear();
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    const first = render(wrap());
    await screen.findByTestId('spec-app');
    expect(screen.getByTestId('preview-theme-scope').getAttribute('data-theme-mode')).toBe('light');
    const group = screen.getByRole('group', { name: 'Show as' });
    expect((within(group).getByRole('radio', { name: 'Light' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('preview-theme-scope').getAttribute('data-theme-mode')).toBe('dark');
    expect(window.localStorage.getItem('app.studio.viewMode.app-1')).toBe('dark');
    first.unmount();
    render(wrap());
    await screen.findByTestId('spec-app');
    expect(screen.getByTestId('preview-theme-scope').getAttribute('data-theme-mode')).toBe('dark');
    expect(window.localStorage.getItem('app.studio.viewMode.app-2')).toBeNull();
    window.localStorage.clear();
  });

  it('starts by itself once, mounts SpecApp against /api/preview, and Stop stays stopped', async () => {
    api.previewStatus.mockResolvedValue(status());
    api.previewStart.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    api.previewStop.mockResolvedValue(status());
    render(wrap());
    expect(await screen.findByTestId('spec-app')).toBeTruthy();
    expect(api.previewStart).toHaveBeenCalledTimes(1);
    expect(api.previewStart).toHaveBeenCalledWith('app-1');
    expect(specApp).toHaveBeenCalledWith(expect.objectContaining({ apiBase: '/api/preview', basePath: '/apps/app-1/preview' }));
    expect(screen.getByText('Your app is running.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();

    fireEvent.click(screen.getByText('Preview options'));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('The preview is stopped.')).toBeTruthy();
    expect(screen.queryByTestId('spec-app')).toBeNull();
    expect(api.previewStart).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Start preview' })).toBeTruthy();
  });

  it('mounts the app again when Reset preview data starts a new child, so it reloads its rows', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3, startedAt: '2026-11-03T10:00:00.000Z' }));
    api.previewReset.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3, startedAt: '2026-11-03T10:05:00.000Z', data: { kept: false, reason: 'reset' } }));
    render(wrap());
    const before = await screen.findByTestId('spec-app');
    fireEvent.click(screen.getByRole('button', { name: 'Reset preview data' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reset preview data' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.previewReset).toHaveBeenCalledWith('app-1');
    expect(screen.getByTestId('spec-app')).not.toBe(before);
  });

  it('offers Restart inside Preview options', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    api.previewStart.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    expect(await screen.findByTestId('spec-app')).toBeTruthy();
    expect(api.previewStart).not.toHaveBeenCalled();
    const menu = screen.getByText('Preview options').closest('details');
    expect(menu?.textContent).toContain('Restart');
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.previewStart).toHaveBeenCalledTimes(1);
  });

  it('does not start on a starter spec and points to Prompt', async () => {
    api.previewStatus.mockResolvedValue(status());
    render(wrap(3, starter));
    expect(await screen.findByText('Describe it on Prompt, or build a page in Design.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Prompt' }).getAttribute('href')).toBe('/apps/app-1/prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Build a page in Design' }));
    expect(chrome.go).toHaveBeenCalledWith('/apps/app-1/design', expect.anything());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(api.previewStart).not.toHaveBeenCalled();
  });

  it('does not start when it already runs this app, and polls only while starting', async () => {
    api.previewStatus
      .mockResolvedValueOnce(status({ state: 'starting', appId: 'app-1', revision: 3 }))
      .mockResolvedValueOnce(status({ state: 'starting', appId: 'app-1', revision: 3 }))
      .mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    expect(await screen.findByText('Starting your app...')).toBeTruthy();
    expect(api.previewStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.previewStatus).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(await screen.findByTestId('spec-app')).toBeTruthy();
    const calls = api.previewStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.previewStatus).toHaveBeenCalledTimes(calls);
    expect(api.previewStart).not.toHaveBeenCalled();
  });

  it('replaces a preview of another app', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'other', revision: 1 }));
    api.previewStart.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    expect(await screen.findByTestId('spec-app')).toBeTruthy();
    expect(api.previewStart).toHaveBeenCalledWith('app-1');
  });

  it('waits for the restart when the saved revision is newer than the running preview', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 2 }));
    render(wrap(3));
    expect(await screen.findByText('Updating the preview with your latest changes...')).toBeTruthy();
    expect(screen.queryByTestId('spec-app')).toBeNull();
    expect(api.previewStart).not.toHaveBeenCalled();
  });

  it('shows a failure message from the server with Try again', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview stopped unexpectedly. Start it again.' }));
    api.previewStart.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview stopped unexpectedly. Start it again.' }));
    render(wrap());
    expect(await screen.findByText('The preview stopped unexpectedly. Start it again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reset preview data' })).toBeTruthy();
    expect(screen.queryByText('The preview is stopped.')).toBeNull();
  });

  it('a failed start resets the preview data through the confirm', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The tables could not be applied.' }));
    // The first start is the tab's own start on arriving; the second is the one that follows the reset.
    api.previewStart
      .mockResolvedValueOnce(status({ state: 'failed', appId: 'app-1', message: 'The tables could not be applied.' }))
      .mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    api.previewReset.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The tables could not be applied.' }));
    render(wrap());
    fireEvent.click(await screen.findByRole('button', { name: 'Reset preview data' }));
    expect(api.previewReset).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Keep the records' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset preview data' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.previewReset).toHaveBeenCalledWith('app-1');
    expect(await screen.findByTestId('spec-app')).toBeTruthy();
  });

  it('a start the server refuses reads the failed status back: one failed state with Reset preview data, no alert, never stopped', async () => {
    api.previewStatus
      .mockResolvedValueOnce(status({ state: 'stopped' }))
      .mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    api.previewStart.mockRejectedValue(new Error('The preview could not start. Try again.'));
    render(wrap());
    expect(await screen.findByRole('button', { name: 'Reset preview data' })).toBeTruthy();
    expect(screen.queryByText('The preview is stopped.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(/could not start/)).toHaveLength(1);
  });

  it('keeps the error line when the refreshed status is not a failed one', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'stopped' }));
    api.previewStart.mockRejectedValue(new Error('Studio is busy.'));
    render(wrap());
    expect((await screen.findByRole('alert')).textContent).toBe('Studio is busy.');
  });

  it('Reset preview data from the failed state starts the preview again after the reset', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    api.previewReset.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    api.previewStart
      .mockResolvedValueOnce(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }))
      .mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3, startedAt: '2026-11-03T10:00:00.000Z' }));
    render(wrap());
    fireEvent.click(await screen.findByRole('button', { name: 'Reset preview data' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reset preview data' }));
    expect(await screen.findByTestId('spec-app')).toBeTruthy();
    expect(api.previewReset).toHaveBeenCalledWith('app-1');
    expect(api.previewStart).toHaveBeenCalledTimes(2);
    expect(api.previewReset.mock.invocationCallOrder[0]).toBeLessThan(api.previewStart.mock.invocationCallOrder[1]);
  });

  it('does not start the preview after a reset when the person has left the step (V2-7)', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    api.previewStart.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    let answerReset: (value: ReturnType<typeof status>) => void = () => undefined;
    api.previewReset.mockReturnValue(new Promise((resolve) => (answerReset = resolve)));
    const view = render(wrap());
    fireEvent.click(await screen.findByRole('button', { name: 'Reset preview data' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reset preview data' }));
    await waitFor(() => expect(api.previewReset).toHaveBeenCalledTimes(1));
    const starts = api.previewStart.mock.calls.length;
    view.unmount();
    await act(async () => {
      answerReset(status({ state: 'stopped', appId: null }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.previewStart).toHaveBeenCalledTimes(starts);
  });

  it('does not start the preview after a reset whose answer is for another app or is already running (V2-7)', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    api.previewStart.mockResolvedValue(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    api.previewReset.mockResolvedValue(status({ state: 'running', appId: 'app-2', revision: 1, startedAt: '2026-11-03T10:00:00.000Z' }));
    render(wrap());
    fireEvent.click(await screen.findByRole('button', { name: 'Reset preview data' }));
    const starts = api.previewStart.mock.calls.length;
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reset preview data' }));
    await waitFor(() => expect(api.previewReset).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.previewStart).toHaveBeenCalledTimes(starts);
  });

  it('Reset preview data while running does not start again', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3, startedAt: '2026-11-03T10:00:00.000Z' }));
    api.previewReset.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3, startedAt: '2026-11-03T10:05:00.000Z' }));
    render(wrap());
    fireEvent.click(await screen.findByRole('button', { name: 'Reset preview data' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reset preview data' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(api.previewReset).toHaveBeenCalled();
    expect(api.previewStart).not.toHaveBeenCalled();
  });

  it('puts the status first, then the app, then Change something, and marks Preview done for the saved design', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    const app = await screen.findByTestId('spec-app');
    const running = screen.getByText('Your app is running.');
    const change = screen.getByText('Change something');
    expect(running.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(app.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Next/ })).toBeNull();
    expect(screen.queryByText(/scratch/)).toBeNull();
    await waitFor(() => expect(chrome.markDone).toHaveBeenCalledWith('preview', 3));
  });

  it('does not mark Preview done while the running app is older than the saved design', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 2 }));
    render(wrap(3));
    await screen.findByText('Updating the preview with your latest changes...');
    expect(chrome.markDone).not.toHaveBeenCalled();
  });

  it('says which tables have no way to add records, and goes to Design to add a form when none can be added here', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    const noForm = {
      app: { name: 'Crew Roster' },
      tables: [{ id: 'crews', label: 'Crews' }],
      pages: [{ id: 'home', layout: { id: 'p', type: 'Page', props: {}, children: [] } }],
    } as unknown as AppSpec;
    render(wrap(3, noForm));
    await screen.findByTestId('spec-app');
    expect(screen.getByText('Crews has no way to add records yet. Put a Form on a page to add them here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a way to add records' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a form in Design' }));
    expect(chrome.go).toHaveBeenCalledWith('/apps/app-1/design', { state: { stepFocus: true, addEntry: 'part:RecordForm' } });
  });

  it('offers Add a way to add records when something can be added, and saves the app once on the press', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    const menuOn = { ...structuredClone(crewRoster), menu: { position: 'top', style: 'icons-and-labels' } } as unknown as AppSpec;
    render(wrap(3, menuOn));
    await screen.findByTestId('spec-app');
    expect(screen.getByText('People and Crews have no way to add records yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a form in Design' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    await screen.findByText(/^Added a menu button for People and a menu button for Crews\./);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(chrome.go).not.toHaveBeenCalled();
  });

  it('shows no such hint when a create form is on the page', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap(3, designed));
    await screen.findByTestId('spec-app');
    expect(screen.queryByText(/no way to add records/)).toBeNull();
  });

  it('offers Change the design yourself, and turns Ask for changes off with a reason when the helper is down', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    setupState.value = { ready: false };
    render(wrap());
    await screen.findByTestId('spec-app');
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'More fields' } });
    const ask = screen.getByRole('button', { name: 'Ask for changes' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    const note = screen.getByText('The helper is not set up. Change the design yourself, or set up the helper on Prompt.');
    expect(ask.getAttribute('aria-describedby')).toBe(note.id);
    fireEvent.click(screen.getByRole('button', { name: 'Change the design yourself' }));
    expect(chrome.go).toHaveBeenCalledWith('/apps/app-1/design', { state: { stepFocus: true } });
  });

  it('P-13: after a failed helper run it says so and keeps Ask for changes and Change the design yourself usable', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    session.value = { phase: 'error' };
    render(wrap());
    await screen.findByTestId('spec-app');
    expect(screen.getByText(/The helper could not answer last time/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'More fields' } });
    expect((screen.getByRole('button', { name: 'Ask for changes' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Change the design yourself' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('turns Ask for changes off while the helper works or a design waits, so nothing is thrown away (V-6)', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    session.value = { phase: 'running' };
    const first = render(wrap());
    await screen.findByTestId('spec-app');
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'More fields' } });
    let ask = screen.getByRole('button', { name: 'Ask for changes' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    expect(document.getElementById(ask.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/still working on a design/);
    first.unmount();

    session.value = { phase: 'proposal' };
    render(wrap());
    await screen.findByTestId('spec-app');
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'More fields' } });
    ask = screen.getByRole('button', { name: 'Ask for changes' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    expect(document.getElementById(ask.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/design is waiting/);
    expect(screen.queryByText('Elsewhere')).toBeNull();
  });

  it('sends Change something to Prompt in edit mode', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    await screen.findByTestId('spec-app');
    const ask = screen.getByRole('button', { name: 'Ask for changes' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: '  Add a notes field  ' } });
    fireEvent.click(ask);
    expect(await screen.findByText('Elsewhere')).toBeTruthy();
    const where = screen.getByTestId('where');
    expect(where.dataset.path).toBe('/apps/app-1/prompt');
    expect(readLaunch(JSON.parse(where.dataset.state ?? 'null'))).toEqual({ mode: 'edit', instruction: 'Add a notes field' });
  });

  it('shows what happened to the preview data, and Reset preview data posts only after the confirm', async () => {
    api.previewStatus.mockResolvedValue(
      status({ state: 'running', appId: 'app-1', revision: 3, data: { kept: false, reason: 'tables_replaced' } }),
    );
    api.previewReset.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3, data: { kept: false, reason: 'reset' } }));
    render(wrap());
    await screen.findByTestId('spec-app');
    expect(screen.getByTestId('preview-data-note').textContent).toContain('Preview data was cleared');
    fireEvent.click(screen.getByRole('button', { name: 'Reset preview data' }));
    expect(api.previewReset).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('Reset preview data')) as HTMLElement);
    await act(async () => {});
    expect(api.previewReset).toHaveBeenCalledWith('app-1');
    expect(screen.getByTestId('preview-data-note').textContent).toBe('Preview data was reset.');
  });

  it('shows the app in a frame: Show as and Enlarge are in its toolbar, not in the controls card, and the old card title is gone', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    const app = await screen.findByTestId('spec-app');
    const group = screen.getByRole('group', { name: 'Show as' });
    const enlarge = screen.getByRole('button', { name: 'Enlarge' });
    expect(screen.getAllByRole('group', { name: 'Show as' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Crew Roster' })).toBeNull();
    const toolbar = group.parentElement?.parentElement as HTMLElement;
    expect(toolbar.contains(enlarge)).toBe(true);
    expect(within(toolbar).getByText('Crew Roster')).toBeTruthy();
    const frame = toolbar.parentElement as HTMLElement;
    expect(frame.contains(app)).toBe(true);
    expect(frame.classList.contains('glass')).toBe(true);
    expect(frame.contains(screen.getByText('Your app is running.'))).toBe(false);
  });

  it('keeps the very same SpecApp node through Enlarge and Shrink', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    await screen.findByTestId('spec-app');
    const node = screen.getByTestId('preview-theme-scope').firstElementChild;
    expect(node).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge' }));
    const dialog = screen.getByRole('dialog', { name: 'Crew Roster, enlarged' });
    expect(within(dialog).getByTestId('preview-theme-scope').firstElementChild).toBe(node);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Shrink' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const after = screen.getByTestId('preview-theme-scope').firstElementChild;
    expect(after).toBe(node);
    expect(after?.closest('[role="dialog"]')).toBeNull();
    expect(specApp.mock.calls.length).toBeGreaterThan(0);
    expect(mounts.count).toBe(1);
  });
});

describe('PreviewTab made from an example', () => {
  const note = { madeFromExample: { name: 'Crew Board', tryThese: ['Add a Phone field to People', 'Move the menu to the side'] } };
  const NOTICE = 'Made Crew Board from the example. It is yours to change.';

  it('says it once in a status line with the ideas under it, outside the live region', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap(3, designed, note));
    await screen.findByTestId('spec-app');
    const live = await screen.findByText(NOTICE);
    expect(live.getAttribute('role')).toBe('status');
    expect(screen.getByText('Ideas to try: Add a Phone field to People; Move the menu to the side.').closest('[role="status"]')).toBeNull();
  });

  it('adds the sample sentence to the same live region on a first start with records, and the banner does not repeat it', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3, data: { kept: false, reason: 'first_start', seeded: 14 } }));
    render(wrap(3, designed, note));
    const live = await screen.findByText(`${NOTICE} Sample records were added so you can try the app.`);
    expect(live.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('preview-data-note')).toBeNull();
  });

  it('keeps the note when the router state is replaced later, and Dismiss removes it', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap(3, designed, note));
    await screen.findByText(NOTICE);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByText(/Ideas to try/)).toBeNull();
  });

  it('keeps the note when the router state is replaced with null afterwards', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    const Replace = () => {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/apps/app-1/preview', { replace: true, state: null })}>
          Replace state
        </button>
      );
    };
    render(wrap(3, designed, note, <Replace />));
    await screen.findByText(NOTICE);
    fireEvent.click(screen.getByRole('button', { name: 'Replace state' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('where').getAttribute('data-state') ?? 'null')).toBeNull());
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('moves focus off the removed Dismiss row, so it is not left on the page body', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap(3, designed, note));
    await screen.findByText(NOTICE);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBeNull();
  });

  it('announces the note in its status region while the step heading takes focus (stepFocus)', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    const Heading = () => {
      const ref = useRef<HTMLHeadingElement>(null);
      useEffect(() => ref.current?.focus(), []);
      return (
        <h3 ref={ref} tabIndex={-1}>
          Preview
        </h3>
      );
    };
    render(wrap(3, designed, { stepFocus: true, ...note }, <Heading />));
    await screen.findByText(NOTICE);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Preview' }));
    expect(screen.getAllByRole('status').some((el) => el.textContent?.includes(NOTICE))).toBe(true);
  });

  it('shows no note and no Dismiss when the state holds none', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap());
    await screen.findByTestId('spec-app');
    expect(screen.queryByText(/from the example/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('carries the note through the workspace step focus state without losing it', async () => {
    api.previewStatus.mockResolvedValue(status({ state: 'running', appId: 'app-1', revision: 3 }));
    render(wrap(3, designed, { stepFocus: true, ...note }));
    expect(await screen.findByText(NOTICE)).toBeTruthy();
  });
});
