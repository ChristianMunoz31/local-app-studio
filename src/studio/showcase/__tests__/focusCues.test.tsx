// The pills and the Show as toggle keep a focus and a selected cue that forced-colors mode does not remove (outlines, not shadows or colors).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ViewModeToggle from '../../theme/ViewModeToggle';
import CategoryPills from '../CategoryPills';
import type { CategoryChoice } from '../search';

afterEach(cleanup);

describe('focus and selected cues', () => {
  it('the category pills show the radio focus as an outline', () => {
    const counts = { all: 3, layout: 1 } as unknown as Record<CategoryChoice, number>;
    render(<CategoryPills value="all" counts={counts} onChange={() => {}} />);
    const pill = screen.getAllByRole('radio')[0].nextElementSibling;
    expect(pill?.className).toContain('peer-focus-visible:outline');
    expect(pill?.className).not.toContain('peer-focus-visible:ring');
  });

  it('the selected Show as option has an outline in forced colors, not only a color', () => {
    render(<ViewModeToggle mode="dark" onChange={() => {}} />);
    const selected = screen.getByRole('radio', { name: 'Dark' }).nextElementSibling;
    const other = screen.getByRole('radio', { name: 'Light' }).nextElementSibling;
    expect(selected?.className).toContain('forced-colors:outline');
    expect(other?.className).not.toContain('forced-colors:outline');
  });
});
