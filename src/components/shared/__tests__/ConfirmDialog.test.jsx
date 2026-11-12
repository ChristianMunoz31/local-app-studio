import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmDialog from '../ConfirmDialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const setup = (props = {}) => {
  const onConfirm = props.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(<ConfirmDialog title="Remove item?" message="Lamp will be deleted." onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
};

describe('ConfirmDialog', () => {
  it('renders an alertdialog described by the message, with Cancel focused', () => {
    setup();
    const dlg = screen.getByRole('alertdialog', { name: 'Remove item?' });
    expect(dlg).toHaveAccessibleDescription('Lamp will be deleted.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('Cancel calls onCancel only', async () => {
    const { onConfirm, onCancel } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('never uses window.confirm', async () => {
    const spy = vi.spyOn(window, 'confirm');
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows busy state and blocks dismissal while confirming', async () => {
    let resolve;
    const onConfirm = vi.fn(() => new Promise((r) => (resolve = r)));
    const { onCancel } = setup({ onConfirm });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const busyBtn = await screen.findByRole('button', { name: 'Removing…' });
    expect(busyBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    resolve();
  });

  it('shows the error and stays open when confirm rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Server said no'));
    const { onCancel } = setup({ onConfirm });
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server said no');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled());
    expect(onCancel).not.toHaveBeenCalled();
  });
});
