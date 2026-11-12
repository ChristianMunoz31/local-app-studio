import { createElement } from 'react';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PART_COMPONENTS } from '../components.ts';
import { CatalogPageProvider, useSource } from '../context.tsx';
import type { CatalogData } from '../context.tsx';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema.ts';
import { crewAppSpec, makeFakeData } from './fakeData.ts';
import { layer } from './fixtures.ts';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('light');
});

function Tree({ node }: { node: LayoutLayer }): ReactNode {
  const component = PART_COMPONENTS[node.type];
  const children = typeof node.children === 'string' ? node.children : node.children.map((c) => <Tree key={c.id} node={c} />);
  return createElement(component, { ...node.props, 'data-testid': node.id, 'data-layer-id': node.id }, children);
}

/** Reads the source the way a list part would, so a sort set by SortControl shows in the rows. */
function Rows({ source }: { source: string }) {
  const { rows } = useSource(source);
  return (
    <ul aria-label="rows">
      {rows.map((r) => (
        <li key={String(r.id)}>{String(r.name)}</li>
      ))}
    </ul>
  );
}

interface MountOptions {
  live?: boolean;
  data?: ReturnType<typeof makeFakeData>;
  pageId?: string;
  spec?: CatalogData['spec'];
}

function mount(node: LayoutLayer, opts: MountOptions = {}) {
  const data = opts.data ?? makeFakeData();
  const value: CatalogData = {
    apiBase: '/api',
    spec: opts.spec ?? crewAppSpec(),
    pageId: opts.pageId ?? 'home',
    recordId: null,
    dataSource: data,
    ...(opts.live === false ? {} : { navigate: vi.fn() }),
  };
  const ui = (pageId: string) => (
    <CatalogPageProvider value={{ ...value, pageId }}>
      <Tree node={node} />
      <Rows source="open_crews" />
    </CatalogPageProvider>
  );
  const view = render(ui(value.pageId ?? 'home'));
  return { ...view, data, rerenderOn: (pageId: string) => view.rerender(ui(pageId)) };
}

const callout = (tone?: string, title?: string) =>
  layer('c1', 'Callout', { ...(tone ? { tone } : {}), ...(title ? { title } : {}) }, 'Paused crews are hidden.');

describe('Callout', () => {
  it.each([
    [undefined, 'Note:', 'blue'],
    ['success', 'Good news:', 'green'],
    ['warning', 'Warning:', 'amber'],
    ['danger', 'Problem:', 'red'],
  ])('tone %s speaks %s first and uses the %s accent', (tone, word, accent) => {
    mount(callout(tone, 'Heads up'));
    const note = screen.getByRole('note');
    expect(note.firstElementChild?.className).toContain('sr-only');
    expect(note.firstElementChild?.textContent?.trim()).toBe(word);
    expect(note.className).toContain(`border-accent-${accent}/40`);
    expect(note.className).toContain(`bg-accent-${accent}/10`);
    expect(note.textContent).toContain('Heads up');
    expect(note.textContent).toContain('Paused crews are hidden.');
  });

  it('falls back to the note tone for a prototype key such as constructor', () => {
    mount(callout('constructor' as never, 'Heads up'));
    const note = screen.getByRole('note');
    expect(note.firstElementChild?.textContent?.trim()).toBe('Note:');
    expect(note.className).toContain('border-accent-blue/40');
  });
});

describe('Collapsible', () => {
  const tree = (start?: string) =>
    layer('k1', 'Collapsible', { title: 'More details', ...(start ? { start } : {}) }, [layer('t1', 'Text', {}, 'Extra notes.')]);

  it('starts closed, wires aria and opens and closes on click', () => {
    mount(tree());
    const button = screen.getByRole('button', { name: 'More details' });
    const region = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.hidden).toBe(true);
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    expect(screen.getByText('Extra notes.')).toBeTruthy();
    fireEvent.click(button);
    expect(region.hidden).toBe(true);
  });

  it('starts open when start is open', () => {
    mount(tree('open'));
    expect(screen.getByRole('button', { name: 'More details' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('is always open when not live', () => {
    mount(tree(), { live: false });
    const button = screen.getByRole('button', { name: 'More details' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')?.hidden).toBe(false);
  });
});

describe('SortControl', () => {
  const sortTree = layer('s1', 'SortControl', { source: 'open_crews', fields: ['name', 'size'] }, []);
  const lastList = (data: ReturnType<typeof makeFakeData>) =>
    [...data.calls].reverse().find((c) => c.method === 'list' && c.table === 'crews')?.arg as { sort?: unknown };
  const rowNames = () => Array.from(screen.getByRole('list', { name: 'rows' }).children).map((li) => li.textContent);

  it('sends the sort and flips the direction with words for the type', async () => {
    const { data } = mount(sortTree);
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    expect(lastList(data)).not.toHaveProperty('sort');
    const select = screen.getByLabelText('Sort by');
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Default order', 'Name', 'Size']);
    expect((screen.getByRole('button', { name: /A to Z/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'size' } });
    await waitFor(() => expect(lastList(data).sort).toEqual([{ field: 'size', dir: 'asc' }]));
    fireEvent.click(screen.getByRole('button', { name: /Lowest first/ }));
    await waitFor(() => expect(lastList(data).sort).toEqual([{ field: 'size', dir: 'desc' }]));
    expect(screen.getByRole('button', { name: /Highest first/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Order: Highest first. Change order' })).toBeTruthy();
    await waitFor(() => expect(rowNames()).toEqual(['Gamma', 'Alpha']));

    fireEvent.change(select, { target: { value: 'name' } });
    expect((screen.getByRole('button', { name: /A to Z/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(lastList(data)).not.toHaveProperty('sort'));
  });

  it('resets on page change', async () => {
    const { data, rerenderOn } = mount(sortTree);
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'size' } });
    await waitFor(() => expect(lastList(data).sort).toBeDefined());
    rerenderOn('crew');
    await waitFor(() => expect((screen.getByLabelText('Sort by') as HTMLSelectElement).value).toBe(''));
    await waitFor(() => expect(lastList(data)).not.toHaveProperty('sort'));
  });
});

describe('QuickAdd', () => {
  const addTree = layer('q1', 'QuickAdd', { table: 'crews', field: 'name', placeholder: 'New crew name' }, []);
  const creates = (data: ReturnType<typeof makeFakeData>) => data.calls.filter((c) => c.method === 'create');
  const typeAndAdd = (text: string) => {
    fireEvent.change(screen.getByLabelText('New crew name'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  };

  it('posts one trimmed field, clears and says Added.', async () => {
    const { data } = mount(addTree);
    const input = screen.getByLabelText('New crew name');
    expect(input.getAttribute('maxlength')).toBe('500');
    typeAndAdd('  Delta  ');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Added.'));
    expect(creates(data)).toEqual([{ method: 'create', table: 'crews', arg: { name: 'Delta' } }]);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('refuses an empty box', () => {
    const { data } = mount(addTree);
    typeAndAdd('   ');
    expect((screen.getByRole('alert')).textContent).toBe('Type something first.');
    expect(creates(data)).toHaveLength(0);
  });

  it('shows a server message as is', async () => {
    const { data } = mount(addTree);
    data.failNextWrite('Name is already taken.', 'name');
    typeAndAdd('Alpha');
    expect((await screen.findByRole('alert')).textContent).toBe('Name is already taken.');
    // Changed on purpose: the status line is always mounted (a live region must exist before it is filled), so it is empty, not absent.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('says to use a form when another required field has no default', async () => {
    const spec = crewAppSpec();
    spec.tables.find((t) => t.id === 'crews')?.fields.push({ id: 'code', label: 'Code', type: 'text', required: true });
    const { data } = mount(addTree, { spec });
    typeAndAdd('Delta');
    expect((await screen.findByRole('alert')).textContent).toBe('This list needs more than one field. Use a form instead.');
    expect(creates(data)).toHaveLength(0);
  });

  it('says to use a form when the server names another field', async () => {
    const { data } = mount(addTree);
    data.failNextWrite('Status is required.', 'status');
    typeAndAdd('Delta');
    expect((await screen.findByRole('alert')).textContent).toBe('This list needs more than one field. Use a form instead.');
  });

  it.each(['size', 'created_at', 'id', 'nope'])('shows a plain note and no input when the field is %s', (field) => {
    const { data } = mount(layer('q1', 'QuickAdd', { table: 'crews', field, placeholder: 'New crew name' }, []));
    expect(screen.getByText('This list cannot take quick entries here. Use a form to add to it.')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(creates(data)).toHaveLength(0);
  });

  it('is disabled when not live', () => {
    mount(addTree, { live: false });
    expect((screen.getByLabelText('New crew name') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('themes', () => {
  it.each(['dark', 'light'])('all four render in the %s theme', (theme) => {
    if (theme === 'light') document.documentElement.classList.add('light');
    mount(
      layer('root', 'Page', {}, [
        callout('warning'),
        layer('k1', 'Collapsible', { title: 'More' }, []),
        layer('s1', 'SortControl', { source: 'open_crews', fields: ['name'] }, []),
        layer('q1', 'QuickAdd', { table: 'crews', field: 'name' }, []),
      ]),
    );
    for (const id of ['c1', 'k1', 's1', 'q1']) expect(document.querySelector(`[data-layer-id="${id}"]`)).not.toBeNull();
  });
});
