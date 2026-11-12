import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import StepHeader from '../StepHeader';

afterEach(cleanup);

const Where = () => {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}|${JSON.stringify(location.state)}`}</p>;
};

const nav = (over: Partial<ComponentProps<typeof StepHeader>['nav']> = {}): ComponentProps<typeof StepHeader>['nav'] => ({
  back: 'data',
  forward: 'build',
  forwardPrimary: true,
  forwardBlocked: null,
  busy: false,
  onBack: vi.fn(),
  onNext: vi.fn(),
  ...over,
});

const renderHeader = (props: Partial<ComponentProps<typeof StepHeader>> = {}) => {
  const all: ComponentProps<typeof StepHeader> = {
    appId: 'a1',
    states: { prompt: 'done', design: 'done', data: 'todo', preview: 'current', build: 'todo' },
    current: 'preview',
    next: 'build',
    nav: nav(),
    ...props,
  };
  render(
    <MemoryRouter initialEntries={['/apps/a1/preview']}>
      <Routes>
        <Route path="*" element={<StepHeader {...all} />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return all;
};

describe('StepHeader', () => {
  it('lists five steps in the order of work, marks current, done and next', () => {
    renderHeader();
    const rail = screen.getByRole('navigation', { name: 'Steps' });
    const links = within(rail).getAllByRole('link');
    expect(links.map((a) => a.textContent?.replace(/ \((done|next)\)/g, ''))).toEqual(['Prompt', 'Design', '3Data', '4Preview', '5Build']);
    expect(within(rail).getByRole('link', { name: /Preview/ }).getAttribute('aria-current')).toBe('step');
    expect(within(rail).getAllByText('(done)')).toHaveLength(2);
    expect(within(rail).getByRole('link', { name: /Build/ }).textContent).toContain('(next)');
    expect(within(rail).getByRole('link', { name: /Build/ }).querySelector('.ring-accent-indigo')).not.toBeNull();
    expect(within(rail).getByRole('link', { name: /Preview/ }).className).toContain('bg-slate-brand');
  });

  it('never marks the current step as next', () => {
    renderHeader({ next: 'preview' });
    expect(screen.queryByText('(next)')).toBeNull();
  });

  it('links each step to its path with the step focus state, with no click handler of its own', () => {
    renderHeader();
    const link = screen.getByRole('link', { name: /Design/ });
    expect(link.getAttribute('href')).toBe('/apps/a1/design');
    fireEvent.click(link);
    expect(screen.getByTestId('where').textContent).toBe('/apps/a1/design|{"stepFocus":true}');
  });

  it('puts Back and Next in one group with the step names and calls them', () => {
    const props = renderHeader();
    const group = screen.getByRole('group', { name: 'Move between steps' });
    const back = within(group).getByRole('button', { name: 'Back: Data' });
    const next = within(group).getByRole('button', { name: 'Next: Build' });
    expect(next.className).toContain(btnPrimary);
    fireEvent.click(back);
    fireEvent.click(next);
    expect(props.nav.onBack).toHaveBeenCalledTimes(1);
    expect(props.nav.onNext).toHaveBeenCalledTimes(1);
  });

  it('uses a secondary Next where the body has its own primary, and hides Back on the first step', () => {
    renderHeader({ current: 'prompt', nav: nav({ back: null, forward: 'design', forwardPrimary: false }) });
    expect(screen.queryByRole('button', { name: /^Back/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Next: Design' }).className).toContain(btnSecondary);
  });

  it('takes the rail width from widthClass, max-w-5xl by default', () => {
    renderHeader();
    expect(screen.getByRole('navigation', { name: 'Steps' }).parentElement?.className).toContain('max-w-5xl');
    cleanup();
    renderHeader({ widthClass: 'max-w-screen-2xl' });
    const rail = screen.getByRole('navigation', { name: 'Steps' }).parentElement?.className ?? '';
    expect(rail).toContain('max-w-screen-2xl');
    expect(rail).not.toContain('max-w-5xl');
  });

  it('holds the reason row while Next is there, empty when it is not blocked, and none without Next', () => {
    renderHeader();
    const row = screen.getByRole('button', { name: 'Next: Build' }).parentElement?.parentElement?.lastElementChild as HTMLElement;
    expect(row.className).toContain('min-h-4');
    expect(row.textContent).toBe('');
    cleanup();
    renderHeader({ nav: nav({ forward: null }) });
    expect(document.querySelector('.min-h-4')).toBeNull();
  });

  it('turns Next off with a visible reason that describes it', () => {
    renderHeader({ nav: nav({ forwardBlocked: 'Press Use this or Try again first.' }) });
    const next = screen.getByRole('button', { name: 'Next: Build' }) as HTMLButtonElement;
    // aria-disabled, not disabled: a keyboard user can still reach Next and hear why it does not move.
    expect(next.disabled).toBe(false);
    expect(next.getAttribute('aria-disabled')).toBe('true');
    next.focus();
    expect(document.activeElement).toBe(next);
    const reason = screen.getByText('Press Use this or Try again first.');
    expect(next.getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('shows the busy label while moving', () => {
    renderHeader({ nav: nav({ busy: true }) });
    const next = screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('button', { name: 'Back: Data' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(next);
  });
});
