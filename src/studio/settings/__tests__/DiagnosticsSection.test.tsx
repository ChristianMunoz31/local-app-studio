import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as download from '../../lib/download';
import DiagnosticsSection from '../DiagnosticsSection';

vi.mock('../../lib/download', () => ({ downloadBlob: vi.fn(), downloadJson: vi.fn() }));

const baseInfo = {
  versions: { studio: '1.1.1', node: '24.15.0', bundle: { sea: true, sha256: '1a2b3c4d5e6f7a8b9c0d' } },
  mode: { app: 'studio', channel: 'stable', desktop: true },
  dataFolder: `${['C:', 'Users', 'sam'].join('\\')}\\AppData\\Roaming\\Local App Studio`,
  ports: { app: 4321, preview: null },
  helper: { state: 'ready', host: 'http://127.0.0.1:11434', models: ['llama3.2:3b'], sentence: 'The helper is ready.' },
  debug: { env: false, session: false, on: false },
  log: { files: [], ring: 3 },
  recovered: null,
};
const doctor = {
  checkedAt: '2026-11-04T10:00:00.000Z',
  lines: [
    { id: 'node', label: 'Node.js', status: 'found', detail: '24.15.0', action: '' },
    { id: 'rustc', label: 'Rust (rustc)', status: 'missing', detail: 'Not found.', action: 'Install Rust with rustup.' },
  ],
  counts: { found: 1, missing: 1, problem: 0 },
};
const lines = [
  { level: 'info', time: '2026-11-04T10:00:01.000Z', requestId: 'r1', event: 'http.request', route: '/api/a', durationMs: 4 },
  { level: 'warn', time: '2026-11-04T10:00:02.000Z', requestId: 'r2', event: 'slow.query' },
  { level: 'error', time: '2026-11-04T10:00:03.000Z', requestId: 'r3', event: 'preview', code: 'preview_failed', stage: 'start' },
];

const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

function stubFetch(info = baseInfo) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/studio/diagnostics') return json(info);
    if (url === '/api/studio/diagnostics/doctor') return json(doctor);
    if (url.startsWith('/api/studio/diagnostics/logs')) return json({ lines });
    if (url === '/api/studio/diagnostics/debug') return json({ env: false, session: true, on: true });
    if (url === '/api/studio/diagnostics/report') {
      return Promise.resolve(
        new Response(new Blob(['PK']), { status: 200, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="local-app-studio-report-20261104-1002.zip"' } }),
      );
    }
    return Promise.reject(new Error(`unexpected ${url} ${init?.method ?? 'GET'}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderOpen() {
  const view = render(<DiagnosticsSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Show diagnostics' }));
  return view;
}

beforeEach(() => {
  vi.mocked(download.downloadBlob).mockReset();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DiagnosticsSection', () => {
  it('is closed on a plain visit: no call, and the disclosure opens and closes the body', async () => {
    const fetchMock = stubFetch();
    render(<DiagnosticsSection />);
    const toggle = screen.getByRole('button', { name: 'Show diagnostics' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await screen.findByText('Rust (rustc)');
    expect(screen.getByRole('button', { name: 'Hide diagnostics' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Hide diagnostics' }));
    expect(screen.queryByText('Rust (rustc)')).toBeNull();
  });

  it('starts open when the address ends in #diagnostics', async () => {
    stubFetch();
    window.location.hash = '#diagnostics';
    render(<DiagnosticsSection />);
    await screen.findByText('Rust (rustc)');
    expect(screen.getByRole('button', { name: 'Hide diagnostics' })).toBeTruthy();
  });

  it('hides the home folder even when the user name has a space', async () => {
    stubFetch({ ...baseInfo, dataFolder: `${['C:', 'Users', 'Sam Smith'].join('\\')}\\AppData\\Local App Studio` });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderOpen();
    await screen.findByText('Rust (rustc)');
    const copy = screen.getByRole('button', { name: 'Copy summary' });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    await screen.findByText('Summary copied.');
    const text = String(writeText.mock.calls[0][0]);
    expect(text).toContain('Data folder: <home>\\AppData\\Local App Studio');
    expect(text).not.toMatch(/Sam|Smith/);
  });

  it('shows the parts in order and the log newest first', async () => {
    stubFetch();
    renderOpen();
    await screen.findByText('Rust (rustc)');
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(['This copy', 'Debug mode', 'Checks', 'Recent log']);
    expect(screen.getByText('sha256 1a2b3c4d5e6f')).toBeTruthy();
    expect(screen.getByText('1 found, 1 missing, 0 problem.')).toBeTruthy();
    expect(screen.getByText('Install Rust with rustup.')).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: 'Recent log' })).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toContain('preview_failed');
    expect(rows[2].textContent).toContain('/api/a');
  });

  it('filters the log on the client without another call', async () => {
    const fetchMock = stubFetch();
    renderOpen();
    await screen.findByText('Rust (rustc)');
    const calls = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'errors' } });
    const table = screen.getByRole('table', { name: 'Recent log' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'warnings' } });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('turns session debug on and locks the switch when the environment set it', async () => {
    const fetchMock = stubFetch();
    const first = renderOpen();
    const toggle = await screen.findByRole('switch', { name: 'Debug mode for this session' });
    await waitFor(() => expect(toggle.getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(JSON.parse(String(fetchMock.mock.calls.find((c) => c[0].endsWith('/debug'))?.[1]?.body))).toEqual({ on: true });
    first.unmount();

    stubFetch({ ...baseInfo, debug: { env: true, session: false, on: true } });
    renderOpen();
    const locked = await screen.findByRole('switch', { name: 'Debug mode for this session' });
    await waitFor(() => expect(locked.getAttribute('aria-disabled')).toBe('true'));
    expect(locked.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('On, set when Local App Studio started (APP_DEBUG=1).')).toBeTruthy();
  });

  it('saves the report as a ZIP with the server filename', async () => {
    stubFetch();
    renderOpen();
    await screen.findByText('Rust (rustc)');
    fireEvent.click(screen.getByRole('button', { name: 'Save a report' }));
    await screen.findByText('Report ready. Look for it in your downloads folder.');
    const [name, blob] = vi.mocked(download.downloadBlob).mock.calls[0];
    expect(name).toBe('local-app-studio-report-20261104-1002.zip');
    expect(blob).toBeInstanceOf(Blob);
  });

  it('copies a summary in the documented layout', async () => {
    stubFetch();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderOpen();
    await screen.findByText('Rust (rustc)');
    const copy = screen.getByRole('button', { name: 'Copy summary' });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    await screen.findByText('Summary copied.');
    const text = String(writeText.mock.calls[0][0]);
    expect(text).toContain('Local App Studio 1.1.1, Studio, stable, desktop');
    expect(text).toContain('Node 24.15.0, server bundle sha256 1a2b3c4d5e6f');
    expect(text).toContain('Data folder: <home>\\AppData\\Roaming\\Local App Studio');
    expect(text).toContain('The helper: ready, llama3.2:3b');
    expect(text).toContain('Checks: 1 found, 1 missing (Rust), 0 problems');
    expect(text).toContain('Debug mode: off');
    expect(text).toMatch(/Log: 1 error in the last 3 lines \(latest preview_failed at \d\d:\d\d\)/);
  });

  it('shows the summary in a box to select when the clipboard refuses it', async () => {
    stubFetch();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    renderOpen();
    await screen.findByText('Rust (rustc)');
    const copy = screen.getByRole('button', { name: 'Copy summary' });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    await screen.findByText('Could not copy. Select the summary below and copy it yourself.');
    const box = screen.getByRole('textbox', { name: 'Summary' }) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.value).toContain('Local App Studio 1.1.1, Studio, stable, desktop');
  });

  it('keeps the status line mounted and the scroll areas reachable by keyboard', async () => {
    stubFetch();
    renderOpen();
    await screen.findByText('Rust (rustc)');
    const statuses = screen.getAllByRole('status');
    expect(statuses.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save a report' }));
    await screen.findByText('Report ready. Look for it in your downloads folder.');
    expect(screen.getAllByRole('status')).toContain(statuses[0]);
    for (const name of ['Checks list', 'Recent log list']) {
      const region = screen.getByRole('region', { name });
      expect(region.getAttribute('tabindex')).toBe('0');
    }
  });

  it('retries the info block when it failed to load, and says why Copy summary is off', async () => {
    const fetchMock = stubFetch();
    let infoCalls = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/studio/diagnostics') {
        infoCalls += 1;
        return infoCalls === 1 ? Promise.resolve(new Response('{}', { status: 500 })) : json(baseInfo);
      }
      if (url === '/api/studio/diagnostics/doctor') return json(doctor);
      return json({ lines });
    });
    renderOpen();
    await screen.findByText(/Could not load the diagnostics\./);
    expect(screen.getByText(/Copy summary needs the checks and the log/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Copy summary' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Local App Studio version');
    expect(infoCalls).toBe(2);
  });

  it('turns an answer with no data into an error line, not a blank page', async () => {
    const fetchMock = stubFetch();
    fetchMock.mockImplementation((url: string) => (url === '/api/studio/diagnostics' ? Promise.resolve(new Response('{}', { status: 200 })) : url.endsWith('/doctor') ? json(doctor) : json({ lines })));
    renderOpen();
    await screen.findByText(/Could not load the diagnostics\./);
  });
});
