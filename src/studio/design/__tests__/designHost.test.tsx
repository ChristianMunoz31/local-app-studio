// The session with a host (the Feature builder): no Save as feature or Save, the host's toolbar end and aside, Ctrl+S ending in the
// host's save, the host's edit as one Undo step, Add a table slot, and a saved feature that makes its own table where none fits.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { SEED_FEATURES } from '@/catalog/features';
import { emptyBench, renameTableSlot } from '../../builder/bench';
import SlotTableDialog from '../../builder/SlotTableDialog';
import { FIELD_SLOT_WORDS } from '../../builder/words';
import { libraryOf } from '../../hooks/useFeatures';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import DesignSession from '../DesignSession';
import type { DesignHost, HostDoc, HostEdit } from '../DesignSession';

vi.mock('@local-app-studio/runtime/runtime/dataClient.js', () => ({ createHttpDataSource: () => ({}) }));

const features = seedRecords();
const library = libraryOf(features);

interface Seen {
  edit: HostEdit | null;
  doc: HostDoc | null;
  saves: AppSpec[];
}

function mount(overrides: Partial<DesignHost> = {}, spec: AppSpec = emptyBench(), hosted = true): Seen {
  const seen: Seen = { edit: null, doc: null, saves: [] };
  const host: DesignHost = {
    kind: 'feature',
    toolbarEnd: <button type="button">Host end</button>,
    aside: <p>Host aside</p>,
    NewTableDialog: SlotTableDialog,
    addFieldWords: FIELD_SLOT_WORDS,
    hidesEntry: (key) => key === 'part:Tab',
    blockedWords: 'Some parts still need a table slot.',
    save: async (next) => {
      seen.saves.push(next);
      return { ok: true };
    },
    bindEdit: (edit) => {
      seen.edit = edit;
    },
    onDoc: (doc) => {
      seen.doc = doc;
    },
    ...overrides,
  };
  render(
    <MemoryRouter>
      <DesignSession
        spec={spec}
        revision={0}
        page={spec.pages[0]}
        pageIndex={0}
        appId="builder-new"
        onShowPage={() => {}}
        features={features}
        library={library}
        reloadFeatures={async () => {}}
        liveSource={undefined}
        onDirty={() => {}}
        onDraft={() => {}}
        onStale={() => {}}
        save={async () => ({ ok: false, code: 'error', message: 'unused', issues: [] })}
        initialTab="features"
        addEntryKey={null}
        toolbarStart={<span>Your feature</span>}
        host={hosted ? host : undefined}
      />
    </MemoryRouter>,
  );
  return seen;
}

const toolbarUndo = (): HTMLElement => screen.getAllByRole('button', { name: 'Undo' })[0];
const tableSlots = (seen: Seen): string[] => (seen.doc?.tables ?? []).map((t) => t.label);

/** Adds the part from the shelf and presses Add a table slot in its box, then Add slot in the dialog. */
async function addWithSlot(part: string, label?: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: `Add ${part}` }));
  fireEvent.click(await screen.findByRole('button', { name: `Add a table slot for ${part}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Add a table slot' });
  if (label !== undefined) fireEvent.change(within(dialog).getByLabelText('Shown as'), { target: { value: label } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add slot' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a table slot' })).toBeNull());
}

beforeAll(async () => {
  await import('../NewTableDialog');
  await import('../AddFieldDialog');
  await import('../../builder/SlotTableDialog');
});

beforeEach(() => {
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('DesignSession with a host', () => {
  it('shows the host toolbar end and aside instead of Save as feature and Save, and no connections list', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Host end' })).toBeTruthy();
    expect(screen.getByText('Host aside')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save as feature' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(screen.queryByText(/Data connections/)).toBeNull();
  });

  it('hands the document to the host when it mounts and after every change', async () => {
    const seen = mount();
    expect(seen.doc?.root.type).toBe('Page');
    expect(seen.doc?.tables).toEqual([]);
    await addWithSlot('Table of records');
    expect(tableSlots(seen)).toEqual(['Crews']);
    expect(seen.doc?.sources).toHaveLength(1);
  });

  it('says the rows are sample rows whenever the layout shows data', async () => {
    mount();
    expect(screen.queryByTestId('data-note')).toBeNull();
    await addWithSlot('Table of records');
    expect(screen.getByTestId('data-note').textContent).toBe('Showing sample rows.');
  });

  it('ends Ctrl+S in the host save with the bench spec, and never in the workspace save', async () => {
    const seen = mount();
    await addWithSlot('Table of records');
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(seen.saves).toHaveLength(1));
    expect(seen.saves[0].tables.map((t) => t.id)).toEqual(['crews']);
    expect(seen.saves[0].pages[0].sources.map((s) => s.table)).toEqual(['crews']);
    // Even with nothing changed since, the host save is asked again (a bench opened from Save as feature is never "saved").
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(seen.saves).toHaveLength(2));
  });

  it('says the host words when Ctrl+S meets a part that needs a slot', async () => {
    const seen = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Table of records' }));
    await screen.findByRole('button', { name: 'Add a table slot for Table of records' });
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(seen.saves).toHaveLength(0);
  });

  it('applies the host edit as one Undo step with its own words, and Undo brings the old label back', async () => {
    const seen = mount();
    await addWithSlot('Table of records');
    let refusal: string | null = 'unset';
    act(() => {
      refusal = seen.edit === null ? 'no edit' : seen.edit((doc) => renameTableSlot(doc, 'crews', 'Jobs'), 'renamed the table slot');
    });
    expect(refusal).toBeNull();
    expect(tableSlots(seen)).toEqual(['Jobs']);
    expect(screen.getByText('Renamed the table slot.')).toBeTruthy();
    fireEvent.click(toolbarUndo());
    expect(tableSlots(seen)).toEqual(['Crews']);
    expect(screen.getByText('Undid: renamed the table slot.')).toBeTruthy();
  });

  it('treats an edit that changes nothing as no step', async () => {
    const seen = mount();
    await addWithSlot('Table of records');
    let refusal: string | null = 'unset';
    act(() => {
      refusal = seen.edit === null ? 'no edit' : seen.edit((doc) => renameTableSlot(doc, 'crews', 'Crews'), 'renamed the table slot');
    });
    expect(refusal).toBeNull();
    expect(screen.queryByText('Renamed the table slot.')).toBeNull();
  });

  it('gives the bench table the label typed in Add a table slot, with its sample rows', async () => {
    const seen = mount();
    await addWithSlot('Table of records', 'Open jobs');
    expect(tableSlots(seen)).toEqual(['Open jobs']);
    expect(seen.doc?.tables[0].fields.map((f) => f.label)).toEqual(['Name', 'Phone', 'Status', 'Size']);
  });

  it('opens Add a table slot for a saved feature that needs a table, and places the feature connected to it', async () => {
    const seen = mount();
    fireEvent.click(screen.getByRole('button', { name: `Add ${SEED_FEATURES[0].label}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a table slot' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add slot' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a table slot' })).toBeNull());
    expect(seen.doc?.tables).toHaveLength(1);
    expect(seen.doc?.sources).toHaveLength(1);
    expect(screen.getByText(/^Made the table .* and added Number row to this page\.$/)).toBeTruthy();
    fireEvent.click(toolbarUndo());
    expect(seen.doc?.tables).toEqual([]);
  });

  it('in an app with no table, a feature that needs one opens New table and goes in connected, as one Undo step', async () => {
    const app = emptyBench();
    const seen = mount({}, app, false);
    fireEvent.click(screen.getByRole('button', { name: `Add ${SEED_FEATURES[0].label}` }));
    const dialog = await screen.findByRole('dialog', { name: 'New table for Number row' });
    fireEvent.change(within(dialog).getByLabelText('Table name'), { target: { value: 'Jobs' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make table' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New table for Number row' })).toBeNull());
    expect(screen.getByText('Made the table Jobs and added Number row to this page.')).toBeTruthy();
    expect(screen.queryByText(/Start with a table on Data/)).toBeNull();
    expect(seen.doc).toBeNull();
    fireEvent.click(toolbarUndo());
    expect(screen.getByText('Undid: added Number row at the top of the page.')).toBeTruthy();
  });

  it('offers Add a field slot for a part that needs a field the bench table lacks, in the words of the builder', async () => {
    const seen = mount();
    await addWithSlot('Table of records');
    fireEvent.click(screen.getByRole('button', { name: 'Add Checklist' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a field slot for Checklist' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a field slot' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add slot' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a field slot' })).toBeNull());
    expect(seen.doc?.tables[0].fields.some((f) => f.type === 'boolean')).toBe(true);
  });
});
