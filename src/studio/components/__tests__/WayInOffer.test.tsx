// The way-in offer of Preview and Data: one save for one press, the outcome with Undo, Undo as one more save, conflicts, and the
// words when nothing can be added.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crewRoster from '@local-app-studio/runtime/spec/fixtures/crew-roster.json';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { StepChromeContext } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { CONFLICT_MESSAGE } from '../../types';
import type { SaveResult, WorkspaceValue } from '../../types';
import WayInOffer from '../WayInOffer';

const chrome = vi.hoisted(() => ({ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }));
const save = vi.fn<(next: AppSpec, opts: { baseRevision: number }) => Promise<SaveResult>>();

type Slot = NonNullable<NonNullable<AppSpec['menu']>['end']>;
const button = (id: string, table: string): Slot[number] => ({ id, type: 'Button', props: { text: 'Add', action: { action: 'open-form', table, mode: 'create' } }, children: [] });

/** The Crew Roster fixture: tables People and Crews, one list of Crews, no Form and no menu bar. */
const base = (): AppSpec => {
  const spec = structuredClone(crewRoster) as unknown as AppSpec;
  spec.pages[0].sources = spec.pages[0].sources.map((s) => ({ ...s, mode: 'list' as const }));
  return spec;
};
const withMenu = (): AppSpec => ({ ...base(), menu: { position: 'top', style: 'icons-and-labels' } });
const noList = (): AppSpec => {
  const spec = base();
  spec.pages[0].layout.children = [];
  spec.pages[0].sources = [];
  return spec;
};
const ok = (spec: AppSpec, revision: number): SaveResult => ({
  ok: true,
  record: { id: 'app-1', name: '', slug: '', revision, spec, issues: [], createdAt: '', updatedAt: '' },
});

function mount(spec: AppSpec, only?: readonly string[]) {
  const value = { record: { id: 'app-1' }, spec, revision: 3, save, reload: vi.fn(), setDirty: vi.fn() } as unknown as WorkspaceValue;
  return render(
    <StepChromeContext.Provider value={chrome}>
      <WorkspaceContext.Provider value={value}>
        <WayInOffer only={only} />
      </WorkspaceContext.Provider>
    </StepChromeContext.Provider>,
  );
}

beforeEach(() => {
  save.mockReset();
  save.mockImplementation(async (next, opts) => ok(next, opts.baseRevision + 1));
  Object.values(chrome).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('WayInOffer', () => {
  it('shows nothing when every table has a way in', () => {
    const spec = withMenu();
    spec.menu = { ...spec.menu!, end: [button('b1', 'crews'), button('b2', 'people')] };
    const { container } = mount(spec);
    expect(container.innerHTML).toBe('');
  });

  it('saves the whole app once with menu buttons, says what it added and offers Undo', async () => {
    mount(withMenu());
    expect(screen.getByText('People and Crews have no way to add records yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    await screen.findByText(/^Added a menu button for People and a menu button for Crews\./);
    expect(save).toHaveBeenCalledTimes(1);
    const [next, opts] = save.mock.calls[0];
    expect(opts).toEqual({ baseRevision: 3 });
    expect(next.menu?.end?.map((l) => l.props.action)).toEqual([
      { action: 'open-form', table: 'people', mode: 'create' },
      { action: 'open-form', table: 'crews', mode: 'create' },
    ]);
    expect(screen.queryByRole('button', { name: 'Add a way to add records' })).toBeNull();
  });

  it('Undo is one more save of the spec from before, on the revision the first save returned', async () => {
    const spec = withMenu();
    mount(spec);
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await screen.findByText('Undone.');
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toBe(spec);
    expect(save.mock.calls[1][1]).toEqual({ baseRevision: 4 });
    expect(screen.getByRole('button', { name: 'Add a way to add records' })).toBeTruthy();
  });

  it('keeps one status region from the start, and moves the keyboard to Undo and back to Add', async () => {
    mount(withMenu());
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toMatch(/^Added /);
    await waitFor(() => expect(document.activeElement).toBe(undo));
    fireEvent.click(undo);
    const add = await screen.findByRole('button', { name: 'Add a way to add records' });
    expect(status.textContent).toBe('Undone.');
    await waitFor(() => expect(document.activeElement).toBe(add));
  });

  it('disables Add and Undo while a save is pending', async () => {
    let release: (r: SaveResult) => void = () => {};
    save.mockImplementationOnce(() => new Promise<SaveResult>((r) => (release = r)));
    mount(withMenu());
    const add = screen.getByRole('button', { name: 'Add a way to add records' }) as HTMLButtonElement;
    fireEvent.click(add);
    await waitFor(() => expect(add.disabled).toBe(true));
    release(ok(withMenu(), 4));
    const undo = (await screen.findByRole('button', { name: 'Undo' })) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    let releaseUndo: (r: SaveResult) => void = () => {};
    save.mockImplementationOnce(() => new Promise<SaveResult>((r) => (releaseUndo = r)));
    fireEvent.click(undo);
    await waitFor(() => expect(undo.disabled).toBe(true));
    releaseUndo(ok(withMenu(), 5));
    await screen.findByText('Undone.');
  });

  it('keeps the offer and shows the conflict words when the save is refused', async () => {
    save.mockResolvedValueOnce({ ok: false, code: 'revision_conflict', message: CONFLICT_MESSAGE, issues: [] });
    mount(withMenu());
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    await screen.findByText(CONFLICT_MESSAGE);
    expect(screen.getByRole('button', { name: 'Add a way to add records' })).toBeTruthy();
    expect(screen.queryByText(/^Added /)).toBeNull();
  });

  it('shows the conflict words when Undo is refused, and keeps Undo', async () => {
    mount(withMenu());
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    save.mockResolvedValueOnce({ ok: false, code: 'revision_conflict', message: CONFLICT_MESSAGE, issues: [] });
    fireEvent.click(undo);
    await screen.findByText(CONFLICT_MESSAGE);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('adds a Form after the list when there is no menu bar, and says which table it could not place', async () => {
    mount(base());
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    await screen.findByText(/^Added a Form for Crews on Home\./);
    expect(screen.getByText(/Nothing shows People yet: put a list of it on a page first\./)).toBeTruthy();
    const next = save.mock.calls[0][0];
    const kids = next.pages[0].layout.children as { type: string; props: Record<string, unknown> }[];
    expect(kids.filter((l) => l.type === 'RecordForm').map((l) => l.props)).toEqual([{ table: 'crews', mode: 'create' }]);
  });

  it('only limits the offer to the named tables', async () => {
    mount(withMenu(), ['crews']);
    expect(screen.getByText('Crews has no way to add records yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].menu?.end).toHaveLength(1);
  });

  it('Data: says where to show the table first and has no button when nothing can be added', () => {
    mount(noList(), ['crews']);
    expect(screen.getByText('Crews has no way to add records yet. Show it on a page in Design first.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    mount(noList(), ['crews', 'people']);
    expect(screen.getByText('People and Crews have no way to add records yet. Show them on a page in Design first.')).toBeTruthy();
  });

  it('Preview: says to put a Form on a page and keeps Add a form in Design when nothing can be added', () => {
    mount(noList());
    expect(screen.getByText('People and Crews have no way to add records yet. Put a Form on a page to add them here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a way to add records' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a form in Design' }));
    expect(chrome.go).toHaveBeenCalledWith('/apps/app-1/design', { state: { stepFocus: true, addEntry: 'part:RecordForm' } });
  });
});
