import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { ERROR_COPY } from '@/errors/errorCopy.js';
import StepBoundary from '../StepBoundary';
import type { StepId } from '../../lib/steps';

let broken = true;
const WIN_HOME = ['C:', 'Users', 'sam'].join(String.fromCharCode(92));
function Tab({ name }: { name: string }) {
  if (broken) throw new Error(`secret internals at ${WIN_HOME}${String.fromCharCode(92)}app.tsx`);
  return <p>{name} works</p>;
}

function Shell() {
  const { step } = useParams();
  return (
    <div>
      <nav>
        <Link to="/apps/a1/design">Go to Design</Link>
        <Link to="/apps/a1/data">Go to Data</Link>
      </nav>
      <StepBoundary key={step} step={step as StepId} appId="a1">
        {step === 'design' ? <Tab name="Design tab" /> : <p>Data tab fine</p>}
      </StepBoundary>
    </div>
  );
}

function renderShell(start = '/apps/a1/design') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/apps/:appId/:step" element={<Shell />} />
      </Routes>
    </MemoryRouter>,
  );
}

const reload = vi.fn();
const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);

beforeEach(() => {
  broken = true;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('location', { ...window.location, reload });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ data: { lines: Array.from({ length: 50 }, (_, i) => `{"level":"info","n":${i}}`) } }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  reload.mockClear();
  writeText.mockClear();
});

describe('StepBoundary', () => {
  it('shows plain words, that saved work is safe and the next action', () => {
    renderShell();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('This step stopped working');
    expect(alert.textContent).toContain(ERROR_COPY.render_failed.sentence ?? '');
    expect(alert.textContent).toContain('It happened on the Design step.');
    expect(alert.textContent).toContain('Your saved work is safe.');
    expect(alert.textContent).toContain(ERROR_COPY.render_failed.action);
    expect(alert.textContent).not.toMatch(/secret internals|Error:|render_failed/);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'This step stopped working' }));
  });

  it('keeps the rail usable and resets when another step opens', () => {
    renderShell();
    fireEvent.click(screen.getByRole('link', { name: 'Go to Data' }));
    expect(screen.getByText('Data tab fine')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Try again renders the step again', () => {
    renderShell();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Design tab works')).toBeTruthy();
  });

  it('Reload reloads the page', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Copy details writes the envelope and the 50 log lines, without private text', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0];
    expect(text).toContain('Local App Studio error details');
    expect(text).toContain('Where: Design step, /apps/a1/design');
    expect(text).toContain('"code":"render_failed"');
    expect(text).toContain('Last 50 log lines:');
    expect(text.split('\n').filter((l) => l.startsWith('{"level":"info"'))).toHaveLength(50);
    expect(text).not.toMatch(/secret internals|sam/);
    expect(await screen.findByText('Details copied.')).toBeTruthy();
  });

  it('gives the envelope alone when the log call fails, and a text box when the clipboard refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    writeText.mockRejectedValueOnce(new Error('denied'));
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    const box = await screen.findByRole('textbox', { name: 'Error details' });
    expect((box as HTMLTextAreaElement).value).toContain('Log lines could not be read: the app did not answer.');
    expect((box as HTMLTextAreaElement).value).toContain('"code":"render_failed"');
    expect(screen.getByText('Could not copy. Select the text below and copy it.')).toBeTruthy();
  });
});
