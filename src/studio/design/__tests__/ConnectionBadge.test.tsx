// The one indicator pill: the Change table button on the canvas, a plain pill elsewhere, and the data attributes the e2e locators use.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConnectionBadge, { NewerVersionPill } from '../ConnectionBadge';
import type { PartIndicator } from '../indicator';

afterEach(cleanup);

const connected: PartIndicator = { state: 'connected', table: 'crews', tableLabel: 'Crews', text: 'Connected to Crews', target: 'props.source' };
const slot: PartIndicator = { state: 'slot', table: 'crews', tableLabel: 'Crews', text: 'Uses slot Crews', target: 'props.source' };
const needsTable: PartIndicator = { state: 'needs_table', text: 'Needs a table', offer: null, target: 'props.table' };
const needsField: PartIndicator = { state: 'needs_field', text: 'Needs a yes or no field', needs: [{ prop: 'field', types: ['boolean'] }], tables: [], target: 'props.source' };

describe('ConnectionBadge', () => {
  it('with onChange it is a button whose name holds the visible words and stops the press', () => {
    const onChange = vi.fn();
    const parent = vi.fn();
    render(
      <div onClick={parent}>
        <ConnectionBadge indicator={connected} onChange={onChange} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Connected to Crews. Change table' });
    // The name is the aria-label alone: the button has no title that repeats it and no hidden span that says it twice.
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.querySelector('.sr-only')).toBeNull();
    expect(button.textContent).toBe('Connected to Crews');
    expect(button.getAttribute('data-connection-badge')).toBe('crews');
    expect(button.getAttribute('data-indicator')).toBe('connected');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
  });

  it('a slot pill is the same button with its own words and state', () => {
    render(<ConnectionBadge indicator={slot} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Uses slot Crews. Change table' });
    expect(button.getAttribute('data-indicator')).toBe('slot');
    expect(button.getAttribute('data-connection-badge')).toBe('crews');
  });

  it('without onChange it is a plain pill with the words, no role and the words in the title', () => {
    render(<ConnectionBadge indicator={connected} />);
    expect(screen.queryByRole('button')).toBeNull();
    const pill = screen.getByText('Connected to Crews');
    expect(pill.tagName).toBe('SPAN');
    expect(pill.getAttribute('title')).toBe('Connected to Crews');
    expect(pill.getAttribute('data-connection-badge')).toBe('crews');
    expect(pill.className).toContain('break-words');
  });

  it('a needs pill is plain text with its state, even when onChange is given, and has no connection attribute', () => {
    render(<ConnectionBadge indicator={needsTable} onChange={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
    const pill = screen.getByText('Needs a table');
    expect(pill.getAttribute('data-indicator')).toBe('needs_table');
    expect(pill.hasAttribute('data-connection-badge')).toBe(false);
    cleanup();
    render(<ConnectionBadge indicator={needsField} />);
    expect(screen.getByText('Needs a yes or no field').getAttribute('data-indicator')).toBe('needs_field');
  });

  it('a needs pill with opensSettings is a button that opens the settings, like the connected pill', () => {
    const onChange = vi.fn();
    render(<ConnectionBadge indicator={needsTable} onChange={onChange} opensSettings />);
    const button = screen.getByRole('button', { name: 'Needs a table. Open settings' });
    expect(button.getAttribute('data-indicator')).toBe('needs_table');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the tile size is never a button', () => {
    render(<ConnectionBadge indicator={connected} onChange={() => {}} size="sm" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Connected to Crews')).toBeTruthy();
  });

  it('uses the tone of its state', () => {
    render(
      <>
        <ConnectionBadge indicator={connected} />
        <ConnectionBadge indicator={needsTable} />
        <ConnectionBadge indicator={slot} />
      </>,
    );
    expect(screen.getByText('Connected to Crews').className).toContain('--studio-pill-ok-bg');
    expect(screen.getByText('Needs a table').className).toContain('--studio-pill-warn-bg');
    expect(screen.getByText('Uses slot Crews').className).toContain('--studio-pill-muted-bg');
  });
});

describe('NewerVersionPill', () => {
  it('is a button that opens the settings and stops the press, or a plain pill without a handler', () => {
    const onOpen = vi.fn();
    const parent = vi.fn();
    render(
      <div onClick={parent}>
        <NewerVersionPill onOpen={onOpen} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Newer version. Open settings' });
    expect(button.getAttribute('data-indicator')).toBe('newer_version');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(parent).not.toHaveBeenCalled();
    cleanup();
    render(<NewerVersionPill />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Newer version').getAttribute('data-indicator')).toBe('newer_version');
  });
});
