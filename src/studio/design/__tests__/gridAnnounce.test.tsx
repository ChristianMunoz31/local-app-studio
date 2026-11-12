// What the grid says through a rendered Design session (DESIGN-phase21.md 6.5a and 15 #3): 'step' is shown with Undo and spoken
// once after a quiet moment, 'quiet' is shown and never spoken, 'refusal' is a problem spoken through a role="alert" line that
// remounts for the same words, and a pointer refusal with a grid reason takes the alert while others keep the polite announcer.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { ComponentProps, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleSpec, layer } from '@/catalog/__tests__/fixtures';
import { AppSpecSchema } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import type { GridPlace } from '@local-app-studio/runtime/spec/gridPlacement';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { WorkspaceContext } from '../../hooks/useWorkspace';
import { StepChromeContext } from '../../hooks/useStepChrome';
import type { StepChrome } from '../../hooks/useStepChrome';
import { featuresApi } from '../../services/studioApi';
import type { WorkspaceValue } from '../../types';
import DesignTab from '../../pages/DesignTab';

const dnd = vi.hoisted(() => ({ onDragStart: null as null | ((e: DragStartEvent) => void), onDragEnd: null as null | ((e: DragEndEvent) => void) }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/core')>();
  const { useEffect } = await import('react');
  function DndContext(props: ComponentProps<typeof real.DndContext>) {
    const { onDragStart, onDragEnd } = props;
    useEffect(() => {
      dnd.onDragStart = onDragStart ?? null;
      dnd.onDragEnd = onDragEnd ?? null;
    });
    return <real.DndContext {...props} />;
  }
  return { ...real, DndContext };
});

// jsdom has no layout: the Grid reports ten pixel columns and twenty pixel rows from the top left corner.
vi.mock('../gridMetrics', async (importOriginal) => {
  const real = await importOriginal<typeof import('../gridMetrics')>();
  return {
    ...real,
    measureGrid: () => ({ left: 0, top: 0, cols: Array.from({ length: 12 }, () => 10), rows: [20, 20, 20], colGap: 0, rowGap: 0 }),
    narrowGrid: () => false,
  };
});

vi.mock('../../hooks/usePreviewStatus', () => ({
  usePreviewStatus: () => ({ status: null, loading: false, error: null, busy: false, start: async () => {}, restart: async () => {}, stop: async () => {} }),
}));

const at = (col: number, span: number, row: number, rowSpan: number): GridPlace => ({ col, span, row, rowSpan });
const part = (id: string, type: string, grid: GridPlace, children: LayoutLayer['children'] = id): LayoutLayer => ({ ...layer(id, type, {}, children), grid });

const LAYOUT: LayoutLayer = layer('root', 'Page', {}, [
  layer('h1', 'Heading', { size: 'lg' }, 'Crew page'),
  layer('g', 'Grid', { placement: 'free', columns: 12, rows: 2 }, [part('a', 'Text', at(7, 3, 1, 1)), part('b', 'Text', at(1, 3, 2, 1))]),
]);

const announce = vi.fn();
const chrome: StepChrome = { setDraft: () => {}, go: () => {}, announce: (text: string) => announce(text), markDone: () => {} };

function Workspace({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<AppSpec>(() => AppSpecSchema.parse(exampleSpec(LAYOUT)));
  const record = (revision: number, s: AppSpec) => ({ id: 'app-1', name: 'Crew Roster', slug: 'crew-roster', revision, spec: s, issues: [], createdAt: '', updatedAt: '' });
  const value = useMemo<WorkspaceValue>(
    () => ({
      record: record(1, current),
      spec: current,
      revision: 1,
      save: async (next) => {
        setCurrent(next);
        return { ok: true, record: record(2, next) };
      },
      reload: async () => {},
      setDirty: () => {},
    }),
    [current],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      <StepChromeContext.Provider value={chrome}>{children}</StepChromeContext.Provider>
    </WorkspaceContext.Provider>
  );
}

async function openCrewPage(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/apps/app-1/design']}>
      <Workspace>
        <DesignTab />
      </Workspace>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Page');
  fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'crew' } });
  await screen.findByRole('group', { name: 'Page canvas' });
}

const block = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-canvas-block][data-layer-id="${id}"]`);
  if (el === null) throw new Error(`no block ${id}`);
  return el;
};
const press = (id: string, key: string): boolean => {
  fireEvent.click(block(id));
  return fireEvent.keyDown(block(id), { key, altKey: true });
};
/** The status line of Design, found by the message it shows (parts on the page have status roles of their own). */
const notice = (text: string): HTMLElement => {
  const el = screen
    .getAllByText(text)
    .map((node) => node.closest<HTMLElement>('[role="status"]'))
    .find((line) => line !== null);
  if (el === undefined || el === null) throw new Error(`no status line with: ${text}`);
  return el;
};

beforeEach(() => {
  announce.mockClear();
  vi.spyOn(featuresApi, 'list').mockResolvedValue(seedRecords());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('announceGrid through Design', () => {
  it('step: shown with Undo and spoken once after a quiet moment', async () => {
    await openCrewPage();
    expect(press('a', 'ArrowLeft')).toBe(false);
    const line = notice('Moved to column 6, row 1.');
    expect(within(line).getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(announce).toHaveBeenCalledWith('Moved to column 6, row 1.');
  });

  it('step: three quick presses speak only the last place', async () => {
    await openCrewPage();
    press('a', 'ArrowLeft');
    press('a', 'ArrowLeft');
    press('a', 'ArrowLeft');
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(announce).toHaveBeenCalledWith('Moved to column 4, row 1.');
  });

  it('quiet: a move that re-sorts the page is shown, never spoken, and the block keeps the keyboard', async () => {
    await openCrewPage();
    press('a', 'ArrowDown');
    const line = notice('Moved to column 7, row 2.');
    expect(within(line).getByRole('button', { name: 'Undo' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(block('a')), { timeout: 5000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it('refusal: shown as a problem, spoken through the alert line, not the polite announcer', async () => {
    await openCrewPage();
    press('b', 'ArrowLeft');
    const words = 'Column 1 is the first column.';
    const line = notice(words);
    expect(within(line).queryByRole('button', { name: 'Undo' })).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(words);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it('refusal: the same words twice remount the alert line', async () => {
    await openCrewPage();
    press('b', 'ArrowLeft');
    const first = screen.getByRole('alert');
    press('b', 'ArrowLeft');
    const second = screen.getByRole('alert');
    expect(second.textContent).toBe(first.textContent);
    expect(second).not.toBe(first);
  });
});

describe('a pointer refusal on a grid', () => {
  const dragBlock = (id: string, point: { clientX: number; clientY: number }): void => {
    act(() => {
      dnd.onDragStart?.({ active: { id: `block:${id}`, data: { current: { kind: 'block', id, tree: 'page' } } }, activatorEvent: point } as unknown as DragStartEvent);
    });
  };
  const dropOn = (id: string, over: unknown): void => {
    act(() => {
      dnd.onDragEnd?.({ active: { id: `block:${id}`, data: { current: { kind: 'block', id, tree: 'page' } } }, over: { id: 'x', data: { current: over } } } as unknown as DragEndEvent);
    });
  };

  it('with a grid reason goes to the alert line, not the polite announcer', async () => {
    await openCrewPage();
    // The pointer is over column 1, row 2: the cells of the other part.
    dragBlock('a', { clientX: 5, clientY: 25 });
    dropOn('a', { kind: 'grid', gridId: 'g', tree: 'page' });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Two parts cannot share the same cells.');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(announce).not.toHaveBeenCalled();
  });

  it('with another reason keeps the polite announcer', async () => {
    await openCrewPage();
    dragBlock('a', { clientX: 5, clientY: 25 });
    dropOn('a', { parentId: 'h1', index: 0, tree: 'page' });
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
