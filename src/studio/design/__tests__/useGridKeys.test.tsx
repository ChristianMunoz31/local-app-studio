// The Alt+Arrow keys of a part placed freely on a grid (DESIGN-phase21.md 7.1).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { findLayer } from '../../lib/layoutTree';
import { useGridKeys } from '../useGridKeys';
import { at, flowGrid, freeGrid, makeSpies, page, text } from './gridFixtures';
import { Harness } from './gridHarness';
import type { Spies } from './gridFixtures';
import { useDesign } from '../DesignContext';

const narrow = vi.hoisted(() => ({ value: false }));
vi.mock('../gridMetrics', () => ({ narrowGrid: () => narrow.value }));

/** A focusable block that runs the grid key handler, like CanvasBlock. */
function Block({ id }: { id: string }) {
  const { root } = useDesign();
  const found = findLayer(root, id);
  const gridKey = useGridKeys(found?.layer ?? { id, type: 'Text', props: {}, children: [] }, found?.parent ?? null);
  return <div tabIndex={0} data-testid="block" onKeyDown={(e) => void gridKey(e)} />;
}

let spies: Spies;
beforeEach(() => {
  spies = makeSpies();
  narrow.value = false;
});
afterEach(cleanup);

function mount(root: LayoutLayer, id = 'a'): HTMLElement {
  render(
    <Harness initial={root} spies={spies}>
      <Block id={id} />
    </Harness>,
  );
  return screen.getByTestId('block');
}

/** fireEvent returns false when the key's default was prevented. */
const press = (el: HTMLElement, key: string, init: Partial<KeyboardEventInit> = {}): boolean => fireEvent.keyDown(el, { key, altKey: true, ...init });

const two = (): LayoutLayer => page(freeGrid('g', [text('a', at(1, 2, 1, 1)), { ...text('b', at(6, 2, 1, 1)), name: 'Notes' }], 1));

describe('useGridKeys', () => {
  it('Alt+Arrow moves one cell and speaks it as a step when the reading order stays', () => {
    const el = mount(two());
    expect(press(el, 'ArrowRight')).toBe(false);
    expect(spies.announceGrid).toHaveBeenCalledWith('Moved to column 2, row 1.', 'step');
    expect(spies.focusBlock).not.toHaveBeenCalled();
    press(el, 'ArrowLeft');
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Moved to column 1, row 1.', 'step');
  });

  it('a move that re-sorts the DOM refocuses and is quiet', () => {
    const root = page(freeGrid('g', [text('a', at(1, 2, 1, 1)), text('b', at(6, 2, 1, 1))], 1));
    const el = mount(root);
    press(el, 'ArrowDown');
    expect(spies.focusBlock).toHaveBeenCalledWith('a');
    expect(spies.announceGrid).toHaveBeenCalledWith('Moved to column 1, row 2.', 'quiet');
  });

  it('Alt+ArrowUp moves up', () => {
    const el = mount(page(freeGrid('g', [text('a', at(1, 2, 2, 1))], 2)));
    press(el, 'ArrowUp');
    expect(spies.announceGrid).toHaveBeenCalledWith('Moved to column 1, row 1.', 'step');
  });

  it('Alt+Shift+Arrow resizes with the extent in the words and speaks a step', () => {
    const el = mount(page(freeGrid('g', [text('a', at(1, 3, 1, 1))], 1)));
    press(el, 'ArrowRight', { shiftKey: true });
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Now 4 columns wide, columns 1 to 4.', 'step');
    press(el, 'ArrowLeft', { shiftKey: true });
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Now 3 columns wide, columns 1 to 3.', 'step');
    press(el, 'ArrowDown', { shiftKey: true });
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Now 2 rows high, rows 1 to 2.', 'step');
    press(el, 'ArrowUp', { shiftKey: true });
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Now 1 row high, row 1.', 'step');
    expect(spies.focusBlock).not.toHaveBeenCalled();
  });

  it('on a narrow screen a re-sorting move still refocuses, is quiet and ends with the narrow sentence', () => {
    narrow.value = true;
    const el = mount(page(freeGrid('g', [text('a', at(1, 2, 1, 1)), text('b', at(6, 2, 1, 1))], 1)));
    press(el, 'ArrowDown');
    expect(spies.focusBlock).toHaveBeenCalledWith('a');
    expect(spies.announceGrid).toHaveBeenCalledWith('Moved to column 1, row 2. The grid shows one column on a narrow screen.', 'quiet');
  });

  it('on a narrow screen a move that keeps the order is a step with the narrow sentence and no refocus', () => {
    narrow.value = true;
    const el = mount(two());
    press(el, 'ArrowRight');
    expect(spies.focusBlock).not.toHaveBeenCalled();
    expect(spies.announceGrid).toHaveBeenCalledWith('Moved to column 2, row 1. The grid shows one column on a narrow screen.', 'step');
  });

  it('prevents the default of every handled key, also when it repeats, at an edge and on an overlap', () => {
    const el = mount(two());
    expect(press(el, 'ArrowRight', { repeat: true })).toBe(false);
    expect(press(el, 'ArrowLeft')).toBe(false);
    expect(press(el, 'ArrowLeft')).toBe(false);
    expect(spies.announceGrid).toHaveBeenLastCalledWith('Column 1 is the first column.', 'refusal');
  });

  it('a refused edge step applies nothing', () => {
    const el = mount(two());
    press(el, 'ArrowLeft');
    expect(spies.announceGrid).toHaveBeenCalledWith('Column 1 is the first column.', 'refusal');
    expect(spies.apply).not.toHaveBeenCalled();
  });

  it('an overlap names the blocker and applies nothing', () => {
    const root = page(freeGrid('g', [text('a', at(1, 2, 1, 1)), { ...text('b', at(3, 2, 1, 1)), name: 'Notes' }], 1));
    const el = mount(root);
    expect(press(el, 'ArrowRight')).toBe(false);
    expect(spies.announceGrid).toHaveBeenCalledWith('Cannot move right: Notes is in column 3.', 'refusal');
    expect(spies.apply).not.toHaveBeenCalled();
  });

  it('does not handle the key without Alt, with Ctrl or Meta, or for other keys', () => {
    const el = mount(two());
    expect(fireEvent.keyDown(el, { key: 'ArrowRight' })).toBe(true);
    expect(press(el, 'ArrowRight', { ctrlKey: true })).toBe(true);
    expect(press(el, 'ArrowRight', { metaKey: true })).toBe(true);
    expect(press(el, 'Enter')).toBe(true);
    expect(spies.announceGrid).not.toHaveBeenCalled();
    expect(spies.apply).not.toHaveBeenCalled();
  });

  it('does not handle an unplaced part or a part outside a free Grid', () => {
    const unplaced = mount(page(freeGrid('g', [text('a')], 1)));
    expect(press(unplaced, 'ArrowRight')).toBe(true);
    cleanup();
    const flow = mount(page(flowGrid('g', [text('a')])));
    expect(press(flow, 'ArrowRight')).toBe(true);
    expect(spies.announceGrid).not.toHaveBeenCalled();
  });
});
