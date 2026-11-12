// Split from FeatureBuilderPage.test.tsx by describe block (phase 27): saving and the save dialog checks. The mocks, builders and hooks are in featureBuilderHarness.tsx.
import { created, updated, mount, saveButton, ready, addTableSlot, fillSave, installFeatureBuilderHooks } from './featureBuilderHarness';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { slotTable } from '../../builder/bench';
import BuilderSaveDialog from '../../builder/BuilderSaveDialog';
import { layer } from '../../builder/__tests__/benchFixtures';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { libraryOf } from '../../hooks/useFeatures';
import { featuresApi } from '../../services/studioApi';

installFeatureBuilderHooks();

describe('saving', () => {
  it('refuses a missing name, then a missing line, then an empty feature, each in plain words', async () => {
    mount();
    await ready();
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Save feature' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Give the feature a name. Type a name, then press Save feature.');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Crew list' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Say in one line what the feature is for. Type one line, then press Save feature.');
    fireEvent.change(within(dialog).getByLabelText('What it is for, in one line'), { target: { value: 'Shows crews.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('There is nothing in the feature yet. Drag a part from the shelf onto the feature, then save.');
    expect(created).toHaveLength(0);
  });

  it('marks the box a refusal is about, points it at the message and moves the focus there', async () => {
    mount();
    await ready();
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog', { name: 'Save feature' });
    const nameBox = within(dialog).getByLabelText('Name');
    const lineBox = within(dialog).getByLabelText('What it is for, in one line');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    const alert = await within(dialog).findByRole('alert');
    expect(nameBox.getAttribute('aria-invalid')).toBe('true');
    expect(nameBox.getAttribute('aria-describedby')).toBe(alert.id);
    expect(document.activeElement).toBe(nameBox);
    fireEvent.change(nameBox, { target: { value: 'Crew list' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    const second = await within(dialog).findByRole('alert');
    expect(nameBox.getAttribute('aria-invalid')).toBeNull();
    expect(lineBox.getAttribute('aria-invalid')).toBe('true');
    expect(lineBox.getAttribute('aria-describedby')?.split(' ')).toContain(second.id);
    expect(document.activeElement).toBe(lineBox);
  });

  it('counts the line and folds its spaces', async () => {
    mount();
    await ready();
    const dialog = await fillSave('Crew list', 'Shows   crews.');
    expect(within(dialog).getByText('The helper reads this line to know when to use it.')).toBeTruthy();
    expect(within(dialog).getByText('12 of 160')).toBeTruthy();
  });

  it('disables Save feature while a part needs a slot, with the reason after it', async () => {
    mount();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Table of records' }));
    await screen.findByRole('button', { name: 'Add a table slot for Table of records' });
    await waitFor(() => expect(saveButton().getAttribute('aria-disabled')).toBe('true'));
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(saveButton().getAttribute('aria-describedby') ?? '')?.textContent).toContain('Some parts still need a table slot.');
  });

  it('creates the feature, tells it, and moves the address to the edit address', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    const dialog = await fillSave('Crew list', 'Shows crews.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ id: 'crew_list', label: 'Crew list', description: 'Shows crews.' });
    expect(created[0].params.map((p) => p.label)).toEqual(['Crews list']);
    const notice = await screen.findByText('Saved Crew list. It is in your features.');
    // Said once by the announcer; the visible notice is not a second live region.
    expect(notice.closest('[role="status"]')?.getAttribute('aria-live')).toBe('off');
    // The toolbar button keeps its name: it never reads "Saving..." (only the request in the dialog does).
    expect(saveButton().textContent).toBe('Save feature');
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/features/crew_list/edit'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit Crew list' })).toBeTruthy();
    // The next save is a new version of the same feature.
    const again = await fillSave('Crew list', 'Shows crews, newest first.');
    expect(within(again).getByText('Save a new version', { selector: 'h2, h1, h3, [id]' })).toBeTruthy();
    fireEvent.click(within(again).getByRole('button', { name: 'Save feature' }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]).toMatchObject({ id: 'crew_list', version: 1 });
  });

  it('shows a refusal of the server in plain words and keeps the dialog open', async () => {
    vi.spyOn(featuresApi, 'create').mockRejectedValueOnce(Object.assign(new Error('A feature with that name already exists. Pick another name.'), { code: 'feature_id_taken', status: 409, issues: [] }));
    mount();
    await ready();
    await addTableSlot('Table of records');
    const dialog = await fillSave('Crew list', 'Shows crews.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).not.toMatch(/\b(id|fragment|binding)\b/i);
    expect(screen.getByRole('dialog', { name: 'Save feature' })).toBeTruthy();
  });

  it('opens the save dialog first when Try it in an app meets unsaved work, then opens the app choice', async () => {
    mount();
    await ready();
    await addTableSlot('Table of records');
    fireEvent.click(screen.getByRole('button', { name: 'Try it in an app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save feature' });
    expect(within(dialog).getByText('Save the feature first. Then pick the app.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Crew list' } });
    fireEvent.change(within(dialog).getByLabelText('What it is for, in one line'), { target: { value: 'Shows crews.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save feature' }));
    expect(await screen.findByRole('dialog', { name: 'Use "Crew list" in an app' })).toBeTruthy();
  });
});

describe('BuilderSaveDialog checks', () => {
  const library = libraryOf(seedRecords());
  const crews = slotTable('Crews', 'crews', [], new Set());
  const state = { textOn: new Set<string>(), labels: {} };

  function open(extra: { needsSlots?: boolean; doc?: Parameters<typeof BuilderSaveDialog>[0]['doc']; state?: typeof state } = {}) {
    const doc = extra.doc ?? { root: layer('root_feature', 'Page', {}, [layer('h1', 'Heading', { size: 'lg' }, 'Hello')]), sources: [], tables: [crews] };
    render(<BuilderSaveDialog editing={null} doc={doc} library={library} state={extra.state ?? state} needsSlots={extra.needsSlots ?? false} onSaved={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew list' } });
    fireEvent.change(screen.getByLabelText('What it is for, in one line'), { target: { value: 'Shows crews.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save feature' }));
  }

  it('refuses a part that still needs a slot', async () => {
    open({ needsSlots: true });
    expect((await screen.findByRole('alert')).textContent).toBe('Some parts still need a table slot. Press Add a table slot on each part that needs one, or delete the part.');
  });

  it('refuses more than six settings', async () => {
    const headings = Array.from({ length: 7 }, (_, i) => layer(`h${i}`, 'Heading', { size: 'lg' }, `Words ${i}`));
    const doc = { root: layer('root_feature', 'Page', {}, headings), sources: [], tables: [] };
    open({ doc, state: { textOn: new Set(headings.map((_, i) => `use|h${i}|children`)), labels: {} } });
    expect((await screen.findByRole('alert')).textContent).toBe('A feature can let people change up to 6 things. Untick some words you can change, or take out a part.');
  });

  it('never shows an issue path or a developer word, even when the check itself fails', async () => {
    const doc = { root: layer('root_feature', 'Page', {}, [layer('s', 'Section', {}, [layer('p', 'Page')])]), sources: [], tables: [] };
    open({ doc });
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toBe('This feature did not work with sample rows. Undo your last change, then save again.');
  });

  it('has Show as in the canvas toolbar and no Enlarge', async () => {
    mount();
    await ready();
    expect(screen.getAllByRole('group', { name: 'Show as' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Enlarge' })).toBeNull();
  });
});
