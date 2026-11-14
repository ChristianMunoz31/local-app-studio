// GlobalSearch: the combobox over GET /api/data/_search. Fake timers drive the 250 ms wait; the data source is a fake with a
// `search` we control. Synthetic data only.
import axe from 'axe-core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider } from '../context.tsx';
import type { CatalogData, GlobalSearchGroup, GlobalSearchResult } from '../context.tsx';
import { getPartDefinition } from '../definitions.ts';
import { crewAppSpec, makeFakeData } from './fakeData.ts';
import { exampleCtx } from './fixtures.ts';

const GlobalSearch = PART_COMPONENTS.GlobalSearch;

const crews: GlobalSearchGroup = { table: 'crews', label: 'Crews', pageId: 'crew', total: 2, rows: [{ id: 'c1', title: 'Alpha' }, { id: 'c2', title: 'Alpine' }] };
const people: GlobalSearchGroup = { table: 'people', label: 'People', pageId: 'person', total: 1, rows: [{ id: 'p1', title: 'Alma' }] };

interface Mounted {
  search: ReturnType<typeof vi.fn<(term: string) => Promise<GlobalSearchResult>>>;
  navigate: ReturnType<typeof vi.fn>;
  input: HTMLInputElement;
}

function mount(answer: (term: string) => Promise<GlobalSearchResult>, props: Record<string, unknown> = {}, live = true): Mounted {
  const search = vi.fn(answer);
  const navigate = vi.fn();
  const value: CatalogData = { apiBase: '/api', spec: crewAppSpec(), pageId: 'home', recordId: null, dataSource: { ...makeFakeData(), search }, ...(live ? { navigate } : {}) };
  render(
    <CatalogPageProvider value={value}>
      <GlobalSearch {...props} />
    </CatalogPageProvider>,
  );
  return { search, navigate, input: screen.getByRole('combobox') as HTMLInputElement };
}

const ok = (...groups: GlobalSearchGroup[]) => (): Promise<GlobalSearchResult> => Promise.resolve({ groups });

/** Types a term and lets the 250 ms wait and the answer pass. */
async function type(input: HTMLInputElement, text: string): Promise<void> {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.classList.remove('light');
});

describe('GlobalSearch definition', () => {
  it('takes only a placeholder and binds nothing', () => {
    const def = getPartDefinition('GlobalSearch')!;
    expect(def).toMatchObject({ group: 'data', children: 'none', binds: [] });
    const schema = def.props(exampleCtx());
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ placeholder: 'Find anything' }).success).toBe(true);
    expect(schema.safeParse({ placeholder: 'x'.repeat(61) }).success).toBe(false);
    expect(schema.safeParse({ source: 'open_crews' }).success).toBe(false);
    expect(def.description.length).toBeLessThanOrEqual(200);
  });
});

describe('GlobalSearch when it can search', () => {
  it('is a combobox with a listbox, closed at first, named by its placeholder', () => {
    const { input } = mount(ok(crews), { placeholder: 'Find anything' });
    expect(input.disabled).toBe(false);
    expect(input.getAttribute('aria-label')).toBe('Find anything');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe(document.querySelector('[role="listbox"]')?.id);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('asks nothing until 250 ms after the last key, then asks once with the typed term', async () => {
    const { search, input } = mount(ok(crews));
    fireEvent.change(input, { target: { value: 'alp' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.change(input, { target: { value: 'alph' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('alph');
  });

  it('sends nothing for blanks or for under 3 characters, and says so in the live region', async () => {
    const { search, input } = mount(ok(crews));
    await type(input, '   ');
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
    await type(input, ' a ');
    await type(input, 'al');
    await type(input, '\u{1F642}\u{1F642}');
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Type 3 or more letters to search.');
    await type(input, ' alp ');
    expect(search).toHaveBeenCalledWith('alp');
    expect(screen.getByRole('status').textContent).toBe('2 results in 1 table');
  });

  it('lists the answer grouped by table, each option the record title, and says how many in a live region', async () => {
    const { input } = mount(ok(crews, people));
    await type(input, 'alp');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox');
    const groups = within(listbox).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby')).every((id) => id !== null && document.getElementById(id) !== null)).toBe(true);
    expect(within(groups[0]).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha', 'Alpine']);
    expect(within(groups[1]).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alma']);
    expect(screen.getByRole('status').textContent).toBe('3 results in 2 tables');
  });

  it('says the sum of the group totals, not of the rows shown', async () => {
    const many: GlobalSearchGroup = { table: 'crews', label: 'Crews', pageId: 'crew', total: 23, rows: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `Crew ${i}` })) };
    const { input } = mount(ok(many, { ...people, total: 17 }));
    await type(input, 'crew');
    expect(screen.getByRole('status').textContent).toBe('40 results in 2 tables');
  });

  it('does not open the popup when the answer arrives after focus left the box', async () => {
    const { input } = mount(ok(crews));
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'alp' } });
    fireEvent.blur(input);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('listbox', { hidden: true }).hidden).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('2 results in 1 table');
    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('says one result in one table in the singular', async () => {
    const { input } = mount(ok(people));
    await type(input, 'alp');
    expect(screen.getByRole('status').textContent).toBe('1 result in 1 table');
  });

  it('says Showing 5 of 23 for a group with more hits than rows', async () => {
    const many: GlobalSearchGroup = { table: 'crews', label: 'Crews', pageId: 'crew', total: 23, rows: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `Crew ${i}` })) };
    const { input } = mount(ok(many, people));
    await type(input, 'crew');
    expect(screen.getByText('Showing 5 of 23')).toBeTruthy();
    expect(screen.queryByText(/Showing 1 of/)).toBeNull();
  });

  it('moves with the arrow keys, wraps, and points aria-activedescendant at the option', async () => {
    const { input } = mount(ok(crews, people));
    await type(input, 'alp');
    const options = screen.getAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[2].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[2].id);
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });

  it('Enter opens the active record through navigate, with its record id, and clears the box', async () => {
    const { input, navigate } = mount(ok(crews, people));
    await type(input, 'alp');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('person', { withRecord: true, recordId: 'p1' });
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('a click on an option opens that record', async () => {
    const { input, navigate } = mount(ok(crews, people));
    await type(input, 'alp');
    fireEvent.click(screen.getByRole('option', { name: 'Alpine' }));
    expect(navigate).toHaveBeenCalledWith('crew', { withRecord: true, recordId: 'c2' });
  });

  it('Escape closes the list and keeps focus in the box; the arrows open it again', async () => {
    const { input, navigate } = mount(ok(crews));
    input.focus();
    await type(input, 'alp');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('alp');
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('says No records match. when nothing is found', async () => {
    const { input } = mount(ok());
    await type(input, 'zzz');
    expect(screen.getByRole('status').textContent).toBe('No records match.');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('shows the sentence of a failed search, with role alert, and no results', async () => {
    const { input } = mount(() => Promise.reject(new Error('The data could not be read.')));
    await type(input, 'alp');
    expect(screen.getByRole('alert').textContent).toBe('The data could not be read.');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('ignores an answer that arrives after the term changed', async () => {
    let release: (r: GlobalSearchResult) => void = () => {};
    const { input } = mount((term) => (term === 'alp' ? new Promise<GlobalSearchResult>((resolve) => { release = resolve; }) : Promise.resolve({ groups: [people] })));
    await type(input, 'alp');
    await type(input, 'alm');
    await act(async () => {
      release({ groups: [crews] });
    });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Alma']);
  });

  it('renders the same in the light theme, with kit tokens only', async () => {
    document.documentElement.classList.add('light');
    const { input } = mount(ok(crews));
    await type(input, 'alp');
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/\b(text|bg|border)-(gray|zinc|neutral|stone)-\d/);
    expect(html).not.toMatch(/\bslate-\d{3}\b/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe('GlobalSearch with axe', () => {
  const run = async (): Promise<string[]> => (await axe.run(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes[0]?.html ?? ''}`);

  it('has no violations closed, with the list open on an option, with no match and with an error', async () => {
    vi.useRealTimers();
    const first = mount(ok(crews, people));
    expect(await run()).toEqual([]);
    fireEvent.focus(first.input);
    fireEvent.change(first.input, { target: { value: 'alp' } });
    await screen.findAllByRole('option');
    fireEvent.keyDown(first.input, { key: 'ArrowDown' });
    expect(await run()).toEqual([]);
    cleanup();
    const none = mount(ok());
    fireEvent.change(none.input, { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No records match.'));
    expect(await run()).toEqual([]);
    cleanup();
    const failed = mount(() => Promise.reject(new Error('The data could not be read.')));
    fireEvent.focus(failed.input);
    fireEvent.change(failed.input, { target: { value: 'alp' } });
    await screen.findByRole('alert');
    expect(await run()).toEqual([]);
  });

  it('has no violations while disabled', async () => {
    vi.useRealTimers();
    mount(ok(crews), {}, false);
    expect(await run()).toEqual([]);
  });
});

describe('GlobalSearch when it cannot search', () => {
  it('is disabled and asks nothing on a page that is not live (the canvas, previews)', async () => {
    const { search, input } = mount(ok(crews), { placeholder: 'Search the app' }, false);
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe('Search the app');
    await type(input, 'alp');
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('is disabled when the data source has no search', () => {
    const value: CatalogData = { apiBase: '/api', spec: crewAppSpec(), pageId: 'home', recordId: null, dataSource: makeFakeData(), navigate: vi.fn() };
    render(
      <CatalogPageProvider value={value}>
        <GlobalSearch />
      </CatalogPageProvider>,
    );
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('combobox') as HTMLInputElement).placeholder).toBe('Search all records');
  });

  it('renders its box with no provider at all (the designer before it has data)', () => {
    render(<GlobalSearch />);
    expect((screen.getByRole('combobox') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps unknown props out of the markup', () => {
    const { container } = render(<GlobalSearch {...({ dangerouslySetInnerHTML: { __html: '<b>x</b>' }, className: 'evil', 'data-layer-id': 'g1' } as Record<string, unknown>)} />);
    expect(container.innerHTML).not.toContain('evil');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('[data-layer-id="g1"]')).not.toBeNull();
  });
});
