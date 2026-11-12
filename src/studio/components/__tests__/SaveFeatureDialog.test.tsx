import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crewCtx } from '@/catalog/__tests__/fixtures';
import { SEED_FEATURES } from '@/catalog/features';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { FeatureInput, FeatureRecord } from '../../types';
import { groupNote } from '../../lib/featureFromSelection';
import type { AppWords, SlotGroup } from '../../lib/featureFromSelection';
import SaveFeatureDialog from '../SaveFeatureDialog';
import { node, recordOf, seedRecords } from './featureFixtures';

const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock('../../services/studioApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/studioApi')>();
  return { ...actual, featuresApi: { ...actual.featuresApi, create: api.create, update: api.update } };
});

const library = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const section = (): LayoutLayer =>
  node('sec', 'Section', [node('a', 'StatCard', [], { source: 'open_crews', stat: 'count', label: 'Crews' }), node('t', 'DataTable', [], { source: 'open_crews', columns: ['name'] })], { title: 'Crews' });

const recordFromInput = (input: FeatureInput, version = 1): FeatureRecord => ({
  ...recordOf({ ...input, version, updatedAt: '2026-11-02T00:00:00.000Z' }),
});

function mount(onSaved = vi.fn(), onCancel = vi.fn(), features = seedRecords(), spec: AppWords | null = null) {
  const selection = section();
  const root = node('root', 'Page', [selection]);
  render(<SaveFeatureDialog selection={selection} root={root} features={features} library={library} ctx={crewCtx()} spec={spec} onSaved={onSaved} onCancel={onCancel} />);
  return { onSaved, onCancel };
}

beforeEach(() => {
  api.create.mockReset();
  api.update.mockReset();
});
afterEach(cleanup);

describe('SaveFeatureDialog', () => {
  it('lists the values: ids are always settings, texts are optional', () => {
    mount();
    expect(screen.getAllByText('Always a setting').length).toBeGreaterThanOrEqual(1);
    const text = screen.getByRole('checkbox', { name: /Text: Crews/ }) as HTMLInputElement;
    expect(text.checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: /List: open_crews/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/reset to the part default, because the table can change/)).toBeTruthy();
  });

  it('shows the labels of the app and keeps no inside names on screen (P-35)', () => {
    const words: AppWords = {
      tables: [{ id: 'crews', label: 'Crews', fields: [{ id: 'name', label: 'Crew name' }, { id: 'status', label: 'Status' }] }],
      pages: [{ id: 'crew', title: 'Crew', sources: [{ id: 'open_crews', table: 'crews' }] }],
    };
    mount(vi.fn(), vi.fn(), seedRecords(), words);
    expect(screen.getByRole('checkbox', { name: /List: Crews/ })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /open_crews/ })).toBeNull();
    const list: SlotGroup = { key: 'source|open_crews', kind: 'source', value: 'open_crews', uses: [], forced: true };
    const field: SlotGroup = { key: 'field|source|open_crews||status', kind: 'field', value: 'status', of: list.key, uses: [], forced: true };
    expect(groupNote(field, [list, field], words)).toBe('Field: Status');
    expect(groupNote(list, [list, field], null)).toBe('List: open_crews');
    expect(screen.queryByLabelText('Name of this choice')).toBeNull();
    expect(screen.queryByLabelText('Inside name')).toBeNull();
    expect(screen.queryByText('More options')).toBeNull();
  });

  it('needs a name and a description first', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Give the feature a name.');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('counts the description and derives the id from the name without showing it', async () => {
    api.create.mockImplementation(async (input: FeatureInput) => recordFromInput(input));
    mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew numbers' } });
    fireEvent.change(screen.getByLabelText('What it is for (the helper reads this to know when to use it)'), { target: { value: 'Shows crews.' } });
    expect(screen.getByText('12 of 160')).toBeTruthy();
    expect(screen.queryByLabelText('Inside name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect((api.create.mock.calls[0][0] as FeatureInput).id).toBe('crew_numbers');
  });

  function mountWithBuilder() {
    const onOpenBuilder = vi.fn();
    const selection = section();
    render(<SaveFeatureDialog selection={selection} root={node('root', 'Page', [selection])} features={seedRecords()} library={library} ctx={crewCtx()} onSaved={vi.fn()} onCancel={vi.fn()} onOpenBuilder={onOpenBuilder} />);
    return onOpenBuilder;
  }

  it('opens the feature in the builder with My feature standing in for a name and a line that are not typed', () => {
    const onOpenBuilder = mountWithBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Open in the builder' }));
    expect(api.create).not.toHaveBeenCalled();
    expect(onOpenBuilder).toHaveBeenCalledTimes(1);
    const input = onOpenBuilder.mock.calls[0][0] as FeatureInput;
    expect(input).toMatchObject({ label: 'My feature', description: 'My feature' });
    expect(input.params.length).toBeGreaterThan(0);
    expect(input.fragment.id).toBe('sec');
  });

  it('carries the name and the line typed into the builder', () => {
    const onOpenBuilder = mountWithBuilder();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew numbers' } });
    fireEvent.change(screen.getByLabelText('What it is for (the helper reads this to know when to use it)'), { target: { value: 'Shows crews.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open in the builder' }));
    expect(onOpenBuilder.mock.calls[0][0]).toMatchObject({ label: 'Crew numbers', description: 'Shows crews.' });
  });

  it('does not show Open in the builder without a place to open it', () => {
    mount();
    expect(screen.queryByRole('button', { name: 'Open in the builder' })).toBeNull();
  });

  it('saves a new feature and turns the selection into a block of it', async () => {
    api.create.mockImplementation(async (input: FeatureInput) => recordFromInput(input));
    const { onSaved } = mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew numbers' } });
    fireEvent.change(screen.getByLabelText('What it is for (the helper reads this to know when to use it)'), { target: { value: 'Shows crews.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const input = api.create.mock.calls[0][0] as FeatureInput;
    expect(input.id).toBe('crew_numbers');
    expect(input.params.map((p) => p.type).sort()).toEqual(['source']);
    const replacement = onSaved.mock.calls[0][0] as LayoutLayer;
    expect(replacement.id).toBe('sec');
    expect(replacement.feature?.id).toBe('crew_numbers');
    expect(replacement.feature?.params.list).toBe('open_crews');
  });

  it('replaces an existing feature with its version', async () => {
    api.update.mockImplementation(async (_id: string, input: FeatureInput) => recordFromInput(input, 2));
    const { onSaved } = mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew numbers' } });
    fireEvent.change(screen.getByLabelText('What it is for (the helper reads this to know when to use it)'), { target: { value: 'Shows crews.' } });
    fireEvent.click(screen.getByRole('radio', { name: /Replace one of your features/ }));
    // Nothing is preselected: saving without a pick says so.
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Pick the feature to replace.');
    expect(api.update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Feature to replace'), { target: { value: 'kpi_row' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.update).toHaveBeenCalledWith('kpi_row', expect.objectContaining({ id: 'kpi_row' }), 1);
  });

  it('shows the server problems and keeps the selection when saving fails', async () => {
    api.create.mockRejectedValue(new Error('A feature with that name already exists. Pick another name.'));
    const { onSaved } = mount();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew numbers' } });
    fireEvent.change(screen.getByLabelText('What it is for (the helper reads this to know when to use it)'), { target: { value: 'Shows crews.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
