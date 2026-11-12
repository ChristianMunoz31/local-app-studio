// Split from FeatureBuilderPage.test.tsx by describe block (phase 27): the builder screen, Edit, panel words, leaving with panel edits. The mocks, builders and hooks are in featureBuilderHarness.tsx.
import { addStored, updated, mount, badge, toolbarUndo, panel, saveButton, ready, addTableSlot, installFeatureBuilderHooks } from './featureBuilderHarness';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import type { FeatureDefinition } from '@/catalog/features';
import { layer } from '../../builder/__tests__/benchFixtures';
import { recordOf } from '../../components/__tests__/featureFixtures';
import type { FeatureInput } from '../../types';

installFeatureBuilderHooks();

describe('the builder screen', () => {
  it('opens empty with its words, its title and the slot panel', async () => {
    mount();
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'New feature' })).toBeTruthy();
    expect(screen.getByText('Put parts together once and use them in any app. The rows you see are sample rows.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Features' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Page layout' })).getByText('Your feature')).toBeTruthy();
    expect(document.title).toBe('New feature, Local App Studio');
    expect(within(panel()).getByText('What people fill in when they add this feature.')).toBeTruthy();
    expect(within(panel()).getByText('No slots yet. Drop a part that shows records, then press Add a table slot.')).toBeTruthy();
    expect(within(panel()).getByText('People can change 0 of 6 things.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try it in an app' })).toBeTruthy();
  });

  it('adds a table slot from a drop, and the pill reads Uses slot with the sample rows on the canvas', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    expect(badge()).toBe('Uses slot Crews');
    const rows = within(panel()).getAllByTestId('slot-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Table this feature shows')).toBeTruthy();
    expect((within(rows[0]).getByLabelText('Shown as') as HTMLInputElement).value).toBe('Crews');
    expect(within(rows[0]).getByText('Used by: Table of records')).toBeTruthy();
    // The row is one group named by its heading, with Used by as its description (many rows share the box names).
    const group = within(panel()).getByRole('group', { name: 'Table this feature shows' });
    expect(group.getAttribute('aria-describedby')).toBe(within(rows[0]).getByText('Used by: Table of records').id);
    expect(screen.getByTestId('data-note').textContent).toBe('Showing sample rows.');
  });

  it('renames a table slot on blur as one Undo step, and the pill follows', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    const box = within(panel()).getByLabelText('Shown as') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Jobs' } });
    fireEvent.blur(box);
    expect(badge()).toBe('Uses slot Jobs');
    expect(screen.getByText('Renamed the table slot.')).toBeTruthy();
    fireEvent.click(toolbarUndo());
    expect(badge()).toBe('Uses slot Crews');
    expect(screen.getByText('Undid: renamed the table slot.')).toBeTruthy();
  });

  it('switches the sample rows at once as one Undo step', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    const select = within(panel()).getByLabelText('Sample rows') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Crews', 'Tasks', 'Items']);
    fireEvent.change(select, { target: { value: 'tasks' } });
    expect((within(panel()).getByLabelText('Sample rows') as HTMLSelectElement).value).toBe('tasks');
    expect(screen.getByText('Switched Crews to Tasks sample rows.')).toBeTruthy();
    fireEvent.click(toolbarUndo());
    expect((within(panel()).getByLabelText('Sample rows') as HTMLSelectElement).value).toBe('crews');
  });

  it('makes words a setting only when they are ticked', async () => {
    mount();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Heading' }));
    const row = await within(panel()).findByTestId('slot-row');
    expect(within(row).getByText('Words you can change')).toBeTruthy();
    const tick = within(row).getByLabelText('Let people change these words') as HTMLInputElement;
    expect(tick.checked).toBe(false);
    expect(within(panel()).getByText('People can change 0 of 6 things.')).toBeTruthy();
    fireEvent.click(tick);
    expect(within(panel()).getByText('People can change 1 of 6 things.')).toBeTruthy();
  });

  it('puts a slot that no part uses in the panel as not used yet after the part is removed', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    expect(within(panel()).getByText('No slots yet. Drop a part that shows records, then press Add a table slot.')).toBeTruthy();
  });
});

describe('Edit', () => {
  it('loads a saved feature, saves a new version with the version it started from', async () => {
    mount('/features/search_list/edit');
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Search list' })).toBeTruthy();
    await ready();
    expect(document.title).toBe('Edit Search list, Local App Studio');
    expect(badge()).toBe('Uses slot List');
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Save a new version' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Search list');
    expect((within(dialog).getByLabelText('What it is for, in one line') as HTMLInputElement).value).toBe(SEED_FEATURES[1].description);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]).toMatchObject({ id: 'search_list', version: 1 });
    expect(updated[0].input.params.map((p) => p.type).sort()).toEqual(['field', 'source']);
  });

  it('opens a feature made in Save as feature from the router state, filled', async () => {
    const def = SEED_FEATURES[1];
    const input: FeatureInput = { id: def.id, label: 'My feature', description: 'My feature', params: def.params, fragment: def.fragment, bindings: def.bindings };
    mount({ pathname: '/features/new', state: { builderStart: input } });
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'New feature' })).toBeTruthy();
    expect(within(panel()).getAllByTestId('slot-row').length).toBeGreaterThan(0);
  });

  it('says a damaged feature cannot be opened, with a way back', async () => {
    addStored(recordOf(SEED_FEATURES[0], { id: 'broken', label: 'Broken', ok: false, fragment: null }));
    mount('/features/broken/edit');
    expect(await screen.findByText('This feature is damaged, so it cannot be opened in the builder.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Features' }));
    expect(await screen.findByText('Features page')).toBeTruthy();
  });

  it('says a missing feature does not exist', async () => {
    mount('/features/nope/edit');
    expect(await screen.findByText('That feature does not exist. It may have been deleted.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Features' })).toBeTruthy();
  });
});

describe('panel words are unsaved work too', () => {
  const hello: FeatureDefinition = {
    id: 'hello',
    label: 'Hello',
    description: 'Says hello.',
    version: 1,
    updatedAt: '2026-11-02T00:00:00.000Z',
    params: [{ name: 'title', label: 'Title', type: 'text' }],
    fragment: layer('f1', 'Heading', { size: 'lg' }, 'Hello'),
    bindings: [{ param: 'title', layer: 'f1', target: 'children' }],
  };
  const leave = (): boolean => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('asks to save first, and guards leaving, once a tick or a label differs from the saved ones', async () => {
    addStored(recordOf(hello));
    mount('/features/hello/edit');
    await ready();
    expect(leave()).toBe(false);
    const tick = (): HTMLInputElement => within(panel()).getByLabelText('Let people change these words') as HTMLInputElement;
    expect(tick().checked).toBe(true);
    fireEvent.click(tick());
    expect(leave()).toBe(true);
    fireEvent.click(tick());
    expect(leave()).toBe(false);
    const box = within(panel()).getByLabelText('Shown as') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Heading words' } });
    expect(leave()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Try it in an app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save a new version' });
    expect(within(dialog).getByText('Save the feature first. Then pick the app.')).toBeTruthy();
  });
});

describe('leaving with panel edits', () => {
  const hello: FeatureDefinition = {
    id: 'hello',
    label: 'Hello',
    description: 'Says hello.',
    version: 1,
    updatedAt: '2026-11-02T00:00:00.000Z',
    params: [{ name: 'title', label: 'Title', type: 'text' }],
    fragment: layer('f1', 'Heading', { size: 'lg' }, 'Hello'),
    bindings: [{ param: 'title', layer: 'f1', target: 'children' }],
  };

  it('asks before the Features link when the panel differs from the saved one, and stays on No', async () => {
    addStored(recordOf(hello));
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mount('/features/hello/edit');
    await ready();
    fireEvent.click(screen.getByRole('link', { name: 'Features' }));
    expect(ask).not.toHaveBeenCalled();
    expect(await screen.findByText('Features page')).toBeTruthy();
    cleanup();
    mount('/features/hello/edit');
    await ready();
    fireEvent.click(within(panel()).getByLabelText('Let people change these words'));
    fireEvent.click(screen.getByRole('link', { name: 'Features' }));
    expect(ask).toHaveBeenCalledWith('Your changes to the words are not saved. Leave anyway?');
    expect(screen.getByTestId('where').textContent).toBe('/features/hello/edit');
    ask.mockReturnValue(true);
    fireEvent.click(screen.getByRole('link', { name: 'Features' }));
    expect(await screen.findByText('Features page')).toBeTruthy();
  });
});
