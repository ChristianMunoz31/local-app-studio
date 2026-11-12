import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, recordOf } from '../../__tests__/fixtures';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome, StepDraft } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import type { SaveResult, WorkspaceValue } from '../../types';
import { specOf } from '../../lib/__tests__/bindFixtures';
import DataTab from '../DataTab';

const chrome = vi.hoisted(() => ({ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }));
const saveSpy = vi.fn();
let saveAnswer: (next: AppSpec) => SaveResult;

const okAnswer = (next: AppSpec): SaveResult => ({ ok: true, record: recordOf(next, { revision: 4 }) });

function Host({ initial }: { initial: AppSpec }) {
  const [spec, setSpec] = useState(initial);
  const value = {
    record: recordOf(spec),
    spec,
    revision: 3,
    save: async (next: AppSpec, opts?: { baseRevision?: number }) => {
      saveSpy(next, opts);
      const answer = saveAnswer(next);
      if (answer.ok) setSpec(next);
      return answer;
    },
    reload: vi.fn(),
    setDirty: vi.fn(),
  } as unknown as WorkspaceValue;
  return (
    <StepChromeContext.Provider value={chrome as StepChrome}>
      <WorkspaceContext.Provider value={value}>
        <DataTab />
      </WorkspaceContext.Provider>
    </StepChromeContext.Provider>
  );
}

const show = (spec: AppSpec = baseSpec()) => render(<Host initial={spec} />);

// The draft is checked a moment after each edit; a busy machine needs longer than the default wait.
configure({ asyncUtilTimeout: 4000 });

beforeEach(() => {
  saveSpy.mockReset();
  Object.values(chrome).forEach((fn) => fn.mockReset());
  saveAnswer = okAnswer;
});
afterEach(cleanup);

const editorGroups = (): HTMLElement[] => screen.getAllByRole('group').filter((g) => g.tagName === 'FIELDSET' && (g.getAttribute('aria-label') ?? '').startsWith('Field '));
const listAdd = (): HTMLElement => within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: 'Add table' });
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const undoButtons = () => screen.getAllByRole('button', { name: 'Undo' }) as HTMLButtonElement[];
const registered = (): StepDraft => {
  const calls = chrome.setDraft.mock.calls.filter(([tab, draft]) => tab === 'data' && draft !== null);
  return calls[calls.length - 1][1] as StepDraft;
};

describe('DataTab', () => {
  it('adds a table and a field, says so with Undo, and saves them', async () => {
    show();
    fireEvent.click(listAdd());
    expect(screen.getByText('Added the table New table.')).toBeTruthy();
    expect(screen.getByText('Every table starts with a Name field that names each record. Rename it or add more fields.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByText('Added the field New field.')).toBeTruthy();
    expect(editorGroups().length).toBe(2);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const body = saveSpy.mock.calls[0][0] as AppSpec;
    expect(body.tables.map((t) => t.id)).toEqual(['crews', 'new_table']);
    expect(body.tables[1].fields.map((f) => f.id)).toEqual(['name', 'new_field']);
    expect(screen.queryByText('Saved.')).toBeNull();
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it('has Save, not Save changes, and no Discard', () => {
    show();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.getByText('Pick a table to change its fields.')).toBeTruthy();
  });

  it('changes a type, adds the options a choice needs, and names the inside name under More options', () => {
    show();
    const sizeRow = editorGroups()[1];
    fireEvent.change(within(sizeRow).getByLabelText('Type'), { target: { value: 'select' } });
    expect((within(editorGroups()[1]).getByLabelText('Choices (one per line)') as HTMLTextAreaElement).value).toBe('Option 1');
    fireEvent.click(screen.getByText('More options'));
    expect(screen.getByLabelText('Inside name of Size')).toHaveProperty('value', 'size');
    expect(screen.getByLabelText('Field that names a record')).toBeTruthy();
    expect(screen.queryByText('Advanced')).toBeNull();
  });

  it('says how to link once, under Fields, while there is one table; the link choice is off', () => {
    show();
    const row = editorGroups()[0];
    expect((within(row).getByRole('option', { name: 'Link to another table' }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.queryByText('Links need a second table.')).toBeNull();
    expect(screen.getByText('To link records between tables, add a second table first.')).toBeTruthy();
    const editorAdd = screen.getAllByRole('button', { name: 'Add table' }).find((b) => !screen.getByRole('navigation', { name: 'Tables' }).contains(b)) as HTMLElement;
    fireEvent.click(editorAdd);
    expect(screen.queryByText('To link records between tables, add a second table first.')).toBeNull();
  });

  it('shows the problem under the right input with aria-invalid, marks the table, blocks Save and Next', async () => {
    show();
    fireEvent.click(screen.getByText('More options'));
    const input = screen.getByLabelText('Inside name of Size');
    fireEvent.change(input, { target: { value: 'Bad Id' } });
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id));
    expect(described.length).toBeGreaterThan(0);
    expect(described.every((el) => el !== null && (el.textContent ?? '').length > 0)).toBe(true);
    expect(within(editorGroups()[1]).getByText('Fix this under More options.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(within(screen.getByRole('navigation', { name: 'Tables' })).getByText('Needs a fix')).toBeTruthy();
    expect(registered().nextBlocked).toBe('Fix the tables marked Needs a fix to go on: Crews.');
    expect(registered().saveBlocked).toBeNull();
    const outcome = await registered().save();
    expect(outcome.ok).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('keeps More options closed until an inside name has a problem, then opens it', async () => {
    show();
    const details = screen.getByText('More options').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    details.open = true;
    fireEvent(details, new Event('toggle'));
    fireEvent.change(screen.getByLabelText('Inside name of Size'), { target: { value: 'Bad Id' } });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(details.open).toBe(true);
  });

  it('shows a refused save and keeps the draft', async () => {
    saveAnswer = () => ({ ok: false, code: 'revision_conflict', message: 'This app changed in another window. Make the change again.', issues: [] });
    show();
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Teams' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('This app changed in another window. Make the change again.');
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Teams');
  });

  it('puts the options of a choice one per line', () => {
    show();
    const area = within(editorGroups()[2]).getByLabelText('Choices (one per line)') as HTMLTextAreaElement;
    expect(area.value).toBe('active\npaused');
  });

  it('lists the nine plain types in order and saves Decimal as real', async () => {
    show();
    const type = within(editorGroups()[1]).getByLabelText('Type');
    expect(within(type).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Text', 'Long text', 'Number', 'Decimal', 'Yes or no', 'Date', 'Date and time', 'Choice', 'Link to another table',
    ]);
    fireEvent.change(type, { target: { value: 'real' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    // Changing a number to a decimal reshapes the stored records, so Save asks first.
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save and remove' }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect((saveSpy.mock.calls[0][0] as AppSpec).tables[0].fields.find((f) => f.id === 'size')?.type).toBe('real');
  });

  it('writes a default from More options and shows field counts in the list', async () => {
    show();
    expect(screen.getByRole('navigation', { name: 'Tables' }).textContent).toMatch(/\d+ fields/);
    fireEvent.click(screen.getByText('More options'));
    fireEvent.change(screen.getByLabelText('Default for Size'), { target: { value: '5' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect((saveSpy.mock.calls[0][0] as AppSpec).tables[0].fields.find((f) => f.id === 'size')).toMatchObject({ default: 5 });
  });

  it('undoes and redoes with the buttons, and typing in one box is one step', () => {
    show();
    const name = screen.getByLabelText('Table name');
    expect(undoButtons().every((b) => b.disabled)).toBe(true);
    fireEvent.change(name, { target: { value: 'T' } });
    fireEvent.change(name, { target: { value: 'Te' } });
    fireEvent.change(name, { target: { value: 'Tea' } });
    fireEvent.click(undoButtons()[0]);
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Crews');
    expect(undoButtons().every((b) => b.disabled)).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Redo' })[0]);
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Tea');
  });

  it('removes a table without a confirm, says so with Undo, and Undo brings it back', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const notice = screen.getByText('Removed the table Crews.');
    expect(screen.getByText('No tables yet. Add one to keep information in your app.')).toBeTruthy();
    fireEvent.click(within(notice.parentElement as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('Removed the table Crews.')).toBeNull();
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Crews');
  });

  it('says what Undo and Redo did, with the way back (P-23)', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete field Size' }));
    fireEvent.click(within(screen.getByText('Removed the field Size.').parentElement as HTMLElement).getByRole('button', { name: 'Undo' }));
    const undid = screen.getByText('Undid: removed the field Size.');
    fireEvent.click(within(undid.parentElement as HTMLElement).getByRole('button', { name: 'Redo' }));
    expect(screen.getByText('Redid: Removed the field Size.')).toBeTruthy();
  });

  it('focuses and selects the new name box on Add table and Add field, and Enter in a field name adds the next field (P-17)', () => {
    show();
    fireEvent.click(listAdd());
    const tableName = screen.getByLabelText('Table name') as HTMLInputElement;
    expect(document.activeElement).toBe(tableName);
    expect([tableName.selectionStart, tableName.selectionEnd]).toEqual([0, tableName.value.length]);
    fireEvent.keyDown(within(editorGroups()[0]).getByLabelText('Field name'), { key: 'Enter' });
    expect(editorGroups().length).toBe(2);
    const added = within(editorGroups()[1]).getByLabelText('Field name') as HTMLInputElement;
    expect(added.value).toBe('New field');
    expect(document.activeElement).toBe(added);
    expect(added.selectionEnd).toBe('New field'.length);
  });

  it('makes the inside names follow the names until the first save, then keeps them (P-17)', async () => {
    show();
    fireEvent.click(listAdd());
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Jobs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.change(within(editorGroups()[1]).getByLabelText('Field name'), { target: { value: 'Amount due' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const first = saveSpy.mock.calls[0][0] as AppSpec;
    expect(first.tables[1].id).toBe('jobs');
    expect(first.tables[1].fields.map((f) => f.id)).toEqual(['name', 'amount_due']);
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Work' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect((saveSpy.mock.calls[1][0] as AppSpec).tables[1].id).toBe('jobs');
  });

  it('names the pages beside Save when a removed field is still used, and one press takes it out of the parts (P-04)', async () => {
    const used = specOf((input) => {
      const home = input.pages?.find((p) => p.id === 'home');
      if (home === undefined) throw new Error('no home');
      home.sources = [{ id: 'all_crews', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 50 }] as never;
      home.layout = { id: 'root', type: 'Page', props: {}, children: [{ id: 'chart_1', type: 'Chart', props: { source: 'all_crews', groupBy: 'status', measure: 'count' }, children: [] }] } as never;
    });
    show(used);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: /^Crews/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete field Status' }));
    const press = await screen.findByRole('button', { name: 'Remove it from those parts too' });
    const reason = document.getElementById('data-save-blocked') as HTMLElement;
    expect(reason.textContent).toContain(used.pages.find((p) => p.id === 'home')?.title ?? 'Home');
    expect(reason.textContent).not.toMatch(/Some tables need a fix|crews|status/);
    expect(saveButton().getAttribute('aria-describedby')).toBe('data-save-blocked');
    expect(registered().nextBlocked).toBe('Fix the pages listed below in Design to go on.');
    fireEvent.click(press);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'Remove it from those parts too' })).toBeNull();
    fireEvent.click(within(screen.getByText('Took it out of the parts that used it.').parentElement as HTMLElement).getByRole('button', { name: 'Undo' }));
    await screen.findByRole('button', { name: 'Remove it from those parts too' });
  });

  it('names a removed field in a notice', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete field Size' }));
    expect(screen.getByText('Removed the field Size.')).toBeTruthy();
    expect(editorGroups().length).toBe(2);
  });

  it('uses Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z outside a text box, and Ctrl+S anywhere', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    const nav = screen.getByRole('navigation', { name: 'Tables' });
    fireEvent.keyDown(nav, { key: 'z', ctrlKey: true });
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Crews');
    fireEvent.keyDown(nav, { key: 'y', ctrlKey: true });
    expect(screen.queryByLabelText('Table name')).toBeNull();
    fireEvent.keyDown(nav, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(nav, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(screen.queryByLabelText('Table name')).toBeNull();
    fireEvent.keyDown(nav, { key: 'z', ctrlKey: true });

    // In a text box the key is left to the box.
    const name = screen.getByLabelText('Table name');
    fireEvent.change(name, { target: { value: 'Teams' } });
    fireEvent.keyDown(name, { key: 'z', ctrlKey: true });
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Teams');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.keyDown(name, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });

  it('answers Ctrl+S, Ctrl+Z and Ctrl+Y wherever focus is, but not under a dialog or in a text box (R-1)', async () => {
    show();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    expect(screen.queryByLabelText('Table name')).toBeNull();
    fireEvent.keyDown(outside, { key: 'z', ctrlKey: true });
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Crews');
    fireEvent.keyDown(outside, { key: 'y', ctrlKey: true });
    expect(screen.queryByLabelText('Table name')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(saveSpy).not.toHaveBeenCalled();

    // Ctrl+S saves from anywhere, once, and keeps the browser from saving the page.
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Teams' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(fireEvent.keyDown(outside, { key: 's', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

    // With a dialog open the keys wait.
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Squads' } });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(outside, { key: 's', ctrlKey: true });
    fireEvent.keyDown(outside, { key: 'z', ctrlKey: true });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Squads');
    dialog.remove();
    outside.remove();
  });

  it('sends the revision its tables were made from with every save (V2-1)', async () => {
    show();
    fireEvent.click(listAdd());
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy.mock.calls[0][1]).toEqual({ baseRevision: 3 });
  });

  it('Ctrl+S right after an edit saves it, or says why it cannot, and is never silent (V2-9)', async () => {
    show();
    fireEvent.click(listAdd());
    // The check of the draft has not run yet, so Save is still off, but the key saves anyway.
    expect(saveButton().disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    cleanup();
    saveSpy.mockReset();
    chrome.announce.mockReset();
    show();
    const name = screen.getByLabelText('Table name');
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    await waitFor(() => expect(chrome.announce).toHaveBeenCalledWith('Some tables need a fix before they can be saved.'));
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('Ctrl+S with nothing changed says so (V2-9)', async () => {
    show();
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    expect(chrome.announce).toHaveBeenCalledWith('Nothing to save.');
  });

  it('keeps edits made while its own save was on its way (V-1)', async () => {
    let finish: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    const value = (spec: AppSpec) => ({ record: recordOf(spec), spec, revision: 3, save: vi.fn(), reload: vi.fn(), setDirty: vi.fn() }) as unknown as WorkspaceValue;
    function SlowHost() {
      const [spec, setSpec] = useState(baseSpec());
      const v = value(spec);
      v.save = async (next: AppSpec): Promise<SaveResult> => {
        saveSpy(next);
        await slow;
        setSpec(next);
        return okAnswer(next);
      };
      return (
        <StepChromeContext.Provider value={chrome as StepChrome}>
          <WorkspaceContext.Provider value={v}>
            <DataTab />
          </WorkspaceContext.Provider>
        </StepChromeContext.Provider>
      );
    }
    render(<SlowHost />);
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Teams' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Teams and more' } });
    await act(async () => {
      finish();
      await slow;
    });
    // The first save came back; the later edit is still on screen and still counts as unsaved.
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Teams and more');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('settles a waiting "Save and remove data?" when the step goes, so a move is never stuck (V-3)', async () => {
    const { unmount } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    let outcome: Promise<{ ok: boolean; cancelled?: boolean }> | undefined;
    act(() => {
      outcome = registered().save();
    });
    await screen.findByRole('alertdialog');
    unmount();
    expect(await outcome).toMatchObject({ ok: false, cancelled: true });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('can still save after the step has gone, and never removes data without asking (V-2)', async () => {
    const { unmount } = show();
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Teams' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    const draft = registered();
    unmount();
    expect(await draft.save()).toMatchObject({ ok: true });
    expect((saveSpy.mock.calls[0][0] as AppSpec).tables[0].label).toBe('Teams');

    saveSpy.mockReset();
    const second = show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    const removing = registered();
    second.unmount();
    expect(await removing.save()).toMatchObject({ ok: false, reason: 'These changes remove data, so they need your OK first.' });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('reset throws the unsaved edits away, so Discard really discards (V-5)', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Teams' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    act(() => registered().reset?.());
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('Crews');
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it('asks before a save that removes data, and Keep editing saves nothing', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Save and remove data?')).toBeTruthy();
    expect(dialog.textContent).toContain('These changes delete preview data: Removes the table "Crews" and its data.');
    expect(saveSpy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('a save that throws ends as a failed save: the button is free again, the reason is shown and nothing is left unhandled (V4-7)', async () => {
    show();
    fireEvent.click(listAdd());
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    saveAnswer = () => {
      throw new Error('boom');
    };
    let outcome: Promise<{ ok: boolean; reason?: string }> | undefined;
    act(() => {
      outcome = registered().save();
    });
    expect(await outcome).toMatchObject({ ok: false, reason: 'Could not save. Your changes are still here. Try again.' });
    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(saveButton().textContent).toBe('Save'));
    saveAnswer = okAnswer;
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
  });

  it('saves after Save and remove, and the draft save reports cancelled when the person keeps editing', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete table' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    let outcome: Promise<{ ok: boolean; cancelled?: boolean }> | undefined;
    act(() => {
      outcome = registered().save();
    });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }));
    expect(await outcome).toMatchObject({ ok: false, cancelled: true });

    act(() => {
      outcome = registered().save();
    });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save and remove' }));
    expect(await outcome).toMatchObject({ ok: true });
    expect((saveSpy.mock.calls[0][0] as AppSpec).tables).toEqual([]);
  });

  it('does not ask when a save removes nothing', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'Teams' } });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('registers its draft with the shell and clears it on unmount', async () => {
    const { unmount } = show();
    expect(registered().nextBlocked).toBeNull();
    expect((await registered().save()).ok).toBe(true);
    expect(saveSpy).not.toHaveBeenCalled();
    unmount();
    expect(chrome.setDraft).toHaveBeenLastCalledWith('data', null);
  });

  it('points to Design to add a form, with the form on the shelf', () => {
    show();
    expect(screen.getByText('Records are added in your app, not here. Put a Form on a page, then add records in Preview.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a form in Design' }));
    expect(chrome.go).toHaveBeenCalledWith(`/apps/${recordOf(null).id}/design`, { state: { stepFocus: true, addEntry: 'part:RecordForm' } });
  });

  it('with no tables, says so and offers Add table', () => {
    show({ ...baseSpec(), tables: [], pages: baseSpec().pages });
    expect(screen.getByText('No tables yet. Add one to keep information in your app.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add table' })).toHaveLength(2);
  });
});
