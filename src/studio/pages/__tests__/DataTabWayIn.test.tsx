import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { recordOf } from '../../__tests__/fixtures';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import type { WorkspaceValue } from '../../types';
import { specOf } from '../../lib/__tests__/bindFixtures';
import DataTab from '../DataTab';

const chrome = vi.hoisted(() => ({ setDraft: vi.fn(), go: vi.fn(), announce: vi.fn(), markDone: vi.fn() }));
const saveSpy = vi.fn();
let revisionCounter = 3;

function Host({ initial }: { initial: AppSpec }) {
  const [spec, setSpec] = useState(initial);
  const [revision, setRevision] = useState(3);
  const value = {
    record: recordOf(spec),
    spec,
    revision,
    save: async (next: AppSpec, opts?: { baseRevision?: number }) => {
      saveSpy(next, opts);
      revisionCounter += 1;
      setSpec(next);
      setRevision(revisionCounter);
      return { ok: true, record: recordOf(next, { revision: revisionCounter }) };
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

const withMenu = (): AppSpec => specOf((input) => void (input.menu = { position: 'top', style: 'icons-and-labels' }));
const noMenu = (): AppSpec => specOf();

configure({ asyncUtilTimeout: 5000 });
beforeEach(() => {
  saveSpy.mockReset();
  Object.values(chrome).forEach((fn) => fn.mockReset());
  revisionCounter = 3;
});
afterEach(cleanup);

const ADD = 'Add a way to add records';
const addTable = (): void => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Add table' })[0]);
};
const save = async (calls: number): Promise<void> => {
  const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(calls));
};

describe('DataTab way-in offer', () => {
  it('menu on: names the new table and adds one menu button with one workspace save', async () => {
    render(<Host initial={withMenu()} />);
    addTable();
    await save(1);
    expect(await screen.findByText('New table has no way to add records yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ADD }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    const next = saveSpy.mock.calls[1][0] as AppSpec;
    expect(JSON.stringify(next.menu)).toContain('new_table');
  });

  it('menu off: says to show it on a page first and has no button', async () => {
    render(<Host initial={noMenu()} />);
    addTable();
    await save(1);
    const line = await screen.findByText(/has no way to add records yet\./);
    expect(line.textContent).toContain('Show it on a page in Design first.');
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('several new tables are named in one sentence', async () => {
    render(<Host initial={withMenu()} />);
    addTable();
    addTable();
    await save(1);
    const line = await screen.findByText(/ and .* have no way to add records yet\./);
    expect(line.textContent).toContain('New table');
    expect(screen.getByRole('button', { name: ADD })).toBeTruthy();
  });

  it('shows no offer after a save that adds no table', async () => {
    render(<Host initial={withMenu()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await save(1);
    expect(screen.queryByText(/no way to add records yet/)).toBeNull();
    expect(screen.queryByRole('button', { name: ADD })).toBeNull();
  });

  it('takes the offer away at the next edit', async () => {
    render(<Host initial={withMenu()} />);
    addTable();
    await save(1);
    await screen.findByText('New table has no way to add records yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.queryByText(/no way to add records yet/)).toBeNull();
  });
});
