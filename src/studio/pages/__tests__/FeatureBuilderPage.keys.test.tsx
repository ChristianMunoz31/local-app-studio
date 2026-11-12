// Split from FeatureBuilderPage.test.tsx by describe block (phase 27): one screen one key, a feature the builder cannot open. The mocks, builders and hooks are in featureBuilderHarness.tsx.
import { stored, addStored, updated, mount, panel, saveButton, ready, addTableSlot, fillSave, installFeatureBuilderHooks } from './featureBuilderHarness';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import type { FeatureDefinition } from '@/catalog/features';
import { layer } from '../../builder/__tests__/benchFixtures';
import { seedRecords, recordOf } from '../../components/__tests__/featureFixtures';
import { featuresApi } from '../../services/studioApi';

installFeatureBuilderHooks();

describe('one screen, one key', () => {
  const draftKeys = (): string[] => Object.keys(localStorage).filter((k) => k.includes('studio.draft.builder-'));

  it('does not offer a saved new feature back as a draft on the next New feature', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    await waitFor(() => expect(draftKeys().some((k) => k.includes('builder-new'))).toBe(true));
    const dialog = await fillSave('Crew list', 'Shows crews.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/features/crew_list/edit'));
    expect(draftKeys().filter((k) => k.includes('builder-new'))).toEqual([]);
    cleanup();
    mount();
    await ready();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('keeps edits made after the first save under the feature, not under New feature', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    const dialog = await fillSave('Crew list', 'Shows crews.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/features/crew_list/edit'));
    const box = within(panel()).getByLabelText('Shown as') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Jobs' } });
    fireEvent.blur(box);
    await waitFor(() => expect(draftKeys().some((k) => k.includes('builder-crew_list'))).toBe(true));
    cleanup();
    expect(draftKeys().filter((k) => k.includes('builder-new'))).toEqual([]);
    mount();
    await ready();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    cleanup();
    mount('/features/crew_list/edit');
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('stays where it is when the list does not reload after the first save', async () => {
    let calls = 0;
    vi.spyOn(featuresApi, 'list').mockImplementation(async () => {
      calls += 1;
      if (calls > 1) throw new Error('Could not load your features. Try again.');
      return stored;
    });
    mount();
    await ready();
    await addTableSlot('Table of records');
    const dialog = await fillSave('Crew list', 'Shows crews.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    await screen.findByText('Saved Crew list. It is in your features.');
    await waitFor(() => expect(calls).toBeGreaterThan(1));
    await act(async () => {});
    expect(screen.getByTestId('where').textContent).toBe('/features/new');
    expect(screen.getByRole('heading', { level: 1, name: 'Edit Crew list' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not pull a person back to the edit address when they left before the reload came', async () => {
    const waiting: Array<() => void> = [];
    let calls = 0;
    vi.spyOn(featuresApi, 'list').mockImplementation(async () => {
      calls += 1;
      if (calls > 1) await new Promise<void>((resolve) => waiting.push(resolve));
      return stored;
    });
    mount();
    await ready();
    await addTableSlot('Table of records');
    const dialog = await fillSave('Crew list', 'Shows crews.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    await screen.findByText('Saved Crew list. It is in your features.');
    fireEvent.click(screen.getByRole('link', { name: 'Features' }));
    expect(await screen.findByText('Features page')).toBeTruthy();
    await act(async () => {
      waiting.forEach((release) => release());
    });
    expect(screen.getByTestId('where').textContent).toBe('/features');
  });

  it('sends the newest version it saved even when the list of features is stale', async () => {
    const snapshot = seedRecords();
    vi.spyOn(featuresApi, 'list').mockImplementation(async () => snapshot);
    mount('/features/search_list/edit');
    await ready();
    for (let n = 0; n < 2; n += 1) {
      fireEvent.click(saveButton());
      const dialog = await screen.findByRole('dialog', { name: 'Save a new version' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
      await waitFor(() => expect(updated).toHaveLength(n + 1));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Save a new version' })).toBeNull());
    }
    expect(updated.map((u) => u.version)).toEqual([1, 2]);
  });
});

describe('a feature the builder cannot open', () => {
  const one: FeatureDefinition = {
    id: 'rec',
    label: 'Rec',
    description: 'Shows one.',
    version: 3,
    updatedAt: '2026-11-02T00:00:00.000Z',
    params: [{ name: 'record', label: 'Record', type: 'source', mode: 'record' }],
    fragment: layer('f1', 'RecordDetail', { source: 's' }),
    bindings: [{ param: 'record', layer: 'f1', target: 'props.source' }],
  };

  it('says it shows one record (not damaged) and changes only its name and line, as a new version', async () => {
    addStored(recordOf(one));
    mount('/features/rec/edit');
    expect(await screen.findByText('This feature shows one record, so the builder cannot open it yet.')).toBeTruthy();
    expect(screen.queryByText(/damaged/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change name and line' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change name and line' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Rec');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Record card' } });
    fireEvent.change(within(dialog).getByLabelText('What it is for, in one line'), { target: { value: 'Shows one crew.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0].id).toBe('rec');
    expect(updated[0].version).toBe(3);
    expect(updated[0].input).toEqual({ id: 'rec', label: 'Record card', description: 'Shows one crew.', params: one.params, fragment: one.fragment, bindings: one.bindings });
    expect(await screen.findByText('Saved Record card. It is in your features.')).toBeTruthy();
  });

  it('uses the neutral words, and still offers the rename, for another cause', async () => {
    const orphan: FeatureDefinition = { ...one, id: 'orphan', label: 'Orphan', params: [{ name: 'f', label: 'Field', type: 'field', of: 'missing' }], bindings: [] };
    addStored(recordOf(orphan));
    mount('/features/orphan/edit');
    expect(await screen.findByText('The builder cannot open this feature yet.')).toBeTruthy();
    expect(screen.queryByText(/one record/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Change name and line' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Features' })).toBeTruthy();
  });

  it('keeps a damaged feature on the damaged words with no rename', async () => {
    addStored(recordOf(SEED_FEATURES[0], { id: 'broken', label: 'Broken', ok: false, fragment: null }));
    mount('/features/broken/edit');
    expect(await screen.findByText('This feature is damaged, so it cannot be opened in the builder.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change name and line' })).toBeNull();
  });
});
