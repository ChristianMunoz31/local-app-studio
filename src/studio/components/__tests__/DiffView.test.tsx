import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';
import DiffView from '../DiffView';

afterEach(cleanup);
const clone = (): AppSpec => structuredClone(baseSpec());

describe('DiffView', () => {
  it('says there are no changes', () => {
    render(<DiffView before={baseSpec()} after={clone()} />);
    expect(screen.getByText('No changes.')).toBeTruthy();
  });

  it('groups plain sentences under Added, Changed and Removed, with data changes first in a warning box', () => {
    const next = clone();
    next.tables.push({ id: 'people', label: 'People', fields: [{ id: 'name', label: 'Name', type: 'text', required: false }] });
    next.tables[0].fields = next.tables[0].fields.filter((f) => f.id !== 'size');
    next.pages[0].title = 'Start';
    next.theme = { preset: 'ocean', radius: 'lg' };
    render(<DiffView before={baseSpec()} after={next} />);
    const warn = screen.getByRole('region', { name: 'Changes that remove or reshape data' });
    expect(within(warn).getByText('These changes remove or reshape data')).toBeTruthy();
    expect(within(warn).getByRole('heading', { name: 'Removed' })).toBeTruthy();
    expect(within(warn).getByText('Removes the field "Size" from "Crews".')).toBeTruthy();
    expect(warn.className).toContain('border-accent-red/40');
    expect(warn.className).not.toContain('red-red');
    const other = screen.getByRole('region', { name: 'Other changes' });
    expect(within(other).getByRole('heading', { name: 'Added' })).toBeTruthy();
    expect(within(other).getByRole('heading', { name: 'Changed' })).toBeTruthy();
    expect(within(other).queryByRole('heading', { name: 'Removed' })).toBeNull();
    expect(within(other).getByText('Changes the background to Ocean.')).toBeTruthy();
    expect(within(other).getByText('Changes the corners to Large.')).toBeTruthy();
  });
});
