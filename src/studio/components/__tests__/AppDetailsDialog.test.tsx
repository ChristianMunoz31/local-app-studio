import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseSpec, recordOf } from '../../__tests__/fixtures';
import AppDetailsDialog from '../AppDetailsDialog';

afterEach(cleanup);

describe('AppDetailsDialog', () => {
  it('is App settings with a file name line and the technical fields under More options', () => {
    render(<AppDetailsDialog spec={baseSpec()} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'App settings' })).toBeTruthy();
    expect(screen.getByText('File name: crew-roster')).toBeTruthy();
    const more = screen.getByText('More options').closest('details') as HTMLDetailsElement;
    expect(more.open).toBe(false);
    expect(more.contains(screen.getByLabelText('Windows app name'))).toBe(true);
    expect(more.contains(screen.getByLabelText('Version'))).toBe(true);
    expect(screen.getByText('Windows uses it to tell your app apart. Keep it after the first installer.')).toBeTruthy();
    expect(screen.getByText('The installer shows it. Raise it when you share a new installer.')).toBeTruthy();
    expect(screen.queryByText(/Identifier|Short name/)).toBeNull();
  });

  it('capitalizes the icon names', () => {
    render(<AppDetailsDialog spec={baseSpec()} onSave={vi.fn()} onCancel={vi.fn()} />);
    const options = Array.from(screen.getByLabelText('Icon').querySelectorAll('option')).map((o) => o.textContent ?? '');
    expect(options[0]).toBe('None');
    expect(options.slice(1).every((o) => /^[A-Z]/.test(o))).toBe(true);
  });

  it('saves with Save settings', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, record: recordOf(baseSpec()) });
    render(<AppDetailsDialog spec={baseSpec()} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew Board' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].app).toMatchObject({ name: 'Crew Board', slug: 'crew-board' });
  });

  it('opens More options and names the field when the Windows app name is wrong', async () => {
    render(<AppDetailsDialog spec={baseSpec()} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Windows app name'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^Windows app name: /);
    expect(alert.textContent).not.toMatch(/app\.identifier/);
    expect((screen.getByText('More options').closest('details') as HTMLDetailsElement).open).toBe(true);
  });
});
