// The Fix all button of the "Data connections" list (phase 25): shown with the list when something of the open page can be fixed
// and an owner of the press is given, hidden otherwise (nothing of the open page to fix, kept on purpose, no handler).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConnectionIssues from '../ConnectionIssues';
import type { ConnectionIssue } from '../connections';

afterEach(cleanup);

const issue = (over: Partial<ConnectionIssue>): ConnectionIssue => ({
  key: 'home|q1|other_table|people',
  code: 'other_table',
  pageId: 'home',
  pageTitle: 'Home',
  layerId: 'q1',
  target: 'props.table',
  message: 'The Quick add on Home adds to People, but nothing on this page shows People.',
  offer: null,
  dismissible: true,
  ...over,
});
const elsewhere = issue({ key: 'about|t2|not_connected', code: 'not_connected', pageId: 'about', pageTitle: 'About', layerId: 't2', dismissible: false, message: 'The Table of records on About needs a table.' });
const own = issue({ key: 'home|t1|not_connected', code: 'not_connected', layerId: 't1', dismissible: false, message: 'The Table of records on Home needs a table.' });

const props = { kept: new Set<string>(), pageId: 'home', onFix: vi.fn(), onOpenPage: vi.fn(), onKeep: vi.fn(), onShowAgain: vi.fn() };
const fixAll = (): HTMLElement | null => screen.queryByRole('button', { name: 'Fix all' });

describe('ConnectionIssues, Fix all', () => {
  it('shows Fix all in the heading row and calls the handler once on a press', () => {
    const onFixAll = vi.fn();
    render(<ConnectionIssues {...props} issues={[issue({}), elsewhere]} onFixAll={onFixAll} />);
    const button = fixAll() as HTMLElement;
    expect(button.parentElement?.querySelector('h3')?.textContent).toBe('Data connections');
    fireEvent.click(button);
    expect(onFixAll).toHaveBeenCalledTimes(1);
  });

  it('counts a not-connected part of the open page that the list itself does not show', () => {
    render(<ConnectionIssues {...props} issues={[own, elsewhere]} onFixAll={vi.fn()} />);
    expect(fixAll()).not.toBeNull();
    expect(screen.queryByText('The Table of records on Home needs a table.')).toBeNull();
  });

  it('shows the heading row with Fix all when the only issues are the open page own not-connected parts', () => {
    render(<ConnectionIssues {...props} issues={[own]} onFixAll={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Data connections' })).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(fixAll()).not.toBeNull();
  });

  it('describes Fix all by the heading', () => {
    render(<ConnectionIssues {...props} issues={[issue({}), elsewhere]} onFixAll={vi.fn()} />);
    expect(fixAll()?.getAttribute('aria-describedby')).toBe(screen.getByRole('heading', { name: 'Data connections' }).id);
  });

  it('shows nothing for own not-connected parts without a handler', () => {
    const { container } = render(<ConnectionIssues {...props} issues={[own]} />);
    expect(container.textContent).toBe('');
  });

  it('is hidden without a handler', () => {
    render(<ConnectionIssues {...props} issues={[issue({}), elsewhere]} />);
    expect(fixAll()).toBeNull();
  });

  it('is hidden when only other pages have issues', () => {
    render(<ConnectionIssues {...props} issues={[elsewhere]} onFixAll={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Data connections' })).toBeTruthy();
    expect(fixAll()).toBeNull();
  });

  it('is hidden when the only issue of the open page was kept on purpose', () => {
    const write = issue({});
    render(<ConnectionIssues {...props} kept={new Set([write.key])} issues={[write, elsewhere]} onFixAll={vi.fn()} />);
    expect(fixAll()).toBeNull();
  });

  it('shows nothing when there is no list at all', () => {
    const { container } = render(<ConnectionIssues {...props} issues={[]} onFixAll={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
