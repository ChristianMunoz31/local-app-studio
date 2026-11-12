// P-03: unsaved Data edits are kept in browser storage and offered back (Restore / Discard), never applied silently.
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, recordOf } from '../../__tests__/fixtures';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { readDraft, writeDraft } from '../../lib/draftStore';
import type { SaveResult, WorkspaceValue } from '../../types';
import DataTab from '../DataTab';

const chrome = vi.hoisted(() => ({ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }));

function Host({ initial }: { initial: AppSpec }) {
  const [spec, setSpec] = useState(initial);
  const record = recordOf(spec);
  const value = {
    record,
    spec,
    revision: 3,
    save: async (next: AppSpec): Promise<SaveResult> => {
      setSpec(next);
      return { ok: true, record: recordOf(next, { revision: 4 }) };
    },
    reload: vi.fn(),
    setDirty: vi.fn(),
  } as unknown as WorkspaceValue;
  return (
    <StepChromeContext.Provider value={chrome as StepChrome}>
      <WorkspaceContext.Provider value={value}>
        <DataTab />
      </WorkspaceContext.Provider>
    </StepChromeContext.Provider>
  );
}

configure({ asyncUtilTimeout: 4000 });
const APP = recordOf(baseSpec()).id;
const extraTables = () => [...baseSpec().tables, { ...baseSpec().tables[0], id: 'extra_table', label: 'Extra table' }];

beforeEach(() => {
  window.localStorage.clear();
  Object.values(chrome).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

const addTable = (): void => {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Tables' })).getByRole('button', { name: 'Add table' }));
};

describe('DataTab draft in browser storage (P-03)', () => {
  it('writes the unsaved tables after an edit and removes them when saved', async () => {
    render(<Host initial={baseSpec()} />);
    await screen.findByLabelText('Table name');
    addTable();
    await waitFor(() => expect(readDraft(APP, 'data')).not.toBeNull());
    expect((readDraft(APP, 'data')?.payload as unknown[]).length).toBe(baseSpec().tables.length + 1);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(readDraft(APP, 'data')).toBeNull());
  });

  it('offers a stored draft with Restore and Discard and applies nothing by itself', async () => {
    writeDraft(APP, 'data', 3, extraTables());
    render(<Host initial={baseSpec()} />);
    await screen.findByLabelText('Table name');
    expect(screen.getByText(/You have unsaved changes on Data from/)).toBeTruthy();
    expect(screen.queryByText('Extra table')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Extra table')).toBeTruthy();
    expect(screen.getByText('Restored your unsaved changes.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('Discard throws the stored draft away and leaves the saved tables as they were', async () => {
    writeDraft(APP, 'data', 3, extraTables());
    render(<Host initial={baseSpec()} />);
    await screen.findByLabelText('Table name');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    });
    expect(readDraft(APP, 'data')).toBeNull();
    expect(screen.queryByText(/You have unsaved changes on Data/)).toBeNull();
    expect(screen.queryByText('Extra table')).toBeNull();
  });

  it('drops a stored draft that equals what is saved, with no offer', async () => {
    writeDraft(APP, 'data', 3, baseSpec().tables);
    render(<Host initial={baseSpec()} />);
    await screen.findByLabelText('Table name');
    expect(screen.queryByText(/You have unsaved changes on Data/)).toBeNull();
    expect(readDraft(APP, 'data')).toBeNull();
  });
});
