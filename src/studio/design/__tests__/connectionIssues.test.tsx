// The "Data connections" list (UX-51): a part of the open page that is not connected is not listed (its box, its settings and the
// Save reason say it); other pages and writes to a table the page does not show stay, and "Open page" is never switched off.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConnectionIssues from '../ConnectionIssues';
import type { ConnectionIssue } from '../connections';

afterEach(cleanup);

const issue = (over: Partial<ConnectionIssue>): ConnectionIssue => ({
  key: 'home|t1|not_connected',
  code: 'not_connected',
  pageId: 'home',
  pageTitle: 'Home',
  layerId: 't1',
  target: 'props.source',
  message: 'The Table of records on Home needs a table.',
  offer: null,
  dismissible: false,
  ...over,
});

const props = { kept: new Set<string>(), pageId: 'home', onFix: vi.fn(), onOpenPage: vi.fn(), onKeep: vi.fn(), onShowAgain: vi.fn() };

describe('ConnectionIssues', () => {
  it('lists nothing for a part of the open page that is not connected', () => {
    const { container } = render(<ConnectionIssues {...props} issues={[issue({})]} />);
    expect(container.textContent).toBe('');
  });

  it('lists a part of another page and opens that page, whatever the open page holds', () => {
    const other = issue({ key: 'about|t2|not_connected', pageId: 'about', pageTitle: 'About', layerId: 't2', message: 'The Table of records on About needs a table.' });
    render(<ConnectionIssues {...props} issues={[issue({}), other]} />);
    expect(screen.getByText('The Table of records on About needs a table.')).toBeTruthy();
    expect(screen.queryByText('The Table of records on Home needs a table.')).toBeNull();
    const open = screen.getByRole('button', { name: 'Open page' }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    expect(props.onOpenPage).toHaveBeenCalledWith('about');
  });

  it('keeps a write to a table the page does not show, with Change table and Keep it this way', () => {
    const write = issue({
      key: 'home|q1|other_table|people',
      code: 'other_table',
      layerId: 'q1',
      target: 'props.table',
      message: 'The Quick add on Home adds to People, but nothing on this page shows People.',
      dismissible: true,
    });
    render(<ConnectionIssues {...props} issues={[write]} />);
    expect(screen.getByRole('region', { name: 'Data connections' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change table' }));
    expect(props.onFix).toHaveBeenCalledWith(write);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it this way' }));
    expect(props.onKeep).toHaveBeenCalledWith(write.key);
  });

  it('every row button is described by its row message', () => {
    const other = issue({ key: 'about|t2|not_connected', pageId: 'about', pageTitle: 'About', layerId: 't2', message: 'The Table of records on About needs a table.' });
    const write = issue({ key: 'about|q1|other_table|people', code: 'other_table', pageId: 'about', layerId: 'q1', message: 'The Quick add on About adds to People.', dismissible: true });
    render(<ConnectionIssues {...props} issues={[other, write]} />);
    const rows = Array.from(document.querySelectorAll('[data-connection-issue]'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const message = row.querySelector('span') as HTMLElement;
      const buttons = Array.from(row.querySelectorAll('button'));
      expect(buttons.length).toBeGreaterThan(0);
      for (const b of buttons) expect(b.getAttribute('aria-describedby')).toBe(message.id);
    }
    expect(new Set(rows.map((r) => (r.querySelector('span') as HTMLElement).id)).size).toBe(2);
  });
});
