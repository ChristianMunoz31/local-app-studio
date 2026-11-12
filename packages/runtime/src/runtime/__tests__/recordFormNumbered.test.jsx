import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordFormView } from '../../catalog/parts/RecordFormView.tsx';
import { QuickAdd } from '../../catalog/parts/QuickAdd.tsx';
import { CatalogPageProvider } from '../../../../../src/catalog/context.tsx';

afterEach(cleanup);

const spec = {
  tables: [
    {
      id: 'invoices',
      label: 'Invoices',
      fields: [
        { id: 'number', label: 'Number', type: 'text', required: true, autoNumber: { prefix: 'INV-' } },
        { id: 'client', label: 'Client', type: 'text' },
        { id: 'amount', label: 'Amount', type: 'integer', required: true },
      ],
    },
    {
      id: 'bills',
      label: 'Bills',
      fields: [
        { id: 'paid', label: 'Paid', type: 'boolean' },
        { id: 'paid_on', label: 'Paid on', type: 'date' },
        { id: 'note', label: 'Note', type: 'text' },
      ],
    },
    {
      id: 'tickets',
      label: 'Tickets',
      fields: [
        { id: 'code', label: 'Code', type: 'text', required: true, autoNumber: {} },
        { id: 'title', label: 'Title', type: 'text' },
      ],
    },
  ],
  pages: [],
};

function setup(ui, applied) {
  const saved = { id: 'i1', number: 'INV-0007' };
  if (applied) Object.defineProperty(saved, 'applied', { value: applied, enumerable: false });
  const dataSource = { create: vi.fn(async () => saved), update: vi.fn(async () => saved) };
  render(<CatalogPageProvider value={{ apiBase: '/api', spec, dataSource, navigate: () => {} }}>{ui}</CatalogPageProvider>);
  return dataSource;
}

describe('a numbered field in the record form', () => {
  it('shows "Numbered when saved", has no input, skips the required check and sends nothing for it', async () => {
    const ds = setup(<RecordFormView table="invoices" />);
    expect(screen.getByText('Numbered when saved')).toBeTruthy();
    expect(screen.queryByLabelText(/Number/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create).toHaveBeenCalledWith('invoices', { amount: 12 });
  });

  it('shows the stored number as text when editing and never sends it', async () => {
    const ds = setup(<RecordFormView table="invoices" record={{ id: 'i1', number: 'INV-0007', client: 'Acme', amount: 5 }} />);
    expect(screen.getByText('INV-0007')).toBeTruthy();
    expect(screen.queryByText('Numbered when saved')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Client/), { target: { value: 'Beta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalled());
    expect(ds.update.mock.calls[0][2]).toEqual({ client: 'Beta' });
  });

  // Changed on purpose: an unchanged edit used to send a PATCH with {} (a 200 that only touched updated_at); it now sends nothing.
  it('sends no request and says Nothing changed when an edit changed nothing', async () => {
    const ds = setup(<RecordFormView table="invoices" record={{ id: 'i1', number: 'INV-0007', client: 'Acme', amount: 5 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Nothing changed.'));
    expect(ds.update).not.toHaveBeenCalled();
  });

  it('sends only the fields that changed', async () => {
    const ds = setup(<RecordFormView table="invoices" record={{ id: 'i1', number: 'INV-0007', client: 'Acme', amount: 5 }} />);
    fireEvent.change(screen.getByLabelText(/Client/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(ds.update).toHaveBeenCalled());
    expect(ds.update.mock.calls[0][2]).toEqual({ client: null });
  });

  it('adds the applied words to the status line', async () => {
    setup(<RecordFormView table="invoices" record={{ id: 'i1', number: 'INV-0007', amount: 5 }} />, [
      { field: 'paid_on', label: 'Paid on', to: 'today', words: 'Paid on was set to today.' },
    ]);
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved. Paid on was set to today.'));
  });

  it('says plain Saved when nothing applied', async () => {
    setup(<RecordFormView table="invoices" record={{ id: 'i1', number: 'INV-0007', amount: 5 }} />);
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
  });
});

describe('an edit form after a save that ran a rule', () => {
  it('reseeds from the saved row and never sends the rule field back', async () => {
    const answers = [
      { id: 'b1', paid: true, paid_on: '2026-11-12', note: '' },
      { id: 'b1', paid: true, paid_on: '2026-11-12', note: 'x' },
      { id: 'b1', paid: false, paid_on: null, note: 'x' },
    ];
    const update = vi.fn(async () => {
      const row = answers.shift();
      Object.defineProperty(row, 'applied', { value: [{ field: 'paid_on', words: 'Paid on was set to today.' }], enumerable: false });
      return row;
    });
    const dataSource = { create: vi.fn(), update };
    render(
      <CatalogPageProvider value={{ apiBase: '/api', spec, dataSource, navigate: () => {} }}>
        <RecordFormView table="bills" record={{ id: 'b1', paid: false, paid_on: null, note: '' }} />
      </CatalogPageProvider>,
    );
    fireEvent.click(screen.getByLabelText('Paid'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByLabelText('Paid on').value).toBe('2026-11-12'));
    expect(update.mock.calls[0][2]).toEqual({ paid: true });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][2]).toEqual({ note: 'x' });
    expect(screen.getByLabelText('Paid on').value).toBe('2026-11-12');
    fireEvent.click(screen.getByLabelText('Paid'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    expect(update.mock.calls[2][2]).toEqual({ paid: false });
    await waitFor(() => expect(screen.getByLabelText('Paid on').value).toBe(''));
  });
});

describe('QuickAdd on a numbered field', () => {
  it('says to use a form and offers no box', () => {
    setup(<QuickAdd table="invoices" field="number" />);
    expect(screen.getByText('This field is numbered automatically. Use a form instead.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('keeps the box enabled (read only) while adding', async () => {
    let finish;
    const dataSource = { create: vi.fn(() => new Promise((r) => (finish = r))), update: vi.fn() };
    render(<CatalogPageProvider value={{ apiBase: '/api', spec, dataSource, navigate: () => {} }}><QuickAdd table="tickets" field="title" /></CatalogPageProvider>);
    const box = screen.getByRole('textbox');
    box.focus();
    fireEvent.change(box, { target: { value: 'Fix door' } });
    fireEvent.submit(box.closest('form'));
    await waitFor(() => expect(box.readOnly).toBe(true));
    expect(box.disabled).toBe(false);
    expect(box.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(box);
    finish({ id: 't1' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Added.'));
    expect(box.readOnly).toBe(false);
  });

  it('says why it is idle where the page is not live', () => {
    render(<CatalogPageProvider value={{ apiBase: '/api', spec, dataSource: { create: vi.fn(), update: vi.fn() } }}><QuickAdd table="tickets" field="title" /></CatalogPageProvider>);
    const box = screen.getByRole('textbox');
    expect(box.disabled).toBe(true);
    expect(document.getElementById(box.getAttribute('aria-describedby')).textContent).toBe('Adding works in the running app.');
  });

  it('says it is not available instead of the table id', () => {
    setup(<QuickAdd table="nope" field="title" />);
    expect(screen.getByText('This quick add is not available here.')).toBeTruthy();
    expect(screen.queryByText(/nope/)).toBeNull();
  });

  it('does not count a required numbered field as another needed field', async () => {
    const ds = setup(<QuickAdd table="tickets" field="title" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fix door' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(ds.create).toHaveBeenCalledWith('tickets', { title: 'Fix door' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
