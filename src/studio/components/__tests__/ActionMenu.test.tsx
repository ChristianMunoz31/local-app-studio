import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionMenu from '../ActionMenu';

afterEach(cleanup);

const setup = () => {
  const onA = vi.fn();
  const onB = vi.fn();
  const onC = vi.fn();
  render(
    <div>
      <p data-testid="outside">outside</p>
      <ActionMenu
        label="More"
        menuLabel="Actions"
        items={[
          { id: 'a', label: 'Alpha', onSelect: onA },
          { id: 'b', label: 'Beta', disabled: true, onSelect: onB },
          { id: 'c', label: 'Gamma', danger: true, onSelect: onC },
        ]}
      />
    </div>,
  );
  return { onA, onB, onC, trigger: screen.getByRole('button', { name: 'More' }) };
};
const items = () => screen.getAllByRole('menuitem');

describe('ActionMenu', () => {
  it('is closed by default', () => {
    const { trigger } = setup();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on Enter and ArrowDown at the first item, ArrowUp at the last', () => {
    for (const [key, index] of [['Enter', 0], ['ArrowDown', 0], ['ArrowUp', 2]] as const) {
      const { trigger } = setup();
      fireEvent.keyDown(trigger, { key });
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('menu', { name: 'Actions' })).toBeTruthy();
      expect(document.activeElement).toBe(items()[index]);
      cleanup();
    }
  });

  it('moves with arrows, wraps, and jumps with Home and End', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items()[2]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items()[0]);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on an outside pointerdown', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ignores a disabled item', () => {
    const { trigger, onB } = setup();
    fireEvent.click(trigger);
    const beta = screen.getByRole('menuitem', { name: 'Beta' });
    expect(beta.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(beta);
    expect(onB).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on choose and passes the trigger', () => {
    const { trigger, onC } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Gamma' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onC).toHaveBeenCalledWith(trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('opens on Space and closes on Tab without trapping focus', () => {
    const { trigger } = setup();
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(items()[0], { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
