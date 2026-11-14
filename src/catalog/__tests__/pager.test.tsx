// The Previous and Next pager shared by the DataTable and RecordList parts (phase 33): range text, paging, focus and axe.
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import axe from 'axe-core';
import { Pager } from '@local-app-studio/runtime/catalog/parts/Pager.tsx';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider, useMutations, useSourceFilters } from '../context.tsx';
import type { CatalogData, DataRow } from '../context.tsx';
import { sourcePageSize } from '@local-app-studio/runtime/catalog/parts/format.ts';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import { makeFakeData } from './fakeData.ts';
import { crewSpec } from './fixtures.ts';

afterEach(cleanup);

/** Crew Roster whose list source open_crews has the given limit (and no filter, so every crew shows). */
function spec(limit?: number): AppSpec {
  const input = crewSpec();
  const pages = input.pages.map((p) =>
    p.id === 'crew' ? { ...p, sources: [{ id: 'open_crews', table: 'crews', ...(limit === undefined ? {} : { limit }) }, { id: 'one_crew', table: 'crews', mode: 'record' as const }] } : p,
  );
  const result = validateAppSpec({ ...input, pages });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

const crews = (n: number): DataRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Crew ${String(i).padStart(2, '0')}`, size: 1, status: 'active', lead_id: null }));

const lists = (data: ReturnType<typeof makeFakeData>) => data.calls.filter((c) => c.method === 'list' && c.table === 'crews').map((c) => c.arg as { offset?: number; limit?: number });

type Part = 'RecordList' | 'DataTable';
const PROPS: Record<Part, Record<string, unknown>> = {
  RecordList: { source: 'open_crews', titleField: 'name' },
  DataTable: { source: 'open_crews', columns: ['name'], pageSize: 3 },
};

/** Buttons that act on the page state the way a delete action or a filter control does. */
function Harness({ onSearch }: { onSearch?: boolean }) {
  const { remove } = useMutations();
  const { setSearch } = useSourceFilters('open_crews');
  return (
    <div>
      <button type="button" onClick={() => void remove('crews', 'c6')}>
        Drop c6
      </button>
      {onSearch && (
        <button type="button" onClick={() => setSearch('Crew', ['name'])}>
          Search crews
        </button>
      )}
    </div>
  );
}

function mount(part: Part, n: number, limit: number | null = 3, normalized = true, slow = false) {
  const data = makeFakeData({ people: [], crews: crews(n) });
  const gate = { release: (): void => {}, held: false };
  if (slow) {
    const list = data.list.bind(data);
    data.list = async (table, q) => {
      const out = await list(table, q);
      if ((q.offset ?? 0) > 0 && gate.held) await new Promise<void>((resolve) => { gate.release = resolve; });
      return out;
    };
  }
  const value: CatalogData = { apiBase: '/api', spec: normalized ? spec(limit ?? undefined) : rawSpec(limit ?? undefined), pageId: 'crew', recordId: null, dataSource: data, navigate: () => {} };
  const view = render(
    <CatalogPageProvider value={value}>
      {createElement(PART_COMPONENTS[part], PROPS[part])}
      <Harness onSearch />
    </CatalogPageProvider>,
  );
  return { ...view, data, gate };
}

/** The same spec without validateAppSpec, so a source has no limit field filled in. */
function rawSpec(limit?: number): AppSpec {
  const input = crewSpec();
  const pages = input.pages.map((p) =>
    p.id === 'crew' ? { ...p, sources: [{ id: 'open_crews', table: 'crews', ...(limit === undefined ? {} : { limit }) }, { id: 'one_crew', table: 'crews', mode: 'record' as const }] } : p,
  );
  return { ...input, pages } as unknown as AppSpec;
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('sourcePageSize', () => {
  it('follows the server rule: the limit, cut at 200, else 50', () => {
    expect([sourcePageSize(3), sourcePageSize(500), sourcePageSize(undefined), sourcePageSize(0), sourcePageSize(2.5), sourcePageSize('9')]).toEqual([3, 200, 50, 50, 50, 50]);
  });
});

describe.each<Part>(['RecordList', 'DataTable'])('%s pager', (part) => {
  it('shows no pager when everything fits on one page', async () => {
    mount(part, 3);
    await screen.findByText('Crew 00');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pages by one page, asks for that offset, and bounds the buttons at both ends', async () => {
    const { data } = mount(part, 7);
    await screen.findByText('Crew 00');
    expect(screen.getByRole('status').textContent).toBe('1 to 3 of 7');
    expect(button('Previous').disabled).toBe(true);
    expect(lists(data).at(-1)).toMatchObject({ limit: 3 });
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 03');
    expect(screen.getByRole('status').textContent).toBe('4 to 6 of 7');
    expect(lists(data).at(-1)).toMatchObject({ offset: 3, limit: 3 });
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 06');
    expect(screen.getByRole('status').textContent).toBe('7 to 7 of 7');
    expect(button('Next').disabled).toBe(true);
    fireEvent.click(button('Previous'));
    await screen.findByText('Crew 03');
    expect(lists(data).at(-1)).toMatchObject({ offset: 3 });
    fireEvent.click(button('Previous'));
    await screen.findByText('Crew 00');
    expect(button('Previous').disabled).toBe(true);
  });

  it('keeps focus on a usable button when the one clicked reaches its end', async () => {
    mount(part, 7);
    await screen.findByText('Crew 00');
    button('Next').focus();
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 03');
    expect(document.activeElement).toBe(button('Next'));
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 06');
    expect(button('Next').disabled).toBe(true);
    expect(document.activeElement).toBe(button('Previous'));
    fireEvent.click(button('Previous'));
    await screen.findByText('Crew 03');
    fireEvent.click(button('Previous'));
    await screen.findByText('Crew 00');
    expect(button('Previous').disabled).toBe(true);
    expect(document.activeElement).toBe(button('Next'));
  });

  it('names the pager, announces the range politely and has no axe violations', async () => {
    const { container } = mount(part, 7);
    await screen.findByText('Crew 00');
    expect(screen.getByRole('group', { name: 'Crews pages' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 to 3 of 7');
    const result = await axe.run(container);
    expect(result.violations.map((v) => v.id)).toEqual([]);
    fireEvent.click(button('Next'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('4 to 6 of 7'));
  });
});

describe.each<Part>(['RecordList', 'DataTable'])('%s pager edge cases', (part) => {
  it('moves back to the last page that has rows when the last page empties after a delete', async () => {
    const { data } = mount(part, 7);
    await screen.findByText('Crew 00');
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 03');
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 06');
    fireEvent.click(button('Drop c6'));
    await screen.findByText('Crew 05');
    expect(screen.queryByText('Nothing here yet.')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('4 to 6 of 6');
    expect(lists(data).at(-1)).toMatchObject({ offset: 3 });
  });

  it('never shows a range past the total while the next page loads', async () => {
    const { data, gate } = mount(part, 7, 3, true, true);
    await screen.findByText('Crew 00');
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 03');
    gate.held = true;
    const seen: string[] = [];
    const status = screen.getByRole('status');
    const watch = new MutationObserver(() => seen.push(status.textContent ?? ''));
    watch.observe(status, { childList: true, characterData: true, subtree: true });
    fireEvent.click(button('Next'));
    seen.push(status.textContent ?? '');
    await waitFor(() => expect(lists(data).at(-1)).toMatchObject({ offset: 6 }));
    seen.push(status.textContent ?? '');
    gate.release();
    await screen.findByText('Crew 06');
    watch.disconnect();
    seen.push(screen.getByRole('status').textContent ?? '');
    expect(seen.filter((t) => t === '7 to 9 of 7')).toEqual([]);
    expect(seen.at(-1)).toBe('7 to 7 of 7');
  });

  it('marks the group busy and sends one request for two quick Next clicks', async () => {
    const { data, gate } = mount(part, 9, 3, true, true);
    await screen.findByText('Crew 00');
    gate.held = true;
    const before = lists(data).length;
    fireEvent.click(button('Next'));
    fireEvent.click(button('Next'));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Crews pages' }).getAttribute('aria-busy')).toBe('true'));
    gate.release();
    await screen.findByText('Crew 03');
    const after = lists(data).slice(before);
    expect(after.map((q) => q.offset)).toEqual([3]);
    expect(screen.getByRole('group', { name: 'Crews pages' }).getAttribute('aria-busy')).toBe('false');
  });

  it('goes back to the first page when a search changes', async () => {
    const { data } = mount(part, 7);
    await screen.findByText('Crew 00');
    fireEvent.click(button('Next'));
    await screen.findByText('Crew 03');
    fireEvent.click(button('Search crews'));
    await waitFor(() => expect(lists(data).at(-1)).toMatchObject({ limit: 3 }));
    await screen.findByText('Crew 00');
    expect(lists(data).at(-1)?.offset).toBeUndefined();
    expect(screen.getByRole('status').textContent).toBe('1 to 3 of 7');
  });
});

describe('RecordList page size', () => {
  it('asks for 50 when the spec was not normalized and the source has no limit', async () => {
    const { data } = mount('RecordList', 120, null, false);
    await screen.findByText('Crew 00');
    expect(lists(data).at(-1)).toMatchObject({ limit: 50 });
  });

  it('asks for 50 when the source names no limit, and pages at 50', async () => {
    const { data } = mount('RecordList', 120, null);
    await screen.findByText('Crew 00');
    expect(lists(data).at(-1)).toMatchObject({ limit: 50 });
    expect(screen.getByRole('status').textContent).toBe('1 to 50 of 120');
  });
});

describe('Pager group name', () => {
  it('falls back to Rows when the label is empty', () => {
    render(<Pager label="  " offset={0} count={3} total={7} pageSize={3} loading={false} setOffset={() => {}} />);
    expect(screen.getByRole('group', { name: 'Rows pages' })).toBeTruthy();
  });
});
