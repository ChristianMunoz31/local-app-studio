// The Feature builder screen: slot creation from a drop, the slot panel (rename with Undo, sample rows, ticked words), the save
// dialog and its refusals in plain words, create then edit, Edit with a new version, Try it in an app, and the two ways it cannot open.
/* eslint-disable react-refresh/only-export-components -- a test harness module, never a Fast Refresh boundary */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { seedRecords, recordOf } from '../../components/__tests__/featureFixtures';
import { featuresApi } from '../../services/studioApi';
import type { FeatureInput, FeatureRecord } from '../../types';
import FeatureBuilderPage from '../FeatureBuilderPage';

vi.mock('@local-app-studio/runtime/runtime/dataClient.js', () => ({ createHttpDataSource: () => ({}) }));

vi.mock('../../hooks/useApps', () => ({
  useApps: () => ({ apps: [{ id: 'app-1', name: 'Crew Roster', ok: true }], loading: false, error: null, reload: async () => {} }),
}));

export let stored: FeatureRecord[] = [];
/** A saved feature that is in the list from now on (what a test with its own stored feature adds). */
export const addStored = (record: FeatureRecord): void => {
  stored = [...stored, record];
};

export const created: FeatureInput[] = [];

export const updated: Array<{ id: string; input: FeatureInput; version: number }> = [];

export const recordFromInput = (input: FeatureInput, version: number): FeatureRecord =>
  recordOf({ ...input, version, updatedAt: '2026-11-02T00:00:00.000Z' }, { version });

export function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

export function mount(entry: string | { pathname: string; state: unknown } = '/features/new') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Where />
      <Routes>
        <Route path="/features" element={<p>Features page</p>} />
        <Route path="/features/new" element={<FeatureBuilderPage />} />
        <Route path="/features/:featureId/edit" element={<FeatureBuilderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

export const badge = (): string | null => document.querySelector('[data-connection-badge]')?.textContent?.replace(/\. Change table$/, '') ?? null;

export const toolbarUndo = (): HTMLElement => screen.getAllByRole('button', { name: 'Undo' })[0];

export const panel = (): HTMLElement => screen.getByRole('region', { name: 'Slots' });

export const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Save feature' }) as HTMLButtonElement;

export async function ready(): Promise<void> {
  await screen.findByRole('region', { name: 'Slots' });
  await waitFor(() => expect(saveButton().getAttribute('aria-disabled')).toBeNull());
}

export async function addTableSlot(part: string, label?: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: `Add ${part}` }));
  fireEvent.click(await screen.findByRole('button', { name: `Add a table slot for ${part}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Add a table slot' });
  if (label !== undefined) fireEvent.change(within(dialog).getByLabelText('Shown as'), { target: { value: label } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add slot' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a table slot' })).toBeNull());
}

export async function fillSave(name: string, line: string): Promise<HTMLElement> {
  fireEvent.click(saveButton());
  const dialog = await screen.findByRole('dialog', { name: /^Save (feature|a new version)$/ });
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(within(dialog).getByLabelText('What it is for, in one line'), { target: { value: line } });
  return dialog;
}

export function installFeatureBuilderHooks(): void {
  beforeAll(async () => {
    await import('../../design/NewTableDialog');
    await import('../../design/AddFieldDialog');
    await import('../../builder/SlotTableDialog');
    await import('../../builder/BuilderSaveDialog');
    await import('../../showcase/UseInAppDialog');
  });
  beforeEach(() => {
    stored = seedRecords();
    created.length = 0;
    updated.length = 0;
    vi.spyOn(featuresApi, 'list').mockImplementation(async () => stored);
    vi.spyOn(featuresApi, 'create').mockImplementation(async (input) => {
      created.push(input);
      const record = recordFromInput(input, 1);
      stored = [...stored, record];
      return record;
    });
    vi.spyOn(featuresApi, 'update').mockImplementation(async (id, input, version) => {
      updated.push({ id, input, version });
      const record = recordFromInput(input, version + 1);
      stored = stored.map((r) => (r.id === id ? record : r));
      return record;
    });
    if (!window.matchMedia) {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
    }
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });
}
