// The Place section (DESIGN-phase21.md 7.2): commit rules, problems with aria-invalid and an alert line, Fill the row.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { findLayer } from '../../lib/layoutTree';
import PlaceSettings from '../PlaceSettings';
import { at, freeGrid, makeSpies, page, text } from './gridFixtures';
import { Harness } from './gridHarness';
import type { Spies } from './gridFixtures';

vi.mock('../gridMetrics', () => ({ narrowGrid: () => false }));

let spies: Spies;
let latest: { root: LayoutLayer };
beforeEach(() => {
  spies = makeSpies();
  latest = { root: page() };
});
afterEach(cleanup);

/** a at column 4, 4 wide (4..7), row 2, 1 high; Notes at column 9, row 2 (9..12). */
const start = (): LayoutLayer => page(freeGrid('g', [text('a', at(4, 4, 2, 1)), { ...text('b', at(9, 4, 2, 1)), name: 'Notes' }], 2));

function mount(root: LayoutLayer = start()): void {
  latest.root = root;
  render(
    <Harness initial={root} spies={spies} onRoot={(r) => {
      latest.root = r;
    }}>
      <Inner />
    </Harness>,
  );
}

function Inner() {
  return <PlaceSettings layer={{ id: 'a', type: 'Text', props: {}, children: [] }} name="Text" />;
}

const box = (field: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`[data-place-field="${field}"]`)!;
const placeOfA = (): unknown => findLayer(latest.root, 'a')!.layer.grid;

describe('PlaceSettings', () => {
  it('shows four labelled boxes with values, min and max, and Column in its setting target', () => {
    mount();
    const col = screen.getByLabelText('Column') as HTMLInputElement;
    expect(col.value).toBe('4');
    expect(col.min).toBe('1');
    expect(col.max).toBe('9');
    expect((screen.getByLabelText('Width in columns') as HTMLInputElement).max).toBe('9');
    expect((screen.getByLabelText('Row') as HTMLInputElement).max).toBe('60');
    expect((screen.getByLabelText('Height in rows') as HTMLInputElement).max).toBe('12');
    expect(document.querySelector('[data-setting-target="place.col"] input')).toBe(col);
    expect(screen.getByText('Starts at column 4, row 2. 4 columns wide, 1 row high.')).toBeTruthy();
    expect(screen.getByText('Place changes when you leave a box or press Enter. The arrow keys change it at once.')).toBeTruthy();
    expect(screen.getByTestId('place-settings')).toBeTruthy();
  });

  it('typing applies nothing; blur applies and speaks a step', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '5' } });
    expect(spies.apply).not.toHaveBeenCalled();
    expect(box('col').value).toBe('5');
    fireEvent.blur(box('col'));
    expect(spies.announceGrid).toHaveBeenCalledWith('Moved to column 5, row 2.', 'step');
    expect(placeOfA()).toEqual(at(5, 4, 2, 1));
  });

  it('Enter applies', () => {
    mount();
    fireEvent.change(box('row'), { target: { value: '3' } });
    fireEvent.keyDown(box('row'), { key: 'Enter' });
    expect(placeOfA()).toEqual(at(4, 4, 3, 1));
    expect(spies.announceGrid).toHaveBeenCalledWith('Moved to column 4, row 3.', 'step');
  });

  it('ArrowUp and ArrowDown apply at once and prevent the default', () => {
    mount();
    expect(fireEvent.keyDown(box('row'), { key: 'ArrowUp' })).toBe(false);
    expect(placeOfA()).toEqual(at(4, 4, 3, 1));
    expect(fireEvent.keyDown(box('row'), { key: 'ArrowDown' })).toBe(false);
    expect(placeOfA()).toEqual(at(4, 4, 2, 1));
  });

  it('a spinner click (pointer down, then change) applies at once', () => {
    mount();
    fireEvent.pointerDown(box('rowSpan'));
    fireEvent.change(box('rowSpan'), { target: { value: '2' } });
    expect(placeOfA()).toEqual(at(4, 4, 2, 2));
    expect(spies.announceGrid).toHaveBeenCalledWith('Now 2 rows high, rows 2 to 3.', 'step');
  });

  it('committing the stored value does nothing and says nothing', () => {
    mount();
    fireEvent.blur(box('col'));
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    expect(spies.apply).not.toHaveBeenCalled();
    expect(spies.announceGrid).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a number that is not whole shows the problem and applies nothing', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '4.5' } });
    fireEvent.blur(box('col'));
    expect(screen.getByRole('alert').textContent).toBe('Use a whole number from 1 to 9.');
    expect(spies.apply).not.toHaveBeenCalled();
  });

  it('a number outside the limit explains the dependent limit', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '10' } });
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Column can be 1 to 9 while the width is 4 columns.');
  });

  it('ties the problem to the failed box only, and a refused blur resets the draft', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '10' } });
    fireEvent.blur(box('col'));
    const alert = screen.getByRole('alert');
    expect(box('col').getAttribute('aria-invalid')).toBe('true');
    expect(box('col').getAttribute('aria-describedby')).toContain(alert.id);
    expect(box('col').value).toBe('4');
    for (const other of ['span', 'row', 'rowSpan']) {
      expect(box(other).getAttribute('aria-invalid')).toBeNull();
      expect(box(other).getAttribute('aria-describedby') ?? '').not.toContain(alert.id);
    }
  });

  it('a refused Enter keeps the draft', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '10' } });
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    expect(box('col').value).toBe('10');
  });

  it('the blur after a failed Enter does not commit the same bad text again', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '10' } });
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    const first = screen.getByRole('alert');
    fireEvent.blur(box('col'));
    expect(screen.getByRole('alert')).toBe(first);
    expect(box('col').value).toBe('10');
    // A different bad text is committed (and spoken) again.
    fireEvent.change(box('col'), { target: { value: '11' } });
    fireEvent.blur(box('col'));
    expect(screen.getByRole('alert')).not.toBe(first);
  });

  it('the same problem twice remounts the alert node', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '10' } });
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    const first = screen.getByRole('alert');
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    const second = screen.getByRole('alert');
    expect(second).not.toBe(first);
    expect(second.textContent).toBe(first.textContent);
  });

  it('the next successful commit clears the problem and aria-invalid', () => {
    mount();
    fireEvent.change(box('col'), { target: { value: '10' } });
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    fireEvent.change(box('col'), { target: { value: '5' } });
    fireEvent.keyDown(box('col'), { key: 'Enter' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(box('col').getAttribute('aria-invalid')).toBeNull();
  });

  it('an overlap names the blocker and applies nothing', () => {
    mount();
    fireEvent.change(box('span'), { target: { value: '6' } });
    fireEvent.keyDown(box('span'), { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Cannot place it there: Notes is in column 9, row 2.');
    expect(placeOfA()).toEqual(at(4, 4, 2, 1));
    expect(spies.announceGrid).not.toHaveBeenCalled();
  });

  it('Fill the row fills it and says so; it names a blocker when it cannot', () => {
    mount(page(freeGrid('g', [text('a', at(4, 4, 2, 1))], 2)));
    fireEvent.click(screen.getByRole('button', { name: 'Fill the row' }));
    expect(placeOfA()).toEqual(at(1, 12, 2, 1));
    expect(spies.announceGrid).toHaveBeenCalledWith('Now 12 columns wide, columns 1 to 12.', 'step');
  });

  it('Fill the row refused shows the blocker', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Fill the row' }));
    expect(screen.getByRole('alert').textContent).toBe('Cannot place it there: Notes is in column 9, row 2.');
  });
});
