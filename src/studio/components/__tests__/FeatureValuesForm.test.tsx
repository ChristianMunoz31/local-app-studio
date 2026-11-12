import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crewCtx, exampleCtx, exampleSpec } from '@/catalog/__tests__/fixtures';
import { SEED_FEATURES } from '@/catalog/features';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import { latestValues } from '../../lib/featureFromSelection';
import { BOARD_PARAMS, boardDef } from '../../lib/__tests__/boardFeature';
import FeatureValuesForm from '../FeatureValuesForm';

afterEach(cleanup);
const def = SEED_FEATURES.filter((d) => d.id === 'kpi_row')[0] as (typeof SEED_FEATURES)[number];

function mount(props: Partial<ComponentProps<typeof FeatureValuesForm>> = {}) {
  const onSubmit = vi.fn((): string[] => []);
  const onCancel = vi.fn();
  render(<FeatureValuesForm def={def} ctx={crewCtx()} submitLabel="Add" onSubmit={onSubmit} onCancel={onCancel} {...props} />);
  return { onSubmit, onCancel };
}

describe('FeatureValuesForm', () => {
  it('labels every setting and starts selects on the first choice', () => {
    mount();
    expect(screen.getByLabelText('Title')).toBeTruthy();
    const list = screen.getByLabelText('List') as HTMLSelectElement;
    expect(list.tagName).toBe('SELECT');
    expect(list.value).not.toBe('');
  });

  it('asks for an empty text and does not submit', () => {
    const { onSubmit } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('Fill in: Title.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows one line, and no duplicate key, for a problem the caller returns twice', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn((): string[] => ['That does not fit here.', 'That does not fit here.']);
    mount({ onSubmit });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Crew size' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getAllByText('That does not fit here.')).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('hands the values back and shows the problems the caller returns', () => {
    const onSubmit = vi.fn((): string[] => []).mockReturnValueOnce(['That does not fit here.']);
    mount({ onSubmit });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Crew size' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    // The second argument is the lists the choice needs that the page does not have: none here.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Crew size' }), []);
    expect(screen.getByRole('alert').textContent).toContain('That does not fit here.');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('starts from the given values and cancels', () => {
    const { onCancel } = mount({ initial: { title: 'Kept' }, cancelLabel: 'Back' });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Kept');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables a select with no choices and says why', () => {
    mount({ ctx: { ...crewCtx(), sourceIds: [] } });
    expect((screen.getByLabelText('List') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/no matching list or record/)).toBeTruthy();
  });
});

describe('FeatureValuesForm in the Feature builder', () => {
  const tableDef = { params: [{ name: 'table', label: 'Table', type: 'table' as const }] };
  const noTables = { ...crewCtx(), tableIds: [], sourceIds: [], sources: {}, fields: {} };
  it('says slot, not app, when there is no table', () => {
    mount({ def: tableDef, ctx: noTables, slotWords: true });
    expect(screen.getByText('This feature has no table slot yet.')).toBeTruthy();
    expect(screen.queryByText('This app has no tables yet.')).toBeNull();
  });
  it('keeps the app words elsewhere', () => {
    mount({ def: tableDef, ctx: noTables });
    expect(screen.getByText('This app has no tables yet.')).toBeTruthy();
  });
});

describe('FeatureValuesForm for a feature with one slot saved as a table and a list (P17-06, P17-08)', () => {
  const board = boardDef();
  const ctx = exampleCtx();
  const spec = validateAppSpec(exampleSpec());
  if (!spec.ok) throw new Error(JSON.stringify(spec.issues));
  const words = spec.value;
  const optionTexts = (label: string): string[] => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.text);

  it('shows one choice for the slot, never the list beside it, and starts both on the same table', () => {
    const { onSubmit } = mount({ def: board, ctx, words, initial: { board_title: 'Status board' } });
    expect(screen.getByLabelText('Things to track')).toBeTruthy();
    expect(screen.queryByLabelText('Things to track list')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ things: 'crews', things_list: 'open_crews', status: 'status' }), []);
  });

  it('names tables, fields and pages the way the app does, never by their ids', () => {
    mount({ def: board, ctx, words });
    expect(optionTexts('Things to track')).toEqual(['People', 'Crews', 'Tasks']);
    expect(optionTexts('Status')).toEqual(['Lead', 'Status']);
  });

  it('says a field the chosen table cannot give is missing instead of choosing another kind', () => {
    mount({ def: board, ctx, words, initial: { board_title: 'x' } });
    fireEvent.change(screen.getByLabelText('Things to track'), { target: { value: 'people' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('Fill in: Status.');
  });

  it('moves the list to a list of the chosen table on the page', () => {
    const { onSubmit } = mount({ def: board, ctx, words, initial: { board_title: 'x' } });
    fireEvent.change(screen.getByLabelText('Things to track'), { target: { value: 'tasks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ things: 'tasks', things_list: 'open_tasks', status: 'done' }), []);
  });

  it('makes a list for a table the page has none of, says so, and hands it to the caller', () => {
    const { onSubmit } = mount({ def: { params: BOARD_PARAMS.slice(0, 2) }, ctx, words });
    fireEvent.change(screen.getByLabelText('Things to track'), { target: { value: 'people' } });
    expect(screen.getByText('This page gets a list of People.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const [values, made] = onSubmit.mock.calls[0] as unknown as [Record<string, string>, { id: string; table: string }[]];
    expect(values).toMatchObject({ things: 'people', things_list: 'people' });
    expect(made).toMatchObject([{ id: 'people', table: 'people' }]);
  });

  it('says a list is made only under the table choice whose own list was made, not under every table choice', () => {
    const two = {
      params: [
        ...BOARD_PARAMS.slice(0, 2),
        { name: 'extra', label: 'Extras', type: 'table' as const },
        { name: 'extra_list', label: 'Extras list', type: 'source' as const, mode: 'list' as const },
      ],
    };
    mount({ def: two, ctx, words });
    fireEvent.change(screen.getByLabelText('Things to track'), { target: { value: 'people' } });
    const note = screen.getByText('This page gets a list of People.');
    expect(screen.getAllByText(/This page gets a list of/)).toHaveLength(1);
    const first = screen.getByLabelText('Things to track');
    expect(first.parentElement?.contains(note)).toBe(true);
    expect(screen.getByLabelText('Extras').parentElement?.contains(note)).toBe(false);
  });

  it('starts on the values it is given, with the new words setting of a newer version filled by the caller', () => {
    mount({ def: boardDef(2, true), ctx, words, initial: latestValues(boardDef(2, true), ctx, { things: 'crews', things_list: 'open_crews', board_title: 'Mine' }).values });
    expect((screen.getByLabelText('Chart title') as HTMLInputElement).value).toBe('Things to track by Status');
    expect((screen.getByLabelText('Board title') as HTMLInputElement).value).toBe('Mine');
  });
});

describe('FeatureValuesForm notes are tied to their select (phase 17 round 2, S3)', () => {
  it('points a select at the empty hint and at the new list note by id', () => {
    mount({ ctx: { ...crewCtx(), sourceIds: [] } });
    const empty = screen.getByText(/no matching list or record/);
    expect(empty.id).not.toBe('');
    expect(screen.getByLabelText('List').getAttribute('aria-describedby')).toBe(empty.id);
    cleanup();
    mount({ def: { params: BOARD_PARAMS.slice(0, 2) }, ctx: exampleCtx() });
    fireEvent.change(screen.getByLabelText('Things to track'), { target: { value: 'people' } });
    const note = screen.getByText(/This page gets a list of/);
    expect(note.id).not.toBe('');
    expect(screen.getByLabelText('Things to track').getAttribute('aria-describedby')).toBe(note.id);
  });
});
