// The box of a part that is not connected: the pill, which buttons each indicator shows (app and builder), and that a press never reaches the block behind it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectOffer } from '../../lib/bindOnDrop';
import type { FieldNeed } from '../../lib/partFields';
import type { PartIndicator } from '../indicator';
import NotConnected from '../NotConnected';

afterEach(cleanup);

const needsTable = (offer: ConnectOffer | null): PartIndicator => ({ state: 'needs_table', text: 'Needs a table', offer, target: 'props.source' });
const needsField = (tables: string[], types: FieldNeed['types'] = ['boolean']): PartIndicator => ({
  state: 'needs_field',
  text: types[0] === 'reference' ? 'Needs a link field' : 'Needs a yes or no field',
  needs: [{ prop: 'field', types }],
  tables,
  target: 'props.source',
});

function show(indicator: PartIndicator, builder = false) {
  if (indicator.state !== 'needs_table' && indicator.state !== 'needs_field') throw new Error('needs only');
  const calls = { connect: vi.fn(), newTable: vi.fn(), addField: vi.fn(), parent: vi.fn() };
  render(
    <div onClick={calls.parent}>
      <NotConnected partName="Checklist" indicator={indicator} builder={builder} onConnect={calls.connect} onNewTable={calls.newTable} onAddField={calls.addField} />
    </div>,
  );
  return calls;
}

describe('NotConnected in an app', () => {
  it('a table fits: the pill and Connect, and the press stops at the box', () => {
    const calls = show(needsTable(null));
    expect(document.querySelector('[data-indicator="needs_table"]')?.textContent).toBe('Needs a table');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Checklist to a table' }));
    expect(calls.connect).toHaveBeenCalledTimes(1);
    expect(calls.parent).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /New table|Add a field/ })).toBeNull();
  });

  it('no table: the hint and only New table', () => {
    const calls = show(needsTable({ kind: 'no_table' }));
    expect(screen.getByText('This app has no table yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a field/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Connect/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Make a new table for Checklist' }));
    expect(calls.newTable).toHaveBeenCalledTimes(1);
    expect(calls.parent).not.toHaveBeenCalled();
  });

  it('no field with a table that has room: the pill says it, then Add a field and New table', () => {
    const calls = show(needsField(['crews']));
    expect(document.querySelector('[data-indicator="needs_field"]')?.textContent).toBe('Needs a yes or no field');
    fireEvent.click(screen.getByRole('button', { name: 'Add a field for Checklist' }));
    expect(calls.addField).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Make a new table for Checklist' }));
    expect(calls.newTable).toHaveBeenCalledTimes(1);
    expect(calls.parent).not.toHaveBeenCalled();
  });

  it('no field and no table with room: New table only', () => {
    show(needsField([], ['reference']));
    expect(screen.queryByRole('button', { name: 'Add a field for Checklist' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make a new table for Checklist' })).toBeTruthy();
  });

  it('a full page says so and offers nothing that would refuse', () => {
    show(needsTable({ kind: 'full' }));
    expect(screen.getByText('This page already has 8 lists. Remove one in Page settings first.')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('NotConnected in the Feature builder', () => {
  it('no table: says there is no slot and offers Add a table slot', () => {
    const calls = show(needsTable({ kind: 'no_table' }), true);
    expect(screen.getByText('This feature has no table slot yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Make a new table/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add a table slot for Checklist' }));
    expect(calls.newTable).toHaveBeenCalledTimes(1);
  });

  it('no field: Add a field slot and Add a table slot', () => {
    const calls = show(needsField(['crews']), true);
    fireEvent.click(screen.getByRole('button', { name: 'Add a field slot for Checklist' }));
    expect(calls.addField).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add a table slot for Checklist' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add a field for/ })).toBeNull();
  });

  it('a table fits: still Connect', () => {
    show(needsTable(null), true);
    expect(screen.getByRole('button', { name: 'Connect Checklist to a table' })).toBeTruthy();
  });

  it('a full page offers nothing', () => {
    show(needsTable({ kind: 'full' }), true);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
