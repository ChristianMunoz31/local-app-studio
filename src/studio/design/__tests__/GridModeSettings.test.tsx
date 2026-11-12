// The "Place parts freely" switch and its confirm (DESIGN-phase21.md 7.3), inside the settings popover.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { layer } from '@/catalog/__tests__/fixtures';
import { findLayer } from '../../lib/layoutTree';
import { at, flowGrid, freeGrid, makeSpies, page, text } from './gridFixtures';
import { Harness, LiveSettings } from './gridHarness';
import type { Spies } from './gridFixtures';

vi.mock('../gridMetrics', () => ({ narrowGrid: () => false }));

let spies: Spies;
let latest: { root: LayoutLayer };
let onClose: Mock<() => void>;
beforeEach(() => {
  spies = makeSpies();
  onClose = vi.fn<() => void>();
  latest = { root: page() };
});
afterEach(cleanup);

function mount(root: LayoutLayer): void {
  latest.root = root;
  render(
    <Harness initial={root} spies={spies} onRoot={(r) => {
      latest.root = r;
    }}>
      <LiveSettings id="g" onClose={onClose} />
    </Harness>,
  );
}

const gridProps = (): Record<string, unknown> => findLayer(latest.root, 'g')!.layer.props as Record<string, unknown>;
const switchEl = (): HTMLElement => screen.getByRole('switch', { name: 'Place parts freely' });

describe('GridModeSettings', () => {
  it('a refusal is a keyed alert tied to the switch, announced again when it repeats', () => {
    mount(page(layer('g', 'Grid', { columns: 1 }, Array.from({ length: 61 }, (_, i) => text(`c${i}`)))));
    expect(switchEl().getAttribute('aria-invalid')).toBeNull();
    fireEvent.click(switchEl());
    const first = screen.getByRole('alert');
    expect(first.textContent).toBeTruthy();
    expect(switchEl().getAttribute('aria-invalid')).toBe('true');
    expect(switchEl().getAttribute('aria-describedby')?.split(' ')).toContain(first.id);
    fireEvent.click(switchEl());
    const second = screen.getByRole('alert');
    expect(second).not.toBe(first);
    expect(second.textContent).toBe(first.textContent);
  });

  it('shows an off switch on a flow Grid; turning it on places the parts and says so', () => {
    mount(page(flowGrid('g', [text('a'), text('b')])));
    expect((switchEl() as HTMLInputElement).checked).toBe(false);
    fireEvent.click(switchEl());
    expect(gridProps().placement).toBe('free');
    expect(spies.tell).toHaveBeenCalledWith('Auto grid now places parts freely.', true);
    expect((switchEl() as HTMLInputElement).checked).toBe(true);
    expect(findLayer(latest.root, 'a')!.layer.grid).toEqual(at(1, 6, 1, 1));
  });

  it('turning it off with placed parts asks first, with Keep places focused', async () => {
    mount(page(freeGrid('g', [text('a', at(1, 3, 1, 1))])));
    fireEvent.click(switchEl());
    const dialog = await screen.findByRole('alertdialog', { name: 'Stop placing parts freely?' });
    expect(dialog.textContent).toContain('Their places are forgotten.');
    expect(dialog.textContent).toContain('Ctrl+Z brings them back.');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep places' })));
    expect(gridProps().placement).toBe('free');
  });

  it('Keep places changes nothing, returns the focus to the switch and leaves the settings open', async () => {
    mount(page(freeGrid('g', [text('a', at(1, 3, 1, 1))])));
    fireEvent.click(switchEl());
    fireEvent.click(await screen.findByRole('button', { name: 'Keep places' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(gridProps().placement).toBe('free');
    expect(findLayer(latest.root, 'a')!.layer.grid).toEqual(at(1, 3, 1, 1));
    await waitFor(() => expect(document.activeElement).toBe(switchEl()));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(spies.tell).not.toHaveBeenCalled();
  });

  it('Stop placing freely forgets the places, says so, returns the focus to the switch and leaves the settings open', async () => {
    mount(page(freeGrid('g', [text('a', at(1, 3, 1, 1))])));
    fireEvent.click(switchEl());
    fireEvent.click(await screen.findByRole('button', { name: 'Stop placing freely' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(gridProps().placement).toBeUndefined();
    expect(findLayer(latest.root, 'a')!.layer.grid).toBeUndefined();
    expect(spies.tell).toHaveBeenCalledWith('Auto grid now puts parts one after the other.', true);
    await waitFor(() => expect(document.activeElement).toBe(switchEl()));
    expect((switchEl() as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape inside the confirm closes the confirm and not the settings', async () => {
    mount(page(freeGrid('g', [text('a', at(1, 3, 1, 1))])));
    fireEvent.click(switchEl());
    const keep = await screen.findByRole('button', { name: 'Keep places' });
    fireEvent.keyDown(keep, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('turning it off with no placed part asks nothing', () => {
    mount(page(freeGrid('g', [text('a')])));
    fireEvent.click(switchEl());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(gridProps().placement).toBeUndefined();
    expect(spies.tell).toHaveBeenCalledWith('Auto grid now puts parts one after the other.', true);
  });
});
