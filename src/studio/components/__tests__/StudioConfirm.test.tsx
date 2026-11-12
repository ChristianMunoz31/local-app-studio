import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudioConfirm from '../StudioConfirm';
import type { StudioConfirmProps } from '../StudioConfirm';

afterEach(cleanup);

const show = (over: Partial<StudioConfirmProps> = {}) => {
  const props: StudioConfirmProps = {
    title: 'Delete Crew Roster?',
    message: 'This removes the app.',
    confirmLabel: 'Delete app',
    busyLabel: 'Deleting...',
    cancelLabel: 'Keep app',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
  render(<StudioConfirm {...props} />);
  return props;
};

describe('StudioConfirm', () => {
  it('shows the labels in an alert dialog and focuses Cancel first', () => {
    show();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Crew Roster?' });
    expect(dialog.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByText('This removes the app.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete app' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep app' }));
  });

  it('can focus Confirm first', () => {
    show({ initialFocus: 'confirm', tone: 'primary' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete app' }));
  });

  it('shows the busy label and disables both buttons while confirming', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    show({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Delete app' }));
    const busy = await screen.findByRole('button', { name: 'Deleting...' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Keep app' }) as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete app' })).toBeTruthy());
  });

  it('shows the message of a rejection, or the plain fallback, and stays open', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('The app is open elsewhere.')).mockRejectedValueOnce('boom');
    show({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Delete app' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The app is open elsewhere.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete app' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That did not work. Nothing was changed. Try again.'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('puts focus back on the confirm button when the confirm failed (R-17)', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('The app is open elsewhere.'));
    show({ onConfirm });
    const confirm = screen.getByRole('button', { name: 'Delete app' });
    confirm.focus();
    fireEvent.click(confirm);
    await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete app' })));
  });

  it('cancels with the button', () => {
    const props = show();
    fireEvent.click(screen.getByRole('button', { name: 'Keep app' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});
