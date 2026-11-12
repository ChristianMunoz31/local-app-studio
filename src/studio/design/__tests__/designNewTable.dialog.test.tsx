// Split from designNewTable.test.tsx by describe block (phase 27): the dialog focus, the settings popover, a part that is gone, a save that removes a table, a conflict. The mocks, builders and hooks are in designNewTableHarness.tsx.
import { layer, blankSpec, setStartSpec, draft, announced, mount, saveButton, toolbarUndo, badge, layerIds, addPart, makeTable, installDesignNewTableHooks } from './designNewTableHarness';
import type { Harness } from './designNewTableHarness';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import type { StepDraft } from '../../hooks/useStepChrome';
import { REMOVE_DATA } from '../../lib/dataRemovals';
import { CONFLICT_MESSAGE } from '../../types';
import type { SaveResult } from '../../types';

installDesignNewTableHooks();

describe('the New table dialog: focus, Escape and reopening', () => {
  const opener = async (part: string): Promise<HTMLElement> => screen.findByRole('button', { name: `Make a new table for ${part}` });

  it('Cancel puts the focus back on the button that opened it', async () => {
    mount();
    await addPart('Table of records');
    const button = await opener('Table of records');
    button.focus();
    fireEvent.click(button);
    await screen.findByRole('dialog', { name: 'New table for Table of records' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('Escape closes it and the next one starts again from the suggestion', async () => {
    mount();
    await addPart('Table of records');
    fireEvent.click(await opener('Table of records'));
    const dialog = await screen.findByRole('dialog', { name: 'New table for Table of records' });
    fireEvent.change(within(dialog).getByLabelText('Table name'), { target: { value: 'Crews' } });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull());
    fireEvent.click(await opener('Table of records'));
    const again = await screen.findByRole('dialog', { name: 'New table for Table of records' });
    expect((within(again).getByLabelText('Table name') as HTMLInputElement).value).toBe('');
  });

  it('Make table puts the focus on the part, or inside its settings when a field could be picked', async () => {
    mount();
    await addPart('Chart');
    await makeTable('Chart', 'Crews', (dialog) => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
      const row = within(dialog).getByRole('group', { name: 'Field New field' });
      fireEvent.change(within(row).getByLabelText('Field name'), { target: { value: 'Kind' } });
      fireEvent.change(within(row).getByLabelText('Type'), { target: { value: 'select' } });
    });
    const settings = await screen.findByRole('dialog', { name: 'Settings for Chart' });
    await waitFor(() => expect(settings.contains(document.activeElement)).toBe(true));
  });

  it('a Discard while the dialog is open closes it, and a new part with the same id does not bring it back', async () => {
    mount();
    await addPart('Table of records');
    fireEvent.click(await opener('Table of records'));
    await screen.findByRole('dialog', { name: 'New table for Table of records' });
    act(() => draft?.reset());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
    await screen.findByRole('button', { name: 'Make a new table for Table of records' });
    expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull();
  });
});

describe('the Add a field button of the settings popover', () => {
  it('is named by its visible words first, then where the field goes (WCAG 2.5.3)', async () => {
    setStartSpec(() => {
      const spec = blankSpec();
      return {
        ...spec,
        tables: [{ id: 'tasks', label: 'Tasks', titleField: 'title', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] }],
        pages: [{ ...spec.pages[0], sources: [{ id: 'open_tasks', table: 'tasks', mode: 'list', where: [], orderBy: [], limit: 50 }], layout: layer('root_home', 'Page', {}, [layer('c1', 'Checklist', { source: 'open_tasks', field: 'done' })]) }],
      };
    });
    mount();
    const part = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-canvas-block][data-layer-id="c1"]');
      if (el === null) throw new Error('no block');
      return el;
    });
    fireEvent.doubleClick(part);
    const settings = await screen.findByRole('dialog', { name: 'Settings for Checklist' });
    const add = within(settings).getByRole('button', { name: 'Add a field: a yes or no field in Tasks' });
    expect(add.getAttribute('aria-label')).toBeNull();
    expect(add.textContent?.startsWith('Add a field')).toBe(true);
  });
});

describe('a request whose part is gone', () => {
  /** Undo from the toolbar even while a dialog covers the page. */
  const undoBehind = (): HTMLElement => screen.getAllByRole('button', { name: 'Undo', hidden: true })[0];

  it('closes the New table dialog when the part is removed behind it, and it does not come back', async () => {
    mount();
    await addPart('Table of records');
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new table for Table of records' }));
    await screen.findByRole('dialog', { name: 'New table for Table of records' });
    fireEvent.click(undoBehind());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull());
    expect(layerIds()).toEqual(['root_home', 'h1']);
    fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
    await screen.findByRole('button', { name: 'Make a new table for Table of records' });
    expect(screen.queryByRole('dialog', { name: 'New table for Table of records' })).toBeNull();
  });

  it('closes the Add a field dialog when the part is removed behind it, and it does not come back', async () => {
    setStartSpec(() => ({ ...blankSpec(), tables: [{ id: 'tasks', label: 'Tasks', titleField: 'title', fields: [{ id: 'title', label: 'Title', type: 'text', required: true }] }] }));
    mount();
    await addPart('Checklist');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a field for Checklist' }));
    await screen.findByRole('dialog', { name: 'Add a field for Checklist' });
    fireEvent.click(undoBehind());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a field for Checklist' })).toBeNull());
    expect(layerIds()).toEqual(['root_home', 'h1']);
    fireEvent.click(screen.getByRole('button', { name: 'Add Checklist' }));
    await screen.findByRole('button', { name: 'Add a field for Checklist' });
    expect(screen.queryByRole('dialog', { name: 'Add a field for Checklist' })).toBeNull();
  });
});

describe('a save that removes a saved table', () => {
  /** A saved table with its list, then Undo twice (the table, then the part): the draft no longer has the table. */
  async function savedThenUndone(result?: (next: AppSpec) => SaveResult | null): Promise<Harness> {
    const h = mount(result);
    await addPart('Table of records');
    await makeTable('Table of records', 'Crews');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(h.saves).toHaveLength(1));
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.click(toolbarUndo());
    fireEvent.click(toolbarUndo());
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    return h;
  }

  it('asks the Data step question; Keep editing sends nothing', async () => {
    const h = await savedThenUndone();
    fireEvent.click(saveButton());
    const ask = await screen.findByRole('alertdialog', { name: REMOVE_DATA.title });
    expect(ask.textContent).toContain('Crews');
    fireEvent.click(within(ask).getByRole('button', { name: REMOVE_DATA.cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(h.saves).toHaveLength(1);
    expect(saveButton().disabled).toBe(false);
  });

  it('Save and remove sends the page without the table and without its list', async () => {
    const h = await savedThenUndone();
    fireEvent.click(saveButton());
    const ask = await screen.findByRole('alertdialog', { name: REMOVE_DATA.title });
    fireEvent.click(within(ask).getByRole('button', { name: REMOVE_DATA.confirm }));
    await waitFor(() => expect(h.saves).toHaveLength(2));
    expect(h.saves[1].tables).toEqual([]);
    expect(h.saves[1].pages[0].sources).toEqual([]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('refuses a move the question cannot be asked for, with the Data step reason, and sends nothing', async () => {
    const h = await savedThenUndone();
    const gone = draft;
    expect(gone).not.toBeNull();
    cleanup();
    const outcome = await (gone as StepDraft).save();
    expect(outcome).toEqual({ ok: false, reason: REMOVE_DATA.needsAnswer });
    expect(h.saves).toHaveLength(1);
  });
});

describe('a conflict', () => {
  it('keeps the draft with its table, and a clean session then starts again from the latest record', async () => {
    let conflicts = 1;
    const h = mount(() => (conflicts-- > 0 ? { ok: false, code: 'revision_conflict', message: 'raw server text', issues: [] } : null));
    await addPart('Table of records');
    await makeTable('Table of records', 'Crews');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeTruthy();
    expect(badge()).toBe('Connected to Crews');
    expect(draft?.isDirty()).toBe(true);
    // The other change arrives: a draft with edits never adopts it.
    act(() => h.setRevision(5));
    expect(badge()).toBe('Connected to Crews');
    // Undo back to clean: the session starts again from the latest record and says Redo went with it.
    fireEvent.click(toolbarUndo());
    fireEvent.click(toolbarUndo());
    await waitFor(() => expect(announced).toContain('Started again from the latest saved version. Redo is cleared.'));
    expect(h.saves).toHaveLength(1);
  });
});
