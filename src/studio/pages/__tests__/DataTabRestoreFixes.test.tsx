// Critique fixes on the Data step's kept draft: Restore of an older draft keeps its base (H3), the offer is said once, focus stays.
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec, recordOf } from '../../__tests__/fixtures';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { writeDraft } from '../../lib/draftStore';
import type { SaveResult, WorkspaceValue } from '../../types';
import DataTab from '../DataTab';

const chrome = vi.hoisted(() => ({ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }));
const saves: Array<{ revision: number }> = [];

function Host({ spec }: { spec: AppSpec }) {
  const value = {
    record: recordOf(spec),
    spec,
    revision: 3,
    save: async (_next: AppSpec, opts: { baseRevision: number }): Promise<SaveResult> => {
      saves.push({ revision: opts.baseRevision });
      return { ok: false, code: 'revision_conflict', message: 'The app changed since you opened it.', issues: [] };
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
  saves.length = 0;
  Object.values(chrome).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('DataTab restore (critique fixes)', () => {
  it('H3: restoring a draft made from an older revision saves against that revision, so the conflict is met and nothing newer is overwritten', async () => {
    writeDraft(APP, 'data', 2, extraTables());
    render(<Host spec={baseSpec()} />);
    await screen.findByLabelText('Table name');
    expect(screen.getByText(/The app changed since, so check it before you save\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await screen.findByText('Extra table');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toEqual([{ revision: 2 }]));
  });

  it('a draft made from the current revision saves against the current revision', async () => {
    writeDraft(APP, 'data', 3, extraTables());
    render(<Host spec={baseSpec()} />);
    await screen.findByLabelText('Table name');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await screen.findByText('Extra table');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves).toEqual([{ revision: 3 }]));
  });

  it('says the offer once: the status region holds it and it is not announced again', async () => {
    writeDraft(APP, 'data', 3, extraTables());
    render(<Host spec={baseSpec()} />);
    await screen.findByLabelText('Table name');
    const region = screen.getAllByRole('status')[0];
    expect(within(region).getByText(/You have unsaved changes on Data from/)).toBeTruthy();
    expect(chrome.announce).not.toHaveBeenCalledWith(expect.stringMatching(/You have unsaved changes/));
  });

  it('moves the focus to the table name box after Restore and after Discard', async () => {
    writeDraft(APP, 'data', 3, extraTables());
    render(<Host spec={baseSpec()} />);
    await screen.findByLabelText('Table name');
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Table name')));
    cleanup();
    window.localStorage.clear();
    writeDraft(APP, 'data', 3, extraTables());
    render(<Host spec={baseSpec()} />);
    await screen.findByLabelText('Table name');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Table name')));
  });
});
