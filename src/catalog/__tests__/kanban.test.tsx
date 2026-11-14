// Kanban: columns from the options of a choice field, cards grouped by value, a move that saves exactly one field through the
// data layer (keyboard menu, Arrow keys and native drag), the words that come back, and a refused save. Synthetic data only.
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider } from '../context.tsx';
import type { CatalogData, DataRow } from '../context.tsx';
import { getPartDefinition } from '../definitions.ts';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpec, AppSpecInput } from '@local-app-studio/runtime/spec/schema.ts';
import { makeFakeData, seed } from './fakeData.ts';
import { crewSpec, exampleCtx } from './fixtures.ts';

const Kanban = PART_COMPONENTS.Kanban;

/** Crew Roster with a list of every crew (no condition), a list of people, and optionally a required status. */
function boardSpec(requiredStatus = false, statusOptions?: string[]): AppSpec {
  const base = crewSpec();
  const input: AppSpecInput = {
    ...base,
    tables: (base.tables ?? []).map((t) => (t.id === 'crews' && statusOptions !== undefined ? { ...t, fields: t.fields.map((f) => (f.id === 'status' ? { ...f, options: statusOptions } : f)) } : t.id === 'crews' && requiredStatus ? { ...t, fields: t.fields.map((f) => (f.id === 'status' ? { ...f, required: true } : f)) } : t)),
    pages: base.pages.map((p) =>
      p.id === 'home'
        ? { ...p, sources: [...(p.sources ?? []), { id: 'all_crews', table: 'crews', orderBy: [{ field: 'name', dir: 'asc' as const }], limit: 50 }, { id: 'all_people', table: 'people', limit: 50 }] }
        : p,
    ),
  };
  const result = validateAppSpec(input);
  if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  return result.value;
}

interface Options {
  props?: Record<string, unknown>;
  data?: ReturnType<typeof makeFakeData>;
  live?: boolean;
  required?: boolean;
  statusOptions?: string[];
}

function mount(options: Options = {}) {
  const data = options.data ?? makeFakeData();
  const navigate = vi.fn();
  const value: CatalogData = { apiBase: '/api', spec: boardSpec(options.required, options.statusOptions), pageId: 'home', recordId: null, dataSource: data, ...(options.live === false ? {} : { navigate }) };
  const view = render(
    <CatalogPageProvider value={value}>
      <Kanban source="all_crews" field="status" titleField="name" {...options.props} />
    </CatalogPageProvider>,
  );
  return { ...view, data };
}

const headings = (): string[] => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
const column = (name: string): HTMLElement => screen.getByRole('region', { name });
const cardsIn = (name: string): string[] => within(column(name)).queryAllByRole('listitem').filter((li) => li.querySelector('[data-move]') !== null).map((li) => li.querySelector('span')?.textContent ?? '');
const updates = (data: ReturnType<typeof makeFakeData>) => data.calls.filter((c) => c.method === 'update');

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('light');
});

describe('Kanban columns and cards', () => {
  it('makes a column for each option in order, plus one for no value, and puts each card in its column', async () => {
    mount();
    await screen.findByText('Alpha');
    expect(headings()).toEqual(['active', 'paused', 'No Status']);
    expect(cardsIn('active')).toEqual(['Alpha', 'Gamma']);
    expect(cardsIn('paused')).toEqual(['Beta']);
    expect(cardsIn('No Status')).toEqual([]);
    expect(screen.getByRole('region', { name: 'Status board' })).toBeTruthy();
  });

  it('keeps an option named none apart from the empty column, in the columns and in the Move menu', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rows = seed();
    rows.crews = [...rows.crews, { id: 'c4', name: 'Delta', size: 1, lead_id: null, status: 'none', created_at: '2026-02-04T00:00:00.000Z', updated_at: '2026-02-04T00:00:00.000Z' }, { id: 'c5', name: 'Echo', size: 1, lead_id: null, status: null, created_at: '2026-02-05T00:00:00.000Z', updated_at: '2026-02-05T00:00:00.000Z' }];
    mount({ data: makeFakeData(rows), statusOptions: ['active', 'none', 'paused'] });
    await screen.findByText('Delta');
    expect(headings()).toEqual(['active', 'none', 'paused', 'No Status']);
    expect(cardsIn('none')).toEqual(['Delta']);
    expect(cardsIn('No Status')).toEqual(['Echo']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Alpha' }));
    expect(within(screen.getByRole('menu', { name: 'Move Alpha to' })).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['none', 'paused', 'No Status']);
    const keyWarnings = errors.mock.calls.filter((call) => String(call[0]).includes('same key'));
    errors.mockRestore();
    expect(keyWarnings).toEqual([]);
  });

  it('shows the cards that have no value in the empty column', async () => {
    const rows = seed();
    rows.crews = [...rows.crews, { id: 'c4', name: 'Delta', size: 1, lead_id: null, status: null, created_at: '2026-02-04T00:00:00.000Z', updated_at: '2026-02-04T00:00:00.000Z' }];
    mount({ data: makeFakeData(rows) });
    await screen.findByText('Delta');
    expect(cardsIn('No Status')).toEqual(['Delta']);
  });

  it('leaves the empty column out when the field is required and no card lacks a value', async () => {
    mount({ required: true });
    await screen.findByText('Alpha');
    expect(headings()).toEqual(['active', 'paused']);
  });

  it('shows the subtitle, and says Showing N of TOTAL when the source holds more than it loaded', async () => {
    const data = makeFakeData();
    const list = data.list.bind(data);
    data.list = async (table, q) => ({ rows: (await list(table, q)).rows, total: 9 });
    mount({ data, props: { subtitleField: 'size' } });
    await screen.findByText('Alpha');
    expect(screen.getByText('Showing 3 of 9.')).toBeTruthy();
    expect(screen.getByText('Alpha').nextElementSibling?.textContent).toBe('4');
  });

  it('says so when there are no records, with the author text when given', async () => {
    mount({ data: makeFakeData({ people: [], crews: [] }), props: { emptyText: 'No crews to show' } });
    expect(await screen.findByText('No crews to show')).toBeTruthy();
    cleanup();
    mount({ data: makeFakeData({ people: [], crews: [] }) });
    expect(await screen.findByText('Nothing on the board yet.')).toBeTruthy();
  });

  it('says the table has no choice field when the field is not one', async () => {
    mount({ props: { source: 'all_people', field: 'name' }, data: makeFakeData() });
    expect(await screen.findByText('This table has no choice field to make columns from.')).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('shows an error line when the data source rejects', async () => {
    const data = makeFakeData();
    data.list = () => Promise.reject(new Error('The data could not be read.'));
    mount({ data });
    expect((await screen.findByRole('alert')).textContent).toBe('The data could not be read.');
  });

  it('uses kit tokens only, in the light theme too, and keeps unknown props out of the markup', async () => {
    document.documentElement.classList.add('light');
    const { container } = mount({ props: { dangerouslySetInnerHTML: { __html: '<form>x</form>' }, className: 'evil', 'data-layer-id': 'k1' } });
    await screen.findByText('Alpha');
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(text|bg|border)-(gray|zinc|neutral|stone)-\d/);
    expect(html).not.toMatch(/\bslate-\d{3}\b/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(html).not.toContain('evil');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[data-layer-id="k1"]')).not.toBeNull();
  });
});

describe('Kanban moves', () => {
  it('moves a card with Arrow Right on its Move button, saving exactly the one field, and announces it', async () => {
    const { data } = mount();
    await screen.findByText('Alpha');
    const button = screen.getByRole('button', { name: 'Move Alpha' });
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Moved Alpha to paused.'));
    expect(updates(data)).toHaveLength(1);
    expect(updates(data)[0].arg).toEqual({ id: 'c1', values: { status: 'paused' } });
    expect(Object.keys((updates(data)[0].arg as { values: DataRow }).values)).toEqual(['status']);
    await waitFor(() => expect(cardsIn('paused')).toEqual(['Alpha', 'Beta']));
    expect(cardsIn('active')).toEqual(['Gamma']);
    // The card is a new element in its new column; focus follows it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Alpha' }));
  });

  it('Arrow Left goes back, and does nothing at the first column', async () => {
    const { data } = mount();
    await screen.findByText('Alpha');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Alpha' }), { key: 'ArrowLeft' });
    expect(updates(data)).toHaveLength(0);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Beta' }), { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Moved Beta to active.'));
    expect(updates(data)[0].arg).toEqual({ id: 'c2', values: { status: 'active' } });
  });

  it('opens a menu of the other columns from the Move button, and a choice moves the card', async () => {
    const { data } = mount();
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Move Beta' }));
    const menu = screen.getByRole('menu', { name: 'Move Beta to' });
    expect(screen.getByRole('button', { name: 'Move Beta' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['active', 'No Status']);
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[1]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'No Status' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Moved Beta to No Status.'));
    expect(updates(data)[0].arg).toEqual({ id: 'c2', values: { status: null } });
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(cardsIn('No Status')).toEqual(['Beta']));
  });

  it('Escape closes the menu and puts focus back on the Move button, with nothing saved', async () => {
    const { data } = mount();
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Move Alpha' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Alpha' })));
    expect(updates(data)).toHaveLength(0);
  });

  it('does not offer the empty column when the field is required', async () => {
    mount({ required: true });
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Move Alpha' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['paused']);
  });

  it('moves a card dropped on another column with the pointer (native drag and drop)', async () => {
    const { data } = mount();
    await screen.findByText('Alpha');
    const card = screen.getByRole('button', { name: 'Move Alpha' }).closest('li') as HTMLElement;
    expect(card.getAttribute('draggable')).toBe('true');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'Alpha');
    // Over its own column: not a drop target.
    const own = fireEvent.dragOver(column('active'), { dataTransfer });
    expect(own).toBe(true);
    const over = fireEvent.dragOver(column('paused'), { dataTransfer });
    expect(over).toBe(false);
    expect(dataTransfer.dropEffect).toBe('move');
    fireEvent.drop(column('paused'), { dataTransfer });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Moved Alpha to paused.'));
    expect(updates(data)[0].arg).toEqual({ id: 'c1', values: { status: 'paused' } });
  });

  it('ignores a drop on the column the card is already in, and a drop with no drag', async () => {
    const { data } = mount();
    await screen.findByText('Alpha');
    fireEvent.drop(column('paused'));
    fireEvent.dragStart(screen.getByRole('button', { name: 'Move Alpha' }).closest('li') as HTMLElement, { dataTransfer: { setData: vi.fn() } });
    fireEvent.drop(column('active'));
    expect(updates(data)).toHaveLength(0);
  });

  it('shows the words of the rules a save ran, after the move', async () => {
    const data = makeFakeData();
    const update = data.update.bind(data);
    data.update = async (table, id, values) => {
      const row = await update(table, id, values);
      Object.defineProperty(row, 'applied', { value: [{ field: 'closed_on', label: 'Closed on', to: 'today', words: 'Closed on was set to today.' }], enumerable: false });
      return row;
    };
    mount({ data });
    await screen.findByText('Alpha');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Alpha' }), { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Moved Alpha to paused. Closed on was set to today.'));
  });

  it('shows the sentence of a refused save with role alert and leaves the card where it was', async () => {
    const data = makeFakeData();
    mount({ data });
    await screen.findByText('Alpha');
    data.failNextWrite('Status cannot be paused while the crew has open tasks.', 'status');
    const button = screen.getByRole('button', { name: 'Move Alpha' });
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Status cannot be paused while the crew has open tasks.');
    expect(updates(data)).toHaveLength(1);
    expect(cardsIn('active')).toEqual(['Alpha', 'Gamma']);
    expect(cardsIn('paused')).toEqual(['Beta']);
    expect(screen.getByRole('status').textContent).toBe('');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Alpha' })));
    // A later good move clears the sentence.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Alpha' }), { key: 'ArrowRight' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('status').textContent).toBe('Moved Alpha to paused.');
  });
});

describe('Kanban where the page is not live', () => {
  it('shows the cards and moves nothing: Move buttons are disabled, keys and drops do nothing', async () => {
    const { data } = mount({ live: false });
    await screen.findByText('Alpha');
    expect(cardsIn('active')).toEqual(['Alpha', 'Gamma']);
    const button = screen.getByRole('button', { name: 'Move Alpha' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const card = button.closest('li') as HTMLElement;
    expect(card.getAttribute('draggable')).toBe('false');
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    fireEvent.dragStart(card, { dataTransfer: { setData: vi.fn() } });
    fireEvent.drop(column('paused'));
    expect(updates(data)).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Move / }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('Kanban with axe', () => {
  const run = async (container: HTMLElement): Promise<string[]> => (await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`);

  it('has no violations: the board, its menu open, a refused save, and the board where the page is not live', async () => {
    const data = makeFakeData();
    const { container } = mount({ data });
    await screen.findByText('Alpha');
    expect(await run(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Move Beta' }));
    expect(await run(container)).toEqual([]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    data.failNextWrite('Status cannot be paused while the crew has open tasks.', 'status');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Move Alpha' }), { key: 'ArrowRight' });
    await screen.findByRole('alert');
    expect(await run(container)).toEqual([]);
    cleanup();
    const idle = mount({ live: false });
    await screen.findByText('Alpha');
    expect(await run(idle.container)).toEqual([]);
  });
});

describe('Kanban definition', () => {
  it('binds a list source and an editable choice field, and takes the title and subtitle fields', () => {
    const def = getPartDefinition('Kanban')!;
    expect(def).toMatchObject({ group: 'data', children: 'none' });
    expect(def.binds).toEqual([
      { prop: 'source', kind: 'source', mode: 'list' },
      { prop: 'field', kind: 'field', of: 'source', fieldTypes: ['select'], editable: true },
      { prop: 'titleField', kind: 'field', of: 'source' },
      { prop: 'subtitleField', kind: 'field', of: 'source' },
    ]);
    const schema = def.props(exampleCtx());
    expect(schema.safeParse(def.example.props).success).toBe(true);
    expect(schema.safeParse({ source: 'open_crews', field: 'name' }).success).toBe(false);
    expect(schema.safeParse({ source: 'open_crews', field: 'status', emptyText: 'x'.repeat(121) }).success).toBe(false);
    expect(def.description.length).toBeLessThanOrEqual(200);
  });
});
