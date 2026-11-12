import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImportBackup from '../data/ImportBackup.jsx';
import ImportMapping from '../data/ImportMapping.jsx';
import ImportPanel from '../data/ImportPanel.jsx';
import ImportPaste from '../data/ImportPaste.jsx';
import { IMPORT_WORDS, PREVIEW_IMPORT_MAX_BODY, sizeProblem } from '../data/importModel.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const spec = {
  tables: [
    { id: 'invoices', label: 'Invoices', fields: [] },
    { id: 'clients', label: 'Clients', fields: [] },
  ],
};
const reply = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { data } : data), { status });
const dry = (extra = {}) => ({
  dryRun: true,
  headers: ['Name', 'Notes'],
  mapping: { Name: 'name', Notes: null },
  fields: [
    { id: 'number', label: 'Number', type: 'text', required: false, numbered: true },
    { id: 'name', label: 'Name', type: 'text', required: true, numbered: false },
  ],
  valid: 298,
  invalid: 2,
  errors: [{ row: 58, field: 'due', message: 'Row 58: Due must be a date like 2025-01-31.' }],
  complete: true,
  stoppedAt: null,
  lines: ['298 rows can be added. 2 rows will be left out.', 'Left out: Notes.'],
  ...extra,
});
const added = (extra = {}) => ({ dryRun: false, added: 298, skipped: 2, errors: [], complete: true, stoppedAt: null, lines: ['Added 298 rows.'], ...extra });

function stubFetch(handler) {
  const mock = vi.fn(async (url, init) => handler(url, init && init.body ? JSON.parse(init.body) : null));
  vi.stubGlobal('fetch', mock);
  return mock;
}
const pick = async (text, name = 'rows.csv') => {
  const file = new File([text], name, { type: 'text/csv' });
  file.text = async () => text;
  fireEvent.change(screen.getByLabelText('Choose a CSV file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check rows' }).disabled).toBe(false));
};
const bodyOf = (mock, i) => JSON.parse(mock.mock.calls[i][1].body);
const check = () => fireEvent.click(screen.getByRole('button', { name: 'Check rows' }));

describe('ImportPanel in a built app', () => {
  const built = (props = {}) =>
    render(
      <ImportPanel
        spec={spec}
        table="invoices"
        renderBackup={(p) => <ImportBackup apiBase="/api" {...p} />}
        renderMapping={(p) => <ImportMapping {...p} />}
        renderPaste={(p) => <ImportPaste {...p} />}
        {...props}
      />,
    );

  it('checks, shows the server lines and row errors in a live region, then imports', async () => {
    const mock = stubFetch((url, body) => reply(body.dryRun ? dry() : added()));
    const onDone = vi.fn();
    built({ onDone });
    expect(screen.getByRole('button', { name: 'Check rows' }).disabled).toBe(true);
    await pick('Name,Notes\nA,x');
    check();
    const region = (await screen.findByText('298 rows can be added. 2 rows will be left out.')).closest('[role="status"]');
    expect(region.textContent).toContain('Row 58: Due must be a date like 2025-01-31.');
    expect(region.textContent).toContain('Left out: Notes.');
    expect(mock.mock.calls[0][0]).toBe('/api/data/invoices/import');
    expect(bodyOf(mock, 0)).toEqual({ csv: 'Name,Notes\nA,x', dryRun: true, applyAutomations: false });
    // The mapping editor offers no numbered field.
    expect(screen.queryByRole('option', { name: 'Number (text)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Import 298 rows' }));
    expect(await screen.findByText('Added 298 rows.')).toBeTruthy();
    expect(bodyOf(mock, 1)).toMatchObject({ dryRun: false, mapping: { Name: 'name', Notes: null } });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('sends the edited mapping and makes the person check again', async () => {
    const mock = stubFetch(() => reply(dry()));
    built();
    await pick('Name,Notes\nA,x');
    check();
    await screen.findByText('Left out: Notes.');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    expect(screen.queryByText('Left out: Notes.')).toBeNull();
    // Changed on purpose: a disabled Import button no longer says "Import 0 rows"; a hint says what to do.
    const idle = screen.getByRole('button', { name: 'Import rows' });
    expect(idle.disabled).toBe(true);
    expect(document.getElementById(idle.getAttribute('aria-describedby')).textContent).toBe('Check the rows first.');
    check();
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(2));
    expect(bodyOf(mock, 1).mapping).toEqual({ Name: null, Notes: null });
  });

  it('sends applyAutomations only when ticked and says it is off by default', async () => {
    const mock = stubFetch(() => reply(dry()));
    built();
    expect(screen.getByText(IMPORT_WORDS.automations)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Apply automations'));
    fireEvent.change(screen.getByLabelText(/Or paste rows/), { target: { value: 'Name\nA' } });
    check();
    await screen.findByText('Left out: Notes.');
    expect(bodyOf(mock, 0)).toMatchObject({ csv: 'Name\nA', applyAutomations: true });
  });

  it('offers a backup only here, and says when it was made', async () => {
    const mock = stubFetch(() => reply({ backup: { createdAt: new Date(2026, 10, 11, 9, 12).toISOString() } }, 201));
    built();
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(await screen.findByText('Backed up at 09:12.')).toBeTruthy();
    expect(mock.mock.calls[0][0]).toBe('/api/backups');
  });

  it('says what to do while Check rows and Import are disabled, and shows the hint only then', async () => {
    stubFetch(() => reply(dry()));
    built();
    const checkBtn = screen.getByRole('button', { name: 'Check rows' });
    const hint = () => document.getElementById(checkBtn.getAttribute('aria-describedby')).textContent;
    expect(hint()).toBe('Choose a file or paste some rows first.');
    expect(screen.getByRole('button', { name: 'Import rows' }).getAttribute('aria-describedby')).toBe(checkBtn.getAttribute('aria-describedby'));
    await pick('Name\nA');
    expect(checkBtn.getAttribute('aria-describedby')).toBeNull();
    check();
    await screen.findByText('Left out: Notes.');
    expect(screen.queryByText(/first\.$/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import rows' })).toBeNull();
  });

  it('turns off the inputs and the backup button while a check runs, and tells the host', async () => {
    let finish;
    stubFetch(() => new Promise((r) => (finish = r)));
    const onBusy = vi.fn();
    built({ onBusy });
    await pick('Name\nA');
    check();
    await waitFor(() => expect(screen.getByLabelText('Choose a CSV file').matches(':disabled')).toBe(true));
    expect(screen.getByLabelText(/Or paste rows/).matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('Apply automations').matches(':disabled')).toBe(true);
    expect(onBusy).toHaveBeenLastCalledWith(true);
    finish(reply(dry()));
    await screen.findByText('Left out: Notes.');
    expect(screen.getByLabelText('Choose a CSV file').matches(':disabled')).toBe(false);
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  it('shows the file as text in the paste box', async () => {
    stubFetch(() => reply(dry()));
    built();
    await pick('Name\nA');
    expect(screen.getByLabelText(/Or paste rows/).value).toBe('Name\nA');
  });

  it('puts the column to field words in plain language and names an empty column', async () => {
    stubFetch(() =>
      reply(
        dry({
          headers: ['', 'Name'],
          mapping: { '': null, Name: 'name' },
          fields: [
            { id: 'n', label: 'Count', type: 'integer', required: false, numbered: false },
            { id: 'notes', label: 'Notes', type: 'longtext', required: false, numbered: false },
          ],
        }),
      ),
    );
    built();
    await pick('x');
    check();
    expect(await screen.findByLabelText('Column 1')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'Count (whole number)' }).length).toBe(2);
    expect(screen.getAllByRole('option', { name: 'Notes (long text)' }).length).toBe(2);
  });

  it('says plain Backed up when the answer has no time', async () => {
    stubFetch(() => reply({ backup: {} }, 201));
    built();
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(await screen.findByText('Backed up.')).toBeTruthy();
  });

  it('shows a failed backup as an alert and disables the button while it runs', async () => {
    let fail;
    stubFetch(() => new Promise((r) => (fail = r)));
    built();
    const btn = screen.getByRole('button', { name: 'Back up now' });
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    fail(reply({ error: 'The backup could not be made.', code: 'backup_failed', action: 'Try again.' }, 500));
    expect((await screen.findByRole('alert')).textContent).toContain('The backup could not be made.');
    expect(btn.disabled).toBe(false);
  });

  it('offers the resume button with startAt after a stopped import', async () => {
    const stopped = added({
      added: 1000,
      skipped: 0,
      complete: false,
      stoppedAt: 1002,
      lines: ['Added 1000 rows. Nothing from row 1002 on was added. Import again from row 1002.'],
    });
    const mock = stubFetch((url, body) => reply(body.dryRun ? dry() : body.startAt ? added({ added: 5, lines: ['Added 5 rows.'] }) : stopped));
    built();
    await pick('Name\nA');
    check();
    await screen.findByText('Left out: Notes.');
    fireEvent.click(screen.getByRole('button', { name: 'Import 298 rows' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Import again from row 1002' }));
    expect(await screen.findByText('Added 5 rows.')).toBeTruthy();
    expect(bodyOf(mock, 2)).toMatchObject({ dryRun: false, startAt: 1002 });
    expect(screen.queryByRole('button', { name: /Import again from row/ })).toBeNull();
  });

  it('shows a failure sentence as an alert', async () => {
    stubFetch(() =>
      reply({ error: 'That file could not be read as rows and columns.', code: 'import_csv_invalid', action: 'Save it as CSV from your spreadsheet, then pick it again.' }, 400),
    );
    built();
    await pick('x');
    check();
    expect((await screen.findByRole('alert')).textContent).toContain('That file could not be read as rows and columns.');
  });
});

describe('ImportPanel in Preview', () => {
  const preview = () => render(<ImportPanel spec={spec} apiBase="/api/preview" maxBytes={PREVIEW_IMPORT_MAX_BODY} maxRows={5000} />);

  it('has a table picker, no paste box, no mapping editor, no backup offer, and says the limits', async () => {
    const mock = stubFetch(() => reply(dry()));
    preview();
    expect(screen.queryByLabelText(/Or paste rows/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back up now' })).toBeNull();
    expect(screen.getByText(IMPORT_WORDS.timeout)).toBeTruthy();
    expect(screen.getByText(IMPORT_WORDS.practice)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'clients' } });
    await pick('Name\nA');
    check();
    await screen.findByText('Left out: Notes.');
    expect(mock.mock.calls[0][0]).toBe('/api/preview/data/clients/import');
    expect(screen.queryByText('Match each column to a field')).toBeNull();
    expect(bodyOf(mock, 0).mapping).toBeUndefined();
  });

  it('skips the size measure for a text that cannot be over the limit', () => {
    expect(sizeProblem({ csv: 'x'.repeat(10), pad: 'y'.repeat(100) }, 40)).toBeNull();
    expect(sizeProblem({ csv: 'x'.repeat(100) }, 40)).toBe(IMPORT_WORDS.tooLargePreview);
  });

  it('refuses an encoded body over 1.9 MB without sending anything', async () => {
    const mock = stubFetch(() => reply(dry()));
    preview();
    await pick('x'.repeat(PREVIEW_IMPORT_MAX_BODY));
    check();
    expect((await screen.findByRole('alert')).textContent).toBe(IMPORT_WORDS.tooLargePreview);
    expect(mock).not.toHaveBeenCalled();
  });

  it('shows the 5000-row sentence when the server refuses the rows', async () => {
    stubFetch(() => reply({ error: 'In Preview a file can have up to 5000 rows. Split it, or import it in the built app.', code: 'import_too_large' }, 413));
    preview();
    await pick('Name\nA');
    check();
    expect((await screen.findByRole('alert')).textContent).toBe(IMPORT_WORDS.tooManyRowsPreview);
  });

  it('shows the timeout sentence for a 504', async () => {
    stubFetch(() => reply({ error: 'The preview took too long.', code: 'preview_timeout' }, 504));
    preview();
    await pick('Name\nA');
    check();
    expect((await screen.findByRole('alert')).textContent).toBe(IMPORT_WORDS.timeout);
  });
});
