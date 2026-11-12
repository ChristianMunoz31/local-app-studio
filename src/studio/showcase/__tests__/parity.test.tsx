// The Features page and the Design shelf share one search, one category choice, one count and one empty state (UX-62): the same
// words give the same names in the same order in both, and a damaged feature is listed in both with what is wrong.
import { DndContext } from '@dnd-kit/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryOf } from '../../hooks/useFeatures';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import FeatureShelf from '../../design/FeatureShelf';
import type { ShelfFilters } from '../../design/FeatureShelf';
import FeaturesPage from '../../pages/FeaturesPage';
import { featuresApi } from '../../services/studioApi';
import type { FeatureRecord } from '../../types';

vi.mock('../PreviewFrame', () => ({ default: () => <div data-testid="preview-stub" /> }));

/** The seed features, one of them damaged. */
const records = (): FeatureRecord[] =>
  seedRecords().map((r, i) => (i === 0 ? { ...r, ok: false, fragment: null, issues: [{ path: 'fragment', code: 'invalid', message: 'Invalid input' }] } : r));

const keysOnScreen = (): string[] => screen.queryAllByTestId('feature-tile').map((el) => el.dataset.entryKey ?? '');
const namesOnScreen = (): string[] => screen.queryAllByTestId('feature-tile').map((el) => el.querySelector('span.truncate')?.textContent ?? '');

async function onPage(query: string, category: string): Promise<{ keys: string[]; names: string[]; count: string }> {
  vi.spyOn(featuresApi, 'list').mockResolvedValue(records());
  const params = new URLSearchParams();
  if (query !== '') params.set('q', query);
  if (category !== 'all') params.set('cat', category);
  render(
    <MemoryRouter initialEntries={[`/features?${params.toString()}`]}>
      <FeaturesPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByTestId('features-loading')).toBeNull());
  await screen.findByTestId('features-count');
  const out = { keys: keysOnScreen(), names: namesOnScreen(), count: screen.getByTestId('features-count').textContent ?? '' };
  cleanup();
  return out;
}

function onShelf(query: string, category: string): { keys: string[]; names: string[]; count: string } {
  const features = records();
  const filters: ShelfFilters = { query, category: category as ShelfFilters['category'] };
  render(
    <DndContext>
      <FeatureShelf
        features={features}
        library={libraryOf(features)}
        theme={{ preset: 'aurora', radius: 'md' }}
        tab="features"
        onTab={() => {}}
        onTheme={() => {}}
        filters={filters}
        onFilters={() => {}}
        selectedKey={null}
        onSelect={() => {}}
        onAdd={() => {}}
        searchRef={createRef<HTMLInputElement>()}
        note={null}
      />
    </DndContext>,
  );
  const out = { keys: keysOnScreen(), names: namesOnScreen(), count: screen.getByTestId('features-count').textContent ?? '' };
  cleanup();
  return out;
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Features page and the Design shelf', () => {
  it.each([
    ['', 'all'],
    ['table', 'all'],
    ['form', 'all'],
    ['number', 'all'],
    ['spreadsheet', 'all'],
    ['crew', 'all'],
    ['', 'data'],
    ['', 'custom'],
    ['zzz', 'all'],
  ])('give the same names in the same order for "%s" in %s', async (query, category) => {
    const page = await onPage(query, category);
    const shelf = onShelf(query, category);
    expect(shelf.keys).toEqual(page.keys);
    expect(shelf.names).toEqual(page.names);
    expect(shelf.count).toBe(page.count);
    expect(page.count).toBe(`${page.keys.length} shown`);
  });

  it('list a damaged feature in both, greyed with Needs repair', async () => {
    const broken = `feature:${records()[0].id}`;
    const page = await onPage('', 'custom');
    expect(page.keys).toContain(broken);
    const shelf = onShelf('', 'custom');
    expect(shelf.keys).toContain(broken);
    // On the shelf a damaged feature cannot be added: it says so instead of offering Add.
    const features = records();
    render(
      <DndContext>
        <FeatureShelf
          features={features}
          library={libraryOf(features)}
          theme={{ preset: 'aurora', radius: 'md' }}
          tab="features"
          onTab={() => {}}
          onTheme={() => {}}
          filters={{ query: '', category: 'custom' }}
          onFilters={() => {}}
          selectedKey={null}
          onSelect={() => {}}
          onAdd={() => {}}
          searchRef={createRef<HTMLInputElement>()}
          note={null}
        />
      </DndContext>,
    );
    expect(screen.getByText('Needs repair')).toBeTruthy();
    expect(screen.getByText('Damaged, so it cannot be added.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: `Add ${features[0].label}` })).toBeNull();
  });

  it('say the same thing when nothing matches', async () => {
    vi.spyOn(featuresApi, 'list').mockResolvedValue(records());
    render(
      <MemoryRouter initialEntries={['/features?q=zzz']}>
        <FeaturesPage />
      </MemoryRouter>,
    );
    const onPageText = (await screen.findByText('Nothing matches "zzz". Try another word.')).textContent;
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
    cleanup();
    const features = records();
    render(
      <DndContext>
        <FeatureShelf
          features={features}
          library={libraryOf(features)}
          theme={{ preset: 'aurora', radius: 'md' }}
          tab="features"
          onTab={() => {}}
          onTheme={() => {}}
          filters={{ query: 'zzz', category: 'all' }}
          onFilters={() => {}}
          selectedKey={null}
          onSelect={() => {}}
          onAdd={() => {}}
          searchRef={createRef<HTMLInputElement>()}
          note={null}
        />
      </DndContext>,
    );
    expect(screen.getByText('Nothing matches "zzz". Try another word.').textContent).toBe(onPageText);
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
  });

  it('use one search field, one category choice and one count', async () => {
    const features = records();
    render(
      <DndContext>
        <FeatureShelf
          features={features}
          library={libraryOf(features)}
          theme={{ preset: 'aurora', radius: 'md' }}
          tab="features"
          onTab={() => {}}
          onTheme={() => {}}
          filters={{ query: '', category: 'all' }}
          onFilters={() => {}}
          selectedKey={null}
          onSelect={() => {}}
          onAdd={() => {}}
          searchRef={createRef<HTMLInputElement>()}
          note={null}
        />
      </DndContext>,
    );
    const field = screen.getByRole('searchbox', { name: 'Search parts and features' }) as HTMLInputElement;
    expect(field.placeholder).toBe('For example: form, table or button');
    expect(screen.getByRole('group', { name: 'Show' })).toBeTruthy();
    const shelfPills = screen.getAllByRole('radio').map((r) => (r.nextElementSibling as HTMLElement).textContent);
    cleanup();
    vi.spyOn(featuresApi, 'list').mockResolvedValue(records());
    render(
      <MemoryRouter initialEntries={['/features']}>
        <FeaturesPage />
      </MemoryRouter>,
    );
    const pageField = (await screen.findByRole('searchbox', { name: 'Search parts and features' })) as HTMLInputElement;
    expect(pageField.placeholder).toBe(field.placeholder);
    expect(screen.getByRole('group', { name: 'Show' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => (r.nextElementSibling as HTMLElement).textContent)).toEqual(shelfPills);
  });
});
