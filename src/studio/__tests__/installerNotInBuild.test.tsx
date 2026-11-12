// The installer in and out of a build (docs/ARCHITECTURE.md, 'The pro seam'; docs/DESIGN.md "Studio copy"): without it the Build step says
// so in one line with one Export button, which downloads the app file; with it, nothing changes.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseSpec, json, recordOf } from './fixtures';
import InstallerNotInBuild, { EXPORT_APP, INSTALLER_NOT_IN_BUILD } from '../components/InstallerNotInBuild';
import { StepChromeContext } from '../hooks/useStepChrome';
import type { StepChrome } from '../hooks/useStepChrome';
import { WorkspaceContext } from '../hooks/useWorkspace';
import { exportFileName, exportedNotice } from '../lib/appFiles';
import BuildTab from '../pages/BuildTab';
import type { SaveResult, WorkspaceValue } from '../types';

// The flag module is the one thing that differs between builds: each test sets the parts it is about.
const parts = vi.hoisted(() => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('@/proParts.js', () => parts);
const installerIs = (on: boolean): void => {
  parts.PRO_PARTS.installer = on;
};

const download = vi.hoisted(() => ({ downloadJson: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('../lib/download', () => download);

const api = vi.hoisted(() => ({
  getToolchain: vi.fn(),
  listBuilds: vi.fn(),
  startBuild: vi.fn(),
  getBuild: vi.fn(),
  cancelBuild: vi.fn(),
  streamBuild: vi.fn(),
}));
vi.mock('../services/buildApi', () => api);

const fetchMock = vi.fn();

beforeEach(() => {
  installerIs(true);
  download.downloadJson.mockReset();
  Object.values(api).forEach((f) => f.mockReset());
  api.getToolchain.mockResolvedValue({ ok: true, checkedAt: 'now', hostTriple: null, items: [] });
  api.listBuilds.mockResolvedValue([]);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(200, { features: [] }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InstallerNotInBuild', () => {
  it('says the one line, runs the button it is given and shows the notice it is given', () => {
    const onExport = vi.fn();
    const { rerender } = render(<InstallerNotInBuild onExport={onExport} notice="" />);
    expect(INSTALLER_NOT_IN_BUILD).toBe('Making an installer is not in this build. Export the app instead.');
    expect(EXPORT_APP).toBe('Export');
    expect(screen.getByText(INSTALLER_NOT_IN_BUILD)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
    // The live region is never display:none when empty (that drops the announcement of the next notice): its spacing collapses instead.
    expect(screen.getByRole('status').className).not.toContain('empty:hidden');
    expect(screen.getByRole('status').className).toContain('empty:-mb-3');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledTimes(1);
    rerender(<InstallerNotInBuild onExport={onExport} notice="Exported it." />);
    expect(screen.getByRole('status').textContent).toBe('Exported it.');
  });
});

describe('the Build step', () => {
  function show() {
    const spec = baseSpec();
    const record = recordOf(spec);
    const value = { record, spec, revision: 3, save: vi.fn(async (): Promise<SaveResult> => ({ ok: true, record })), reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
    const chrome: StepChrome = { setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkspaceContext.Provider value={value}>
            <StepChromeContext.Provider value={chrome}>
              <BuildTab />
            </StepChromeContext.Provider>
          </WorkspaceContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { spec, record };
  }

  it('without the installer shows the line and Export, no build panel, and asks the server for nothing', () => {
    installerIs(false);
    show();
    expect(screen.getByRole('region', { name: 'Build' })).toBeTruthy();
    expect(screen.getByText(INSTALLER_NOT_IN_BUILD)).toBeTruthy();
    expect(screen.queryByText('Make an installer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make installer' })).toBeNull();
    expect(api.getToolchain).not.toHaveBeenCalled();
    expect(api.listBuilds).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('without the installer Export downloads the saved app file and says so', () => {
    installerIs(false);
    const { spec, record } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const file = exportFileName(record.name);
    expect(download.downloadJson).toHaveBeenCalledTimes(1);
    expect(download.downloadJson).toHaveBeenCalledWith(file, spec);
    expect(screen.getByRole('status').textContent).toBe(exportedNotice(record.name, file));
  });

  it('with the installer shows the build panel and not the line', async () => {
    installerIs(true);
    show();
    expect(await screen.findByRole('button', { name: 'Make installer' })).toBeTruthy();
    expect(screen.queryByText(INSTALLER_NOT_IN_BUILD)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});
