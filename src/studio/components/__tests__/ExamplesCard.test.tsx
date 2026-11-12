import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLES } from '@/studio/examples';
import type { ExampleId } from '@/studio/examples';
import ExamplesCard from '../ExamplesCard';

afterEach(cleanup);

const show = (busyId: ExampleId | null = null, onUse = vi.fn()) => {
  render(<ExamplesCard examples={EXAMPLES} busyId={busyId} onUse={onUse} />);
  return onUse;
};

describe('ExamplesCard', () => {
  it('is a region named Examples with the subtitle and eight cards', () => {
    show();
    const region = screen.getByRole('region', { name: 'Examples' });
    expect(region.textContent).toContain('Open one, try it with sample data, then change it as your own.');
    expect(within(region).getAllByRole('listitem')).toHaveLength(8);
    expect(within(region).getAllByRole('heading', { level: 4 })).toHaveLength(8);
  });

  it('gives each card its name, description, shows line, counts and look, and one button named for the example', () => {
    show();
    for (const meta of EXAMPLES) {
      const card = screen.getByRole('heading', { name: meta.name }).closest('li') as HTMLElement;
      expect(card.textContent).toContain(meta.description);
      expect(card.textContent).toContain('Shows: ' + meta.shows.join(', '));
      expect(card.textContent).toMatch(/\d tables?, \d pages? · \w+ look, (light|dark)/);
      expect(within(card).getAllByRole('button')).toHaveLength(1);
      const button = within(card).getByRole('button', { name: 'Use this example ' + meta.name });
      expect(button.textContent).toBe('Use this example');
    }
  });

  it('keeps a visible focus outline in forced colors on the example button (L20-4)', () => {
    show();
    const button = screen.getAllByRole('button')[0];
    expect(button.className).toContain('focus-visible:ring-2');
    expect(button.className).toContain('forced-colors:focus-visible:outline');
  });

  it('has no links and no pills, and hides the swatch from assistive tech', () => {
    show();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByText('Needs repair')).toBeNull();
    const swatches = screen.getAllByTestId('theme-swatch');
    expect(swatches).toHaveLength(8);
    expect(swatches.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('presses with the example, and ignores a press while one is being made', () => {
    const onUse = show();
    fireEvent.click(screen.getByRole('button', { name: 'Use this example Inventory' }));
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse.mock.calls[0][0].id).toBe('inventory');
    cleanup();
    const again = show('inventory');
    const busy = screen.getByRole('button', { name: 'Making your app...' });
    expect(busy.textContent).toBe('Making your app...');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect((busy as HTMLButtonElement).disabled).toBe(false);
    const other = screen.getByRole('button', { name: 'Use this example Job Tracker' });
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect(other.getAttribute('aria-busy')).toBeNull();
    fireEvent.click(busy);
    fireEvent.click(other);
    expect(again).not.toHaveBeenCalled();
  });
});
