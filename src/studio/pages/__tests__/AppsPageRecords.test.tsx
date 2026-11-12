// Export with records and Duplicate with records on the Apps page (DESIGN-phase28.md 5.1, 5.2).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseSpec, json, recordOf } from '../../__tests__/fixtures';
import AppsPage from '../AppsPage';

// The helper state is not what these tests are about.
vi.mock('@/hooks/useOllamaSetup.js', () => ({
  useOllamaSetup: () => ({ setup: null, isLoading: false, isFetching: false, error: null, checkAgain: vi.fn(), pull: { status: 'idle' }, startPull: vi.fn(), cancel: vi.fn() }),
}));
vi.mock('@/proParts.js', () => ({ PRO_PARTS: { helper: false, installer: false, licensing: false, cloud: false } }));
const download = vi.hoisted(() => ({ blob: vi.fn(), json: vi.fn() }));
vi.mock('../../lib/download', () => ({ downloadBlob: download.blob, downloadJson: download.json }));

const ID = '11111111-1111-4111-8111-111111111111';
const summary = () => ({
  id: ID,
  name: 'Invoices and Clients',
  slug: 'invoices-and-clients',
  revision: 1,
  ok: true,
  issueCount: 0,
  tableCount: 2,
  pageCount: 2,
  description: '',
  hasInstaller: false,
  waiting: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: new Date().toISOString(),
});

let fetchMock: ReturnType<typeof vi.fn>;
const mockFetch = (impl: (url: string, init?: RequestInit) => Response) => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init)));
  vi.stubGlobal('fetch', fetchMock);
};
const posts = (): Array<[string, RequestInit]> =>
  fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST') as Array<[string, RequestInit]>;

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/apps']}>
      <Routes>
        <Route path="/apps" element={<AppsPage />} />
      </Routes>
    </MemoryRouter>,
  );

const openMenu = async (item: string): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'More actions for Invoices and Clients' }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
};

beforeEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  download.blob.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Export with records', () => {
  it('keeps Export as it is and adds Export with records under it', async () => {
    mockFetch(() => json(200, { data: [summary()] }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Invoices and Clients' }));
    const names = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(names.indexOf('Export with records')).toBe(names.indexOf('Export') + 1);
  });

  it('asks the server for the records and saves the ZIP as "<name> app.zip"', async () => {
    mockFetch((url, init) => (init?.method === 'POST' ? new Response(new Blob(['zip']), { status: 200 }) : json(200, { data: [summary()] })));
    renderPage();
    await openMenu('Export with records');
    await waitFor(() => expect(download.blob).toHaveBeenCalledTimes(1));
    const [url, init] = posts()[0];
    expect(url).toBe(`/api/studio/apps/${ID}/export`);
    expect(JSON.parse(init.body as string)).toEqual({ records: true });
    expect(download.blob.mock.calls[0][0]).toBe('Invoices and Clients app.zip');
    expect(screen.getByRole('status').textContent).toContain('Exported "Invoices and Clients" as Invoices and Clients app.zip.');
  });

  it('says in the server words to start the preview first, and saves nothing', async () => {
    mockFetch((url, init) =>
      init?.method === 'POST'
        ? json(409, { error: 'Start the preview of this app first. Its records live there.', code: 'preview_not_running', action: 'Start the preview first.' })
        : json(200, { data: [summary()] }),
    );
    renderPage();
    await openMenu('Export with records');
    expect((await screen.findByRole('alert')).textContent).toContain('Start the preview of this app first.');
    expect(download.blob).not.toHaveBeenCalled();
  });
});

describe('Duplicate with records', () => {
  it('has the box off, sends no records flag when it stays off', async () => {
    mockFetch((url, init) => (init?.method === 'POST' ? json(201, { data: { ...recordOf(baseSpec()), name: 'Copy A' } }) : json(200, { data: [summary()] })));
    renderPage();
    await openMenu('Duplicate');
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Invoices and Clients' });
    expect((within(dialog).getByLabelText('Keep the records from Preview') as HTMLInputElement).checked).toBe(false);
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Copy A' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(posts()[0][1].body as string)).toEqual({ name: 'Copy A' });
  });

  it('sends withRecords when ticked and says the records were copied', async () => {
    mockFetch((url, init) =>
      init?.method === 'POST' ? json(201, { data: { ...recordOf(baseSpec()), name: 'Copy B', recordsCopied: true } }) : json(200, { data: [summary()] }),
    );
    renderPage();
    await openMenu('Duplicate');
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Invoices and Clients' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Copy B' } });
    fireEvent.click(within(dialog).getByLabelText('Keep the records from Preview'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(posts()[0][1].body as string)).toEqual({ name: 'Copy B', withRecords: true });
    expect(screen.getByRole('status').textContent).toBe('Duplicated "Invoices and Clients" as "Copy B". The copy has the records from Preview.');
  });

  it('says the copy starts empty when the app had no records in Preview', async () => {
    mockFetch((url, init) =>
      init?.method === 'POST' ? json(201, { data: { ...recordOf(baseSpec()), name: 'Copy C', recordsCopied: false } }) : json(200, { data: [summary()] }),
    );
    renderPage();
    await openMenu('Duplicate');
    const dialog = await screen.findByRole('dialog', { name: 'Duplicate Invoices and Clients' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Copy C' } });
    fireEvent.click(within(dialog).getByLabelText('Keep the records from Preview'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('Duplicated "Invoices and Clients" as "Copy C". The copy starts with no records. This app had none in Preview.');
  });
});
