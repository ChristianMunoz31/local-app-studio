import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import BackupCopyToForm from '../BackupCopyToForm';

afterEach(cleanup);

const ago = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
const COPY = (over = {}) => ({
  enabled: true,
  folder: 'D:\\Backups',
  health: 'ok',
  lastSuccessAt: ago(1),
  lastFailureAt: null,
  lastError: null,
  lastCopiedId: 'x',
  ...over,
});
const OFF = { enabled: false, folder: null, health: 'off', lastSuccessAt: null, lastFailureAt: null, lastError: null };

const setup = (secondCopy, onSave = vi.fn().mockResolvedValue(undefined), props = {}) => {
  render(<BackupCopyToForm secondCopy={secondCopy} onSave={onSave} {...props} />);
  return onSave;
};

describe('BackupCopyToForm', () => {
  it('has a labelled input, the plain hint, Save and Turn off', () => {
    setup(OFF);
    const input = screen.getByLabelText('Also copy each new backup to');
    expect(input).toHaveValue('');
    expect(input).toHaveAccessibleDescription(/another drive.*OneDrive.*leave this PC.*API keys are never in a backup\./);
    expect(screen.getByRole('button', { name: 'Save folder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off copies' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the visible text as the accessible name while saving', () => {
    setup(OFF, undefined, { saving: true });
    const button = screen.getByRole('button', { name: 'Saving folder…' });
    expect(button).toHaveTextContent('Saving folder…');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Save folder' })).not.toBeInTheDocument();
  });

  it('does nothing when Turn off copies is pressed while it is already off', async () => {
    const user = userEvent.setup();
    const onSave = setup(OFF);
    await user.click(screen.getByRole('button', { name: 'Turn off copies' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByText('The second folder is off.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves the trimmed folder with the keyboard and says so', async () => {
    const user = userEvent.setup();
    const onSave = setup(OFF);
    await user.type(screen.getByLabelText('Also copy each new backup to'), '  E:\\Copies  {Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('E:\\Copies');
    expect(await screen.findByText('Second folder saved.')).toBeInTheDocument();
  });

  it('asks for a path instead of saving an empty field', async () => {
    const user = userEvent.setup();
    const onSave = setup(OFF);
    await user.click(screen.getByRole('button', { name: 'Save folder' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Type the full path of a folder, or use Turn off copies.');
    expect(screen.getByLabelText('Also copy each new backup to')).toHaveAttribute('aria-invalid', 'true');
  });

  it('turns it off with null', async () => {
    const user = userEvent.setup();
    const onSave = setup(COPY());
    expect(screen.getByLabelText('Also copy each new backup to')).toHaveValue('D:\\Backups');
    await user.click(screen.getByRole('button', { name: 'Turn off copies' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(null);
    expect(await screen.findByText('The second folder is off.')).toBeInTheDocument();
  });

  it('shows the server sentence for a refused folder in an alert', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('That folder was not found. Create it first, then try again.'));
    setup(OFF, onSave);
    await user.type(screen.getByLabelText('Also copy each new backup to'), 'Z:\\nope');
    await user.click(screen.getByRole('button', { name: 'Save folder' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That folder was not found. Create it first, then try again.');
    expect(screen.getByLabelText('Also copy each new backup to')).toHaveAccessibleDescription(/not found/);
  });

  it('does not save while a restore locks it', async () => {
    const user = userEvent.setup();
    const onSave = setup(COPY(), undefined, { locked: true });
    await user.click(screen.getByRole('button', { name: 'Save folder' }));
    await user.click(screen.getByRole('button', { name: 'Turn off copies' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says nothing when off', () => {
    setup(OFF);
    expect(screen.queryByText(/second folder/)).not.toBeInTheDocument();
  });

  it('says when the last copy happened', () => {
    setup(COPY());
    expect(screen.getByText(/^Last copied to the second folder: (today|yesterday) \d+:\d\d\.$/)).toBeInTheDocument();
  });

  it('says nothing was copied yet when ok without a success time', () => {
    setup(COPY({ lastSuccessAt: null }));
    expect(screen.getByText('Nothing copied yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Last copied/)).not.toBeInTheDocument();
  });

  it('says it is copying while pending', () => {
    setup(COPY({ health: 'pending' }));
    expect(screen.getByText('Copying to the second folder.')).toBeInTheDocument();
  });

  it.each([
    ['copy_folder_missing', 'the folder was not found'],
    ['copy_not_writable', 'the folder is read-only or not allowed'],
    ['copy_disk_full', 'the drive is full'],
    ['copy_locked', 'a file there is in use'],
    ['copy_verify_failed', 'the copy did not match the backup'],
    ['copy_timeout', 'it took too long'],
    ['copy_folder_inside_data', 'the folder is inside the data folder'],
    ['copy_app_folder', "the folder holds another app's data"],
    ['copy_failed', 'something went wrong'],
    [null, 'something went wrong'],
  ])('explains a failed copy (%s) in plain words', (lastError, reason) => {
    setup(COPY({ health: 'failing', lastError, lastFailureAt: ago(0.1) }));
    expect(
      screen.getByText(
        new RegExp(
          `^The last copy to the second folder failed at (today|yesterday) \\d+:\\d\\d: ${reason}\\. The backup on this PC is fine\\. It will try again within the hour\\.$`,
        ),
      ),
    ).toBeInTheDocument();
  });

  it('says a stuck copy is stuck and asks for a restart instead of promising a retry', () => {
    setup(COPY({ health: 'failing', lastError: 'copy_stuck', lastFailureAt: ago(0.1) }));
    const sentence = screen.getByText(/^The last copy to the second folder failed at (today|yesterday) \d+:\d\d: the copy is stuck\./);
    expect(sentence).toHaveTextContent(/The backup on this PC is fine\. Restart .+ to try again\.$/);
    expect(sentence).not.toHaveTextContent('within the hour');
  });
});
