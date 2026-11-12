import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewData, PreviewStatus } from '../../types';
import PreviewDataBanner from '../PreviewDataBanner';

afterEach(cleanup);

const status = (data: PreviewData | null, appId: string | null = 'app-1'): PreviewStatus => ({
  state: 'running',
  appId,
  revision: 1,
  startedAt: null,
  message: null,
  data,
});
const show = (s: PreviewStatus | null, onReset = vi.fn().mockResolvedValue(undefined), busy = false) =>
  render(<PreviewDataBanner status={s} appId="app-1" busy={busy} onReset={onReset} />);

describe('PreviewDataBanner', () => {
  it('always says where the preview data lives', () => {
    show(null);
    expect(screen.getByText("Preview data stays on this computer, apart from any app you build.")).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    ['tables_updated', 'Your table changes were applied. The records you added are kept.'],
    ['tables_replaced', 'Preview data was cleared: a table change removed or changed fields in a way that cannot keep the records.'],
    ['repaired', 'Preview data was cleared: the table update could not be applied.'],
    ['reset', 'Preview data was reset.'],
  ] as const)('shows the %s note', (reason, text) => {
    show(status({ kept: reason === 'tables_updated', reason }));
    expect(screen.getByRole('status').textContent).toBe(text);
  });

  it('shows no note for first_start or unchanged, or when the status is for another app', () => {
    show(status({ kept: false, reason: 'first_start' }));
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    show(status({ kept: true, reason: 'unchanged' }));
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    show(status({ kept: false, reason: 'reset' }, 'other-app'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks first, resets only after the confirm, and cancel resets nothing', async () => {
    const onReset = vi.fn().mockResolvedValue(undefined);
    show(null, onReset);
    fireEvent.click(screen.getByRole('button', { name: 'Reset preview data' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Reset preview data?')).toBeTruthy();
    expect(screen.getByText('Every record you added in Preview for this app is deleted. Your design and any app you built are not changed.')).toBeTruthy();
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep the records' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset preview data' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('Reset preview data')) as HTMLElement);
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('hides the button when asked, and a controlled confirm opens from outside', () => {
    const { rerender } = render(<PreviewDataBanner status={null} appId="app-1" onReset={vi.fn()} showButton={false} />);
    expect(screen.queryByRole('button', { name: 'Reset preview data' })).toBeNull();
    rerender(<PreviewDataBanner status={null} appId="app-1" onReset={vi.fn()} showButton={false} open />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('disables the button while busy', () => {
    show(null, vi.fn(), true);
    expect((screen.getByRole('button', { name: 'Reset preview data' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the data was reset after a reset while another app is the running one, and not after a failed reset', async () => {
    const other = status({ kept: false, reason: 'reset' }, 'other-app');
    const confirmReset = (): void => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset preview data' }));
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.includes('Reset preview data')) as HTMLElement);
    };
    const failed = vi.fn().mockResolvedValue(null);
    show(other, failed);
    confirmReset();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    const ok = vi.fn().mockResolvedValue(other);
    show(other, ok);
    confirmReset();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Preview data was reset.'));
  });
});

describe('PreviewDataBanner sample records', () => {
  it.each([
    ['first_start', 'Sample records were added so you can try the app.'],
    ['reset', 'Preview data was reset. The sample records are back.'],
    ['tables_replaced', 'Preview data was cleared: a table change removed or changed fields in a way that cannot keep the records. The sample records are back.'],
    ['repaired', 'Preview data was cleared: the table update could not be applied. The sample records are back.'],
  ] as const)('says the sample is there for %s', (reason, text) => {
    show(status({ kept: false, reason, seeded: 9 }));
    expect(screen.getByRole('status').textContent).toBe(text);
  });

  it('keeps the plain note when nothing was added, and for kept data', () => {
    show(status({ kept: false, reason: 'reset', seeded: 0 }));
    expect(screen.getByRole('status').textContent).toBe('Preview data was reset.');
    cleanup();
    show(status({ kept: true, reason: 'tables_updated', seeded: 4 }));
    expect(screen.getByRole('status').textContent).toBe('Your table changes were applied. The records you added are kept.');
  });

  it('drops the note when the page already says it', () => {
    render(<PreviewDataBanner status={status({ kept: false, reason: 'first_start', seeded: 3 })} appId="app-1" onReset={vi.fn()} suppressNote />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
