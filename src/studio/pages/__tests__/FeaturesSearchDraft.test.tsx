// The Features search box keeps what is typed while the address bar catches up (setSearchParams is a navigation that lands
// later; under load an input bound to it snapped back and lost keystrokes, and Escape left the last letter behind).
// useSearchParams is mocked so the address never moves on its own: the test decides when a write lands and what is outside.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import FeaturesPage from '../FeaturesPage';

const api = vi.hoisted(() => ({ list: vi.fn(), listApps: vi.fn() }));
vi.mock('../../services/studioApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/studioApi')>();
  return { ...actual, listApps: api.listApps, featuresApi: { ...actual.featuresApi, list: api.list } };
});
vi.mock('../../showcase/PreviewFrame', () => ({ default: () => <div data-testid="preview-stub" /> }));

const address = vi.hoisted(() => ({ current: '', writes: [] as string[] }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  const setParams = (next: URLSearchParams): void => {
    address.writes.push(next.toString());
  };
  return { ...actual, useSearchParams: () => [new URLSearchParams(address.current), setParams] };
});

const input = (): HTMLInputElement => screen.getByLabelText('Search parts and features') as HTMLInputElement;
const type = (value: string): void => {
  fireEvent.change(input(), { target: { value } });
};
// A fresh element each time: React skips a subtree whose element is the very same object, so rerender(tree) with one
// constant element would not run the page again.
const tree = () => (
  <MemoryRouter initialEntries={['/features']}>
    <FeaturesPage />
  </MemoryRouter>
);

beforeEach(() => {
  window.localStorage.clear();
  address.current = '';
  address.writes = [];
  api.list.mockResolvedValue(seedRecords());
  api.listApps.mockResolvedValue([]);
});
afterEach(cleanup);

describe('Features search draft', () => {
  it('keeps every keystroke while the address bar has not moved, and writes the whole text each time', async () => {
    render(tree());
    await screen.findByTestId('features-count');
    type('f');
    type('fo');
    type('for');
    expect(input().value).toBe('for');
    expect(address.writes).toEqual(['q=f', 'q=fo', 'q=for']);
  });

  it('ignores a landing it wrote itself, even an older one, and clears on Escape without the old letters coming back', async () => {
    const { rerender } = render(tree());
    await screen.findByTestId('features-count');
    type('fo');
    type('form');
    address.current = 'q=fo';
    rerender(tree());
    expect(input().value).toBe('form');

    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('');
    expect(address.writes.at(-1)).toBe('');
    // The last typed address lands after Escape: it was written here, so the box stays empty.
    address.current = 'q=form';
    rerender(tree());
    expect(input().value).toBe('');
  });

  it('takes an address it did not write, as after Back', async () => {
    const { rerender } = render(tree());
    await screen.findByTestId('features-count');
    type('table');
    address.current = 'q=spreadsheet';
    rerender(tree());
    expect(input().value).toBe('spreadsheet');
  });

  it('keeps the typed text when the category changes before the address moved', async () => {
    render(tree());
    await screen.findByTestId('features-count');
    type('bu');
    fireEvent.click(screen.getByRole('radio', { name: /^Actions/ }));
    expect(input().value).toBe('bu');
    expect(address.writes.at(-1)).toBe('q=bu&cat=action');
  });
});
