import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import type { BuildEvent, BuildRecord, ToolchainReport } from '../../buildTypes';
import { StepChromeContext } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { StudioApiError } from '../../services/studioApi';
import type { WorkspaceValue } from '../../types';
import BuildTab from '../BuildTab';

const api = vi.hoisted(() => ({
  getToolchain: vi.fn(),
  listBuilds: vi.fn(),
  startBuild: vi.fn(),
  getBuild: vi.fn(),
  cancelBuild: vi.fn(),
  streamBuild: vi.fn(),
}));
vi.mock('../../services/buildApi', () => api);
// These tests are about the build panel, so the installer is in the build they run in (a public run has none: installerNotInBuild.test.tsx).
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));

const toolchain = (ok: boolean): ToolchainReport => ({
  ok,
  checkedAt: 'now',
  hostTriple: null,
  items: ok ? [] : [{ id: 'rustc', label: 'Rust compiler (rustc)', status: 'missing', required: true, path: null, hint: 'Install Rust.' }],
});
const build = (over: Partial<BuildRecord> = {}): BuildRecord => ({
  id: 'b1', appId: 'app-1', status: 'running', specRevision: 3, appVersion: '1.0.0', startedAt: new Date().toISOString(), finishedAt: null,
  durationMs: null, installerPath: null, installerSha256: null, installerSizeBytes: null, errorCode: null, message: null, ...over,
});

let featureAvailable = true;
const features = (enabled: boolean) => ({
  features: [{ id: 'build', enabled, available: featureAvailable, label: 'Allow downloads for builds', description: 'Needed once per build. Nothing about your apps or data is sent.', hosts: ['registry.npmjs.org', 'static.crates.io'] }],
});
let networkOn = true;
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') networkOn = (JSON.parse(String(init.body)) as { enabled: boolean }).enabled;
  return new Response(JSON.stringify(features(networkOn)), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

const wrap = (children: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value = { record: { id: 'app-1' }, spec: {} as AppSpec, revision: 3, save: vi.fn(), reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

let emit: (e: BuildEvent) => void = () => undefined;

beforeEach(() => {
  networkOn = true;
  featureAvailable = true;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  Object.values(api).forEach((f) => f.mockReset());
  api.getToolchain.mockResolvedValue(toolchain(true));
  api.listBuilds.mockResolvedValue([]);
  api.streamBuild.mockImplementation((_id: string, { onEvent }: { onEvent(e: BuildEvent): void }) => {
    emit = onEvent;
    return new Promise<void>(() => undefined);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const steps = [
  { id: 'toolchain' as const, label: 'Check the build tools', status: 'done' as const, startedAt: null, finishedAt: null },
  { id: 'extract' as const, label: 'Unpack the app template', status: 'running' as const, startedAt: null, finishedAt: null },
];

describe('BuildTab', () => {
  it('shows the first-build notice and starts a build with the saved revision', async () => {
    api.startBuild.mockResolvedValue(build());
    render(wrap(<BuildTab />));
    expect(screen.getByText('The first build on this PC takes 5 to 15 minutes.')).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Make installer' });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    expect(await screen.findByText('Build tools: ready')).toBeTruthy();
    fireEvent.click(start);
    await waitFor(() => expect(api.startBuild).toHaveBeenCalledWith('app-1', 3));
  });

  it('says the build tools are being checked and keeps the button off until the report arrives', async () => {
    api.getToolchain.mockReturnValue(new Promise(() => undefined));
    render(wrap(<BuildTab />));
    expect(await screen.findByText('Checking the build tools.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Make installer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/save your changes/)).toBeNull();
  });

  it('says the check did not finish when the build tools check fails', async () => {
    api.getToolchain.mockRejectedValue(new Error('boom'));
    render(wrap(<BuildTab />));
    expect(await screen.findByText('The build tools check did not finish.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Make installer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not point at a switch that is not shown when the build downloads switch is not offered', async () => {
    networkOn = false;
    featureAvailable = false;
    render(wrap(<BuildTab />));
    await screen.findByText('Build tools: ready');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/turn on "Allow downloads for builds"(?! in Settings)/i)).toBeNull();
    expect(screen.queryByText(/above/i)).toBeNull();
  });

  it('is disabled and shows the hint for each missing tool', async () => {
    api.getToolchain.mockResolvedValue(toolchain(false));
    render(wrap(<BuildTab />));
    expect(await screen.findByText('Rust')).toBeTruthy();
    expect(screen.getByText('How to install: Install Rust.')).toBeTruthy();
    expect(screen.getByText(/Before you can make an installer: install the missing build tools\./)).toBeTruthy();
    expect(screen.getByText('This computer needs Rust before it can make an installer.')).toBeTruthy();
    const toolDetails = screen.getByText('Rust').closest('details') as HTMLDetailsElement;
    expect(toolDetails.open).toBe(false);
    expect(within(toolDetails).getByText('Details')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Make installer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(api.getToolchain).toHaveBeenLastCalledWith(true));
  });

  it('keeps the button off until the build downloads switch is turned on inline', async () => {
    networkOn = false;
    render(wrap(<BuildTab />));
    const sw = await screen.findByRole('switch', { name: 'Allow downloads for builds' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('It contacts: registry.npmjs.org and static.crates.io.')).toBeTruthy();
    expect(screen.getByText('Before you can make an installer: turn on "Allow downloads for builds".')).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Make installer' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(sw);
    await waitFor(() => expect(start.disabled).toBe(false));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('/api/settings/network');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ id: 'build', enabled: true });
  });

  it('shows a plain message when the start is refused for the opt-in, and the build_busy message', async () => {
    api.startBuild.mockRejectedValueOnce(new StudioApiError('Off.', 403, 'network_opt_in_required'));
    render(wrap(<BuildTab />));
    await screen.findByText('Build tools: ready');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Make installer' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Make installer' }));
    expect(await screen.findByText('Turn on "Allow downloads for builds" to continue.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();

    api.startBuild.mockRejectedValueOnce(new StudioApiError('Another build is running. Wait for it to finish or cancel it.', 409, 'build_busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Make installer' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Another build is running. Wait for it to finish or cancel it.');
  });

  it('shows steps and log from the stream and cancels after confirming', async () => {
    api.listBuilds.mockResolvedValue([build()]);
    const cancelled = build({ status: 'cancelled', message: 'You stopped the build.' });
    api.cancelBuild.mockImplementation(async () => {
      api.listBuilds.mockResolvedValue([cancelled]);
      return cancelled;
    });
    render(wrap(<BuildTab />));
    await waitFor(() => expect(api.streamBuild).toHaveBeenCalled());
    act(() => emit({ type: 'snapshot', build: build(), steps, lines: [{ seq: 1, step: 'extract', line: 'unpacking' }], truncated: false, live: true }));
    const list = screen.getByRole('list', { name: 'Build steps' });
    expect(within(list).getByText('Unpack the app template')).toBeTruthy();
    expect(screen.getByRole('log', { name: 'Build log' }).textContent).toBe('unpacking');
    expect(screen.getByRole('log', { name: 'Build log' }).closest('details')?.open).toBe(false);
    expect(screen.getByRole('timer', { name: 'Time elapsed' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop build' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Stop this build?')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Keep building' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop build' }));
    await waitFor(() => expect(api.cancelBuild).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText('You stopped the build.')).toBeTruthy();
  });

  it('closes "Stop this build?" when the build ends on its own', async () => {
    api.listBuilds.mockResolvedValue([build()]);
    render(wrap(<BuildTab />));
    await waitFor(() => expect(api.streamBuild).toHaveBeenCalled());
    act(() => emit({ type: 'snapshot', build: build(), steps, lines: [], truncated: false, live: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop build' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    act(() => emit({ type: 'snapshot', build: build({ status: 'failed', message: 'npm failed.' }), steps, lines: [], truncated: false, live: true }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Stop build' })).toBeNull();
  });

  it('disables Stop build once the installer step is done', async () => {
    api.listBuilds.mockResolvedValue([build()]);
    const chromeAnnounce = vi.fn();
    const chrome = { setDraft: vi.fn(), go: vi.fn(), announce: chromeAnnounce, markDone: vi.fn() };
    render(<StepChromeContext.Provider value={chrome}>{wrap(<BuildTab />)}</StepChromeContext.Provider>);
    await waitFor(() => expect(api.streamBuild).toHaveBeenCalled());
    const done = [{ id: 'desktop-build' as const, label: 'Build the installer', status: 'done' as const, startedAt: null, finishedAt: null }];
    act(() => emit({ type: 'snapshot', build: build(), steps: done, lines: [], truncated: false, live: true }));
    const btn = screen.getByRole('button', { name: 'Stop build' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.title).toBe('The installer is being saved and can no longer be stopped.');
    // Pressing it says why, and the question does not open.
    fireEvent.click(btn);
    expect(chromeAnnounce).toHaveBeenCalledWith('The installer is being saved and can no longer be stopped.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the installer details, copies the path and lists history', async () => {
    const done = build({ status: 'succeeded', durationMs: 65000, installerPath: 'C:\\Docs\\Crew_1.0.0_arm64-setup.exe', installerSha256: 'abc123', installerSizeBytes: 5 * 1048576 });
    api.listBuilds.mockResolvedValue([done]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(wrap(<BuildTab />));
    expect(await screen.findByText('Your installer is ready.')).toBeTruthy();
    expect(screen.getByText('C:\\Docs\\Crew_1.0.0_arm64-setup.exe', { selector: 'p' })).toBeTruthy();
    const details = screen.getByText('abc123').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('5.0 MB')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('C:\\Docs\\Crew_1.0.0_arm64-setup.exe'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy SHA-256' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abc123'));
    expect(screen.queryByText(/Show in folder/)).toBeNull();
    const history = screen.getByRole('list', { name: 'Earlier builds' });
    expect(within(history).getByText('Succeeded')).toBeTruthy();
    expect(within(history).getByText('Crew_1.0.0_arm64-setup.exe')).toBeTruthy();
    expect(within(history).getByText('01:05')).toBeTruthy();
  });

  it('describes the disabled Make installer by the blocked line', async () => {
    api.getToolchain.mockResolvedValue(toolchain(false));
    render(wrap(<BuildTab />));
    const line = await screen.findByText(/Before you can make an installer: install the missing build tools\./);
    expect(line.getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: 'Make installer' }).getAttribute('aria-describedby')).toBe(line.id);
  });

  it('points to Settings, Network when downloads for builds are off and the switch is not on this screen', async () => {
    networkOn = false;
    featureAvailable = false;
    render(wrap(<BuildTab />));
    await screen.findByText('Build tools: ready');
    await waitFor(() => expect(screen.queryByText(/turn on "Allow downloads for builds" in Settings, Network/)).toBeTruthy());
  });

  it('marks Build done for an installer of the saved revision, and not for another revision', async () => {
    const markDone = vi.fn();
    const chrome = { setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone };
    api.listBuilds.mockResolvedValue([build({ status: 'succeeded', specRevision: 2, installerPath: 'C:\\Docs\\a-setup.exe' })]);
    render(<StepChromeContext.Provider value={chrome}>{wrap(<BuildTab />)}</StepChromeContext.Provider>);
    expect(await screen.findByText('Your installer is ready.')).toBeTruthy();
    expect(markDone).not.toHaveBeenCalled();
    cleanup();
    api.listBuilds.mockResolvedValue([build({ status: 'succeeded', specRevision: 3, installerPath: 'C:\\Docs\\a-setup.exe' })]);
    render(<StepChromeContext.Provider value={chrome}>{wrap(<BuildTab />)}</StepChromeContext.Provider>);
    expect(await screen.findByText('Your installer is ready.')).toBeTruthy();
    await waitFor(() => expect(markDone).toHaveBeenCalledWith('build', 3));
  });

  it('says where a failed build stopped and what to do, and announces a finished installer as a status', async () => {
    api.listBuilds.mockResolvedValue([build({ status: 'failed', message: 'npm failed.' })]);
    const view = render(wrap(<BuildTab />));
    await screen.findByText('npm failed.');
    expect(screen.getByRole('alert').textContent).toContain('Press Make installer to try again.');
    view.unmount();
    api.listBuilds.mockResolvedValue([build({ status: 'succeeded', specRevision: 3, installerPath: 'C:\\Docs\\a-setup.exe' })]);
    render(wrap(<BuildTab />));
    expect((await screen.findByText('Your installer is ready.')).getAttribute('role')).toBe('status');
  });
});
