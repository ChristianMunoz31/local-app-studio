// Inline editing in the DataTable part (ADR-017): off by default, live only, the same input and save as the form.
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider } from '../context.tsx';
import type { CatalogData, DataRow } from '../context.tsx';
import { checkLayer } from '../validateLayout.ts';
import { getPartDefinition } from '../definitions.ts';
import { choiceKey, choicePropsOf, choiceValue, readChoice } from '../../studio/lib/choiceProps.ts';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { makeFakeData, seed } from './fakeData.ts';
import { crewCtx, crewSpec, layer } from './fixtures.ts';

afterEach(cleanup);

/** Crew Roster with two more fields on crews: an auto numbered code and a yes/no. */
function spec(): AppSpec {
  const input = crewSpec();
  const tables = (input.tables ?? []).map((t) =>
    t.id === 'crews'
      ? {
          ...t,
          fields: [...t.fields, { id: 'code', label: 'Code', type: 'text' as const, autoNumber: { prefix: 'C-' } }, { id: 'ready', label: 'Ready', type: 'boolean' as const }],
        }
      : t,
  );
  const result = validateAppSpec({ ...input, tables });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const crews = (): DataRow[] =>
  seed().crews.map((c, i) => ({ ...c, code: `C-${i + 1}`, ready: false }));

const table = (props: Record<string, unknown> = {}): LayoutLayer =>
  layer('t', 'DataTable', { source: 'open_crews', columns: ['name', 'size', 'status', 'ready', 'code', 'created_at'], ...props });

function mount(node: LayoutLayer, { live = true, data = makeFakeData({ ...seed(), crews: crews() }) }: { live?: boolean; data?: ReturnType<typeof makeFakeData> } = {}) {
  const navigate = vi.fn();
  const value: CatalogData = { apiBase: '/api', spec: spec(), pageId: 'crew', recordId: null, dataSource: data, ...(live ? { navigate } : {}) };
  const view = render(
    <CatalogPageProvider value={value}>{createElement(PART_COMPONENTS.DataTable, { ...node.props, 'data-testid': node.id })}</CatalogPageProvider>,
  );
  return { ...view, data, navigate };
}

const updates = (data: ReturnType<typeof makeFakeData>) => data.calls.filter((c) => c.method === 'update');
const edit = (name: string) => screen.findByRole('button', { name });

describe('off by default', () => {
  it('renders the markup it always did when edit is absent, off, or the page is not live', async () => {
    const html = async (props: Record<string, unknown>, live = true): Promise<string> => {
      cleanup();
      const { container } = mount(table(props), { live });
      await screen.findByText('Alpha');
      return container.innerHTML.replace(/_r_[0-9a-z]+_/g, 'ID');
    };
    const plain = await html({});
    expect(await html({ edit: 'off' })).toBe(plain);
    expect(await html({ edit: 'cells' }, false)).toBe(plain);
    expect(plain).not.toContain('Edit Name');
  });
});

describe('on and live', () => {
  it('gives each editable cell a button that says what it edits, and none to created_at or an auto numbered field', async () => {
    mount(table({ edit: 'cells' }));
    await edit('Edit Status of Alpha');
    const alpha = screen.getByText('Alpha', { selector: 'span' }).closest('tr')!;
    expect(within(alpha).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Edit Name of Alpha',
      'Edit Size of Alpha',
      'Edit Status of Alpha',
      'Edit Ready of Alpha',
    ]);
    expect(within(alpha).getAllByRole('cell').map((c) => c.textContent).slice(0, 5)).toEqual(['Alpha', '4', 'active', 'No', 'C-1']);
  });

  it('edits a text cell: Enter saves exactly that field, the row refreshes and focus returns to the cell', async () => {
    const { data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Name of Alpha'));
    const input = screen.getByLabelText('Name of Alpha') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Alpha');
    fireEvent.change(input, { target: { value: 'Alfa' } });
    const lists = data.calls.filter((c) => c.method === 'list' && c.table === 'crews').length;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.disabled).toBe(true);
    await waitFor(() => expect(screen.queryByLabelText('Name of Alpha')).toBeNull());
    expect(updates(data)).toEqual([{ method: 'update', table: 'crews', arg: { id: 'c1', values: { name: 'Alfa' } } }]);
    await waitFor(() => expect(data.calls.filter((c) => c.method === 'list' && c.table === 'crews').length).toBeGreaterThan(lists));
    await screen.findByText('Alfa');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name of Alfa' }));
    expect(screen.getByRole('status').textContent).toBe('Saved.');
  });

  it('edits a select cell with the options of the form', async () => {
    const { data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Status of Alpha'));
    const select = screen.getByLabelText('Status of Alpha') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'active', 'paused']);
    fireEvent.change(select, { target: { value: 'paused' } });
    fireEvent.keyDown(select, { key: 'Enter' });
    await waitFor(() => expect(updates(data)).toHaveLength(1));
    expect(updates(data)[0].arg).toEqual({ id: 'c1', values: { status: 'paused' } });
  });

  it('edits a number cell and sends a number', async () => {
    const { data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Size of Alpha'));
    const input = screen.getByLabelText('Size of Alpha') as HTMLInputElement;
    expect(input.type).toBe('number');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(updates(data)).toHaveLength(1));
    expect(updates(data)[0].arg).toEqual({ id: 'c1', values: { size: 9 } });
  });

  it('edits a yes/no cell with a checkbox and saves when focus leaves', async () => {
    const { data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Ready of Alpha'));
    const box = screen.getByLabelText('Ready of Alpha') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    fireEvent.click(box);
    fireEvent.focusOut(box);
    await waitFor(() => expect(updates(data)).toHaveLength(1));
    expect(updates(data)[0].arg).toEqual({ id: 'c1', values: { ready: true } });
    await waitFor(() => expect(screen.queryByLabelText('Ready of Alpha')).toBeNull());
  });

  it('Escape cancels without a request and returns focus to the cell button', async () => {
    const { data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Name of Alpha'));
    const input = screen.getByLabelText('Name of Alpha');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Name of Alpha')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Name of Alpha' }));
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(updates(data)).toHaveLength(0);
  });

  it('sends nothing when the value did not change, and refuses to empty a required field', async () => {
    const { data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Name of Alpha'));
    fireEvent.keyDown(screen.getByLabelText('Name of Alpha'), { key: 'Enter' });
    expect(screen.queryByLabelText('Name of Alpha')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Name of Alpha' }));
    fireEvent.change(screen.getByLabelText('Name of Alpha'), { target: { value: '  ' } });
    fireEvent.keyDown(screen.getByLabelText('Name of Alpha'), { key: 'Enter' });
    expect((await screen.findByRole('alert')).textContent).toBe('Name is required.');
    expect(updates(data)).toHaveLength(0);
  });

  it('shows the server sentence next to the cell, keeps the input open with its value, and a retry can succeed', async () => {
    const { data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Size of Alpha'));
    const input = screen.getByLabelText('Size of Alpha') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-3' } });
    data.failNextWrite('Size must be at least 1.', 'size');
    fireEvent.keyDown(input, { key: 'Enter' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Size must be at least 1.');
    expect(alert.closest('td')).toBe(input.closest('td'));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    await waitFor(() => expect(input.disabled).toBe(false));
    expect((screen.getByLabelText('Size of Alpha') as HTMLInputElement).value).toBe('-3');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByLabelText('Size of Alpha')).toBeNull());
    expect(updates(data)).toHaveLength(2);
  });

  it('shows the words of the rules a save ran in the notice line', async () => {
    const data = makeFakeData({ ...seed(), crews: crews() });
    const update = data.update.bind(data);
    data.update = async (t, id, values) => {
      const row = await update(t, id, values);
      Object.defineProperty(row, 'applied', { value: [{ field: 'ready', label: 'Ready', to: true, words: 'Ready was set to yes.' }], enumerable: false });
      return row;
    };
    mount(table({ edit: 'cells' }), { data });
    fireEvent.click(await edit('Edit Status of Alpha'));
    fireEvent.change(screen.getByLabelText('Status of Alpha'), { target: { value: 'paused' } });
    fireEvent.keyDown(screen.getByLabelText('Status of Alpha'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved. Ready was set to yes.'));
  });

  it('shows the most recent message and announces an identical second save again', async () => {
    const { navigate } = mount(table({ edit: 'cells', rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } }));
    navigate.mockImplementation(() => ({ ok: false, message: 'Open a record first.' }));
    const save = async (label: string, field: string, value: string): Promise<void> => {
      fireEvent.click(await edit(label));
      fireEvent.change(screen.getByLabelText(field), { target: { value } });
      fireEvent.keyDown(screen.getByLabelText(field), { key: 'Enter' });
    };
    await save('Edit Size of Alpha', 'Size of Alpha', '7');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
    // Opening the next cell drops the old line, so a second identical save is a new message.
    fireEvent.click(await edit('Edit Size of Gamma'));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(screen.getByLabelText('Size of Gamma'), { target: { value: '8' } });
    fireEvent.keyDown(screen.getByLabelText('Size of Gamma'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
  });

  it('a later Saved. replaces the line a row action left, and a later row action replaces Saved.', async () => {
    // An edit-form action on another table has no record to open: that refusal is the row action's notice.
    mount(table({ edit: 'cells', rowAction: { action: 'open-form', table: 'people', mode: 'edit' } }));
    const line = (): string => screen.queryByRole('status')?.textContent ?? '';
    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));
    const refusal = line();
    expect(refusal).not.toBe('');
    fireEvent.click(await edit('Edit Size of Alpha'));
    fireEvent.change(screen.getByLabelText('Size of Alpha'), { target: { value: '9' } });
    fireEvent.keyDown(screen.getByLabelText('Size of Alpha'), { key: 'Enter' });
    await waitFor(() => expect(line()).toBe('Saved.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));
    expect(line()).toBe(refusal);
  });

  it('keeps a rowAction: a row click runs it, an edit click does not, and the first column keeps its action button', async () => {
    const { navigate } = mount(table({ edit: 'cells', rowAction: { action: 'navigate', pageId: 'crew', withRecord: true } }));
    const first = await screen.findByRole('button', { name: 'Alpha' });
    expect(screen.queryByRole('button', { name: 'Edit Name of Alpha' })).toBeNull();
    fireEvent.click(first);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('crew', { withRecord: true, recordId: 'c1' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Size of Alpha' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Size of Alpha'));
    expect(navigate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Gamma').closest('tr')!);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('has no axe violations while a cell is open with a problem showing', async () => {
    const { container, data } = mount(table({ edit: 'cells' }));
    fireEvent.click(await edit('Edit Size of Alpha'));
    fireEvent.change(screen.getByLabelText('Size of Alpha'), { target: { value: '0' } });
    data.failNextWrite('Size must be at least 1.', 'size');
    fireEvent.keyDown(screen.getByLabelText('Size of Alpha'), { key: 'Enter' });
    await screen.findByRole('alert');
    await act(async () => {});
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('not live', () => {
  it('shows plain cells: no edit buttons', async () => {
    mount(table({ edit: 'cells' }), { live: false });
    await screen.findByText('Alpha');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('the prop in the spec and in Design', () => {
  const check = (edit: unknown) => checkLayer(layer('root', 'Page', {}, [layer('t', 'DataTable', { source: 'open_crews', edit } as LayoutLayer['props'])]), crewCtx(), 'layer');

  it('the stored layer validation accepts off and cells and refuses anything else', () => {
    expect(check('cells')).toEqual([]);
    expect(check('off')).toEqual([]);
    expect(check('rows').map((i) => i.code)).toEqual(['invalid_props']);
    expect(check(true).map((i) => i.code)).toEqual(['invalid_props']);
  });

  it('is Design only: not in the helper-facing props', () => {
    const def = getPartDefinition('DataTable')!;
    expect(Object.keys(def.props(crewCtx()).shape)).toEqual(['source', 'columns', 'rowAction', 'pageSize', 'emptyText']);
    expect(def.props(crewCtx()).safeParse({ source: 'open_crews', edit: 'cells' }).success).toBe(false);
    expect(Object.keys((def.designProps ?? def.props)(crewCtx()).shape)).toEqual(['source', 'columns', 'rowAction', 'pageSize', 'emptyText', 'edit']);
  });

  it('is offered in Design with plain labels, defaults to No, and refuses other values', () => {
    const [c] = choicePropsOf('DataTable');
    expect(choiceKey(c)).toBe('props.edit');
    expect(c.label).toBe('Edit in the table');
    expect(c.options).toEqual([
      { value: 'off', label: 'No' },
      { value: 'cells', label: 'Click a cell to edit' },
    ]);
    expect(choiceValue(layer('t', 'DataTable', { source: 'open_crews' }), c, crewCtx())).toBe('off');
    expect(choiceValue(layer('t', 'DataTable', { source: 'open_crews', edit: 'cells' }), c, crewCtx())).toBe('cells');
    expect(readChoice('DataTable', c, 'cells', crewCtx())).toEqual({ ok: true, value: 'cells' });
    expect(readChoice('DataTable', c, 'all', crewCtx()).ok).toBe(false);
  });
});
