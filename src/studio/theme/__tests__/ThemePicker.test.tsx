import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Theme } from '@local-app-studio/runtime/spec/schema.ts';
import ThemePicker from '../ThemePicker';

afterEach(cleanup);

const LEGACY: Theme = { preset: 'aurora', radius: 'md' };

function Harness({ start, onChange }: { start: Theme; onChange?: (t: Theme) => void }) {
  const [value, setValue] = useState<Theme>(start);
  return (
    <ThemePicker
      value={value}
      idPrefix="t"
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('ThemePicker', () => {
  it('is a radio group of Plain first, the eight themes, plus Classic while no theme is chosen', () => {
    render(<Harness start={LEGACY} />);
    const look = screen.getAllByRole('radio').filter((r) => r.getAttribute('name') === 't-look');
    expect(look.map((r) => r.getAttribute('value'))).toEqual(['plain', 'classic', 'slate', 'paper', 'midnight', 'forest', 'sand', 'ocean', 'rose', 'mono']);
    expect((screen.getByRole('radio', { name: /Classic/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /^Plain/ }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('White and simple')).toBeTruthy();
    expect(screen.getByText('Changes show on the page right away. Save to keep them.')).toBeTruthy();
  });

  it('says how each theme starts (P17-18)', () => {
    render(<Harness start={LEGACY} />);
    expect(screen.getByText('Green and natural. Starts dark.')).toBeTruthy();
    expect(screen.getByText('Calm and warm. Starts light.')).toBeTruthy();
  });

  it('hides Classic once a theme is chosen and selects it', () => {
    const onChange = vi.fn();
    render(<Harness start={LEGACY} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Forest/ }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'forest', radius: 'md', id: 'forest' });
    expect(screen.queryByRole('radio', { name: /Classic/ })).toBeNull();
    expect((screen.getByRole('radio', { name: /Forest/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('keeps the accent, corner and mode controls off until a theme is chosen', () => {
    render(<Harness start={LEGACY} />);
    expect(screen.getByRole('radio', { name: 'Green' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('radio', { name: 'Square' }).matches(':disabled')).toBe(true);
    expect(screen.getByText('Pick a theme first to change its color, corners and how it starts.')).toBeTruthy();
  });

  it('writes overrides and switching a theme keeps the accent, corners and Starts as choices (P-31)', () => {
    const onChange = vi.fn();
    render(<Harness start={{ preset: 'forest', radius: 'md', id: 'forest' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Purple' }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'forest', radius: 'md', id: 'forest', overrides: { accentHue: 285 } });
    fireEvent.click(screen.getByRole('radio', { name: 'Round' }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'forest', radius: 'md', id: 'forest', overrides: { accentHue: 285, radius: 'lg' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'forest', radius: 'md', id: 'forest', overrides: { accentHue: 285, radius: 'lg', mode: 'dark' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Theme color' }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'forest', radius: 'md', id: 'forest', overrides: { radius: 'lg', mode: 'dark' } });
    fireEvent.click(screen.getByRole('radio', { name: /Paper/ }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'solid', radius: 'sm', id: 'paper', overrides: { radius: 'lg', mode: 'dark' } });
  });

  it('removes the overrides block when the last override is cleared', () => {
    const onChange = vi.fn();
    render(<Harness start={{ preset: 'forest', radius: 'md', id: 'forest', overrides: { accentHue: 140 } }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Theme color' }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'forest', radius: 'md', id: 'forest' });
  });

  it('shows plain words and no ids or setting names', () => {
    render(<Harness start={{ preset: 'forest', radius: 'md', id: 'forest' }} />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/accentHue|overrides|preset|radius|--/);
  });
  it('lets the corner choices wrap instead of cutting the last one off', () => {
    render(<Harness start={{ preset: 'forest', radius: 'md', id: 'forest' }} />);
    const row = screen.getByTestId('corners-row');
    expect(row.className).toContain('flex-wrap');
    expect(row.querySelectorAll('input[type="radio"]')).toHaveLength(5);
    expect(row.textContent).toContain('Round');
  });
});

describe('ThemePicker: Plain', () => {
  it('sets the plain look (no id, solid background, corners kept) and then is the only no-theme entry', () => {
    const onChange = vi.fn();
    render(<Harness start={{ preset: 'forest', radius: 'lg', id: 'forest', overrides: { accentHue: 140 } }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Plain/ }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'solid', radius: 'lg' });
    expect((screen.getByRole('radio', { name: /^Plain/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('radio', { name: /Classic/ })).toBeNull();
    const look = screen.getAllByRole('radio').filter((r) => r.getAttribute('name') === 't-look');
    expect(look[0].getAttribute('value')).toBe('plain');
    expect(screen.getByRole('radio', { name: 'Green' }).matches(':disabled')).toBe(true);
  });

  it('picking a theme from Plain writes the theme, and Plain does nothing when it is already chosen', () => {
    const onChange = vi.fn();
    render(<Harness start={{ preset: 'solid', radius: 'md' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /^Plain/ }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Forest/ }));
    expect(onChange).toHaveBeenLastCalledWith({ preset: 'forest', radius: 'md', id: 'forest' });
  });
});
