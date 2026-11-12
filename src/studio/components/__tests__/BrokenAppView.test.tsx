import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseSpec, recordOf } from '../../__tests__/fixtures';
import * as downloads from '../../lib/download';
import BrokenAppView from '../BrokenAppView';

vi.mock('../../lib/download', () => ({ downloadJson: vi.fn() }));

const raw = { ...baseSpec(), tables: 'oops' };
const broken = (extra: Parameters<typeof recordOf>[1] = {}) =>
  recordOf(null, { issues: [{ path: 'tables', code: 'invalid_type', message: 'Invalid input: expected array, received string' }], raw, ...extra });

beforeEach(() => vi.mocked(downloads.downloadJson).mockReset());
afterEach(cleanup);

describe('BrokenAppView', () => {
  it('leads with what happened and what to do, with the problems in words and no code path', () => {
    render(<BrokenAppView record={broken()} onRepair={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('This app cannot open because part of it is damaged. Export a copy first, then try a repair.')).toBeTruthy();
    expect(screen.getByText('Tables: This has the wrong form.')).toBeTruthy();
    expect(screen.queryByText(/Invalid input|\(tables\)/)).toBeNull();
  });

  it('exports a copy first and keeps the repair text under Advanced repair', () => {
    render(<BrokenAppView record={broken()} onRepair={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Export a copy' }).className).toContain('bg-slate-brand');
    fireEvent.click(screen.getByRole('button', { name: 'Export a copy' }));
    expect(downloads.downloadJson).toHaveBeenCalledWith('crew-roster.raw.json', raw);
    const details = screen.getByText('Advanced repair').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByLabelText('App file text')).toBeTruthy();
  });

  it('says there is a typing mistake in the text, and what to do', async () => {
    const onRepair = vi.fn();
    render(<BrokenAppView record={broken()} onRepair={onRepair} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('App file text'), { target: { value: '{nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the fixed text' }));
    expect(await screen.findByText('That text has a typing mistake. Undo your last edit and try again.')).toBeTruthy();
    expect(onRepair).not.toHaveBeenCalled();
  });

  it('saves a fixed text through onRepair', async () => {
    const onRepair = vi.fn().mockResolvedValue(undefined);
    render(<BrokenAppView record={broken()} onRepair={onRepair} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('App file text'), { target: { value: JSON.stringify(baseSpec()) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the fixed text' }));
    await waitFor(() => expect(onRepair).toHaveBeenCalledWith(baseSpec()));
  });

  it('deletes through the Studio confirm with its own words', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<BrokenAppView record={broken()} onRepair={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete app' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this app?' });
    expect(within(dialog).getByRole('button', { name: 'Keep app' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete app' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it('turns the copy off with a reason when the damaged text is not available', () => {
    render(<BrokenAppView record={recordOf(null, { issues: [] })} onRepair={vi.fn()} onDelete={vi.fn()} />);
    const copy = screen.getByRole('button', { name: 'Export a copy' }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect(document.getElementById(copy.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/too large to copy here/);
  });
});
