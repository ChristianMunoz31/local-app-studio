// Split from designNewTable.test.tsx by describe block (phase 27): New table from Design, the badge, Add a field, the Linked record picker, the status line. The mocks, builders and hooks are in designNewTableHarness.tsx.
import { blankSpec, setStartSpec, mount, saveButton, toolbarUndo, toolbarRedo, box, badge, layerIds, addPart, makeTable, installDesignNewTableHooks } from './designNewTableHarness';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';

installDesignNewTableHooks();

describe('New table from Design', () => {
  it('places a part on a blank app not connected, with the offer in its box and the status line', async () => {
    mount();
    await addPart('Table of records');
    expect(box()?.textContent).toContain('This app has no table yet.');
    expect(within(box() as HTMLElement).getByRole('button', { name: 'Make a new table for Table of records' })).toBeTruthy();
    expect(screen.getByText('This app has no table yet. Press New table on the Table of records.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText(/Data step/)).toBeNull();
  });

  it('makes the table, its list and the connection, and tells it with Undo', async () => {
    mount();
    await addPart('Table of records');
    await makeTable('Table of records', 'Crews');
    expect(badge()).toBe('Connected to Crews');
    expect(box()).toBeNull();
    expect(screen.getByText('Made the table Crews and added a list of Crews to this page.')).toBeTruthy();
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('is one Undo step: Undo takes the table, its list and the connection away, Redo brings all three back', async () => {
    mount();
    await addPart('Table of records');
    await makeTable('Table of records', 'Crews');
    fireEvent.click(toolbarUndo());
    // The part is still there (the drop is its own step) but there is no table any more: the offer is back.
    expect(box()?.textContent).toContain('This app has no table yet.');
    expect(badge()).toBeNull();
    fireEvent.click(toolbarRedo());
    expect(badge()).toBe('Connected to Crews');
    fireEvent.click(toolbarUndo());
    fireEvent.click(toolbarUndo());
    expect(layerIds()).toEqual(['root_home', 'h1']);
    await waitFor(() => expect(saveButton().title).toBe('No changes to save.'));
  });

  it('saves the table with the page', async () => {
    const h = mount();
    await addPart('Table of records');
    await makeTable('Table of records', 'Crews');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const saved = h.saves[0];
    expect(saved.tables.map((t) => t.id)).toEqual(['crews']);
    expect(saved.pages[0].sources.map((s) => s.table)).toEqual(['crews']);
    const table = (saved.pages[0].layout.children as LayoutLayer[]).find((c) => c.type === 'DataTable');
    expect(table?.props.source).toBe(saved.pages[0].sources[0].id);
  });

  it('opens the part settings when a second field could be picked, and not otherwise', async () => {
    mount();
    await addPart('Chart');
    await makeTable('Chart', 'Crews', (dialog) => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
      const row = within(dialog).getByRole('group', { name: 'Field New field' });
      fireEvent.change(within(row).getByLabelText('Field name'), { target: { value: 'Kind' } });
      fireEvent.change(within(row).getByLabelText('Type'), { target: { value: 'select' } });
    });
    expect(await screen.findByRole('dialog', { name: 'Settings for Chart' })).toBeTruthy();
  });

  it('puts the focus back on the part when no field choice is left', async () => {
    mount();
    await addPart('Chart');
    await makeTable('Chart', 'Crews');
    expect(screen.queryByRole('dialog', { name: 'Settings for Chart' })).toBeNull();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Chart'));
  });

  it('waits for the dialog: Ctrl+Z does not undo the page behind it', async () => {
    mount();
    await addPart('Table of records');
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new table for Table of records' }));
    await screen.findByRole('dialog', { name: 'New table for Table of records' });
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull();
    expect(box()).not.toBeNull();
  });
});

describe('the Change table badge', () => {
  it('is a button whose name holds its visible text; a click and Enter open the settings on the table choice', async () => {
    mount();
    await addPart('Table of records');
    await makeTable('Table of records', 'Crews');
    const button = screen.getByRole('button', { name: 'Connected to Crews. Change table' });
    // The name starts with the visible words (WCAG 2.5.3) and is set exactly, so every browser reads the same words.
    expect(button.getAttribute('aria-label')).toBe('Connected to Crews. Change table');
    expect(button.textContent?.startsWith('Connected to Crews')).toBe(true);
    expect(button.hasAttribute('title')).toBe(false);
    fireEvent.click(button);
    const first = await screen.findByRole('dialog', { name: 'Settings for Table of records' });
    await waitFor(() => expect(document.activeElement).toBe(within(first).getByLabelText('Table')));
    fireEvent.keyDown(first, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings for Table of records' })).toBeNull());
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Connected to Crews. Change table' }).focus();
    await user.keyboard('{Enter}');
    const second = await screen.findByRole('dialog', { name: 'Settings for Table of records' });
    await waitFor(() => expect(document.activeElement).toBe(within(second).getByLabelText('Table')));
  });
});

describe('Add a field', () => {
  it('says when it also added a list of the table to the page', async () => {
    setStartSpec(() => ({ ...blankSpec(), tables: [{ id: 'tasks', label: 'Tasks', titleField: 'title', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] }] }));
    mount();
    await addPart('Checklist');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a field for Checklist' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a field for Checklist' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a field for Checklist' })).toBeNull());
    expect(screen.getByText('Added the field Done to Tasks and a list of Tasks to this page.')).toBeTruthy();
    expect(badge()).toBe('Connected to Tasks');
  });
});

describe('a Linked record picker on a blank app', () => {
  it('makes the first table without connecting, as one Undo step, and the offer then leads on to a second table', async () => {
    mount();
    await addPart('Linked record picker');
    expect(box()?.textContent).toContain('This app has no table yet.');
    expect(screen.getByRole('button', { name: 'Make a new table for Linked record picker' })).toBeTruthy();
    await makeTable('Linked record picker', 'Crews');
    expect(screen.getByText('Made the table Crews. Make a second table, then the Linked record picker connects to it.')).toBeTruthy();
    // The table exists, the part is not connected, and the box offers New table only (a link needs another table to point to).
    expect(badge()).toBeNull();
    expect(box()?.textContent).toContain('Needs a link field');
    expect(screen.queryByRole('button', { name: 'Add a field for Linked record picker' })).toBeNull();
    await waitFor(() => expect(saveButton().disabled).toBe(true));

    await makeTable('Linked record picker', 'Tasks');
    expect(box()).toBeNull();
    expect(badge()).toBe('Connected to Tasks');

    // One Undo takes only the second table (and what it connected); the first table stays.
    fireEvent.click(toolbarUndo());
    expect(badge()).toBeNull();
    expect(box()).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new table for Linked record picker' }));
    const dialog = await screen.findByRole('dialog', { name: 'New table for Linked record picker' });
    expect(within(dialog).getByRole('group', { name: 'Field Crews' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New table for Linked record picker' })).toBeNull());

    // The first New table was one step holding only the table: a second Undo takes it away and the part stays, with the blank-app offer.
    fireEvent.click(toolbarUndo());
    expect(box()?.textContent).toContain('This app has no table yet.');
    expect(layerIds()).toContain('root_home');
    expect(layerIds().length).toBe(3);
  });
});

describe('what the status line says when the part is still not connected', () => {
  it('a Checklist whose Done field was removed in the dialog is told to press Add a field', async () => {
    mount();
    await addPart('Checklist');
    await makeTable('Checklist', 'Crews', (dialog) => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete field Done' }));
    });
    expect(screen.getByText('Made the table Crews. The Checklist is not connected to it yet. Press Add a field on the Checklist.')).toBeTruthy();
    expect(screen.queryByText(/second table/)).toBeNull();
    expect(badge()).toBeNull();
    expect(within(box() as HTMLElement).getByRole('button', { name: 'Add a field for Checklist' })).toBeTruthy();
  });
});
