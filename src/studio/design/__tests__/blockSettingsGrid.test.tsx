// BlockSettings with a free Grid (DESIGN-phase21.md 7.4): the switch on a Grid, Place and no Width on a placed part, and the focus target.
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { findLayer } from '../../lib/layoutTree';
import BlockSettings from '../BlockSettings';
import { DesignContext, useDesign } from '../DesignContext';
import type { DesignContextValue } from '../DesignContext';
import { at, flowGrid, freeGrid, makeSpies, page, text } from './gridFixtures';
import { Harness, LiveSettings } from './gridHarness';
import type { Spies } from './gridFixtures';

vi.mock('../gridMetrics', () => ({ narrowGrid: () => false }));

let spies: Spies;
beforeEach(() => {
  spies = makeSpies();
});
afterEach(cleanup);

function mount(root: LayoutLayer, id: string): void {
  render(
    <Harness initial={root} spies={spies}>
      <LiveSettings id={id} onClose={() => {}} />
    </Harness>,
  );
}

describe('BlockSettings on a grid', () => {
  it('a Grid shows the switch and no Place or Width', () => {
    mount(page(flowGrid('g', [text('a')])), 'g');
    expect(screen.getByRole('switch', { name: 'Place parts freely' })).toBeTruthy();
    expect(screen.queryByTestId('place-settings')).toBeNull();
  });

  it('a placed part shows Place and no Width', () => {
    mount(page(freeGrid('g', [text('a', at(2, 3, 1, 1))])), 'a');
    expect(screen.getByTestId('place-settings')).toBeTruthy();
    expect(screen.getByLabelText('Column')).toBeTruthy();
    expect(screen.queryByLabelText('Width')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it("a flow Grid's child shows neither Place nor the switch", () => {
    mount(page(flowGrid('g', [text('a')])), 'a');
    expect(screen.queryByTestId('place-settings')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a part outside any grid shows no Place', () => {
    mount(page(text('a')), 'a');
    expect(screen.queryByTestId('place-settings')).toBeNull();
  });
});

describe('settings opened on place.col', () => {
  it('puts the focus on Column', () => {
    const root = page(freeGrid('g', [text('a', at(2, 3, 1, 1))]));
    render(
      <Harness initial={root} spies={spies}>
        <FocusColumn />
      </Harness>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Column'));
  });
});

/** Settings opened the way "Choose column and row..." opens them: with settingsFocus 'place.col'. */
function FocusColumn() {
  const base = useDesign();
  const found = findLayer(base.root, 'a')!;
  const value: DesignContextValue = { ...base, settingsFocus: 'place.col' };
  return <Override value={value}>{<BlockSettings layer={found.layer} onClose={() => {}} />}</Override>;
}

function Override({ value, children }: { value: DesignContextValue; children: ReactNode }) {
  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}
