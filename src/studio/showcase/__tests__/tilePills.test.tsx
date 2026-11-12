// The Needs a table pill and its screen-reader text on a tile: the Features page default, the Design shelf (from the page's tables) and
// the Feature builder shelf (no Look tab, hidden entries).
import { DndContext } from '@dnd-kit/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEED_FEATURES } from '@/catalog/features';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { DesignContext } from '../../design/DesignContext';
import type { DesignContextValue } from '../../design/DesignContext';
import FeatureShelf from '../../design/FeatureShelf';
import { libraryOf } from '../../hooks/useFeatures';
import { specOf } from '../../lib/__tests__/bindFixtures';
import { buildShowcaseEntries } from '../entries';
import FeatureTile from '../FeatureTile';

vi.mock('../PreviewFrame', () => ({ default: () => <div data-testid="preview-stub" /> }));

afterEach(cleanup);

const library = new Map(SEED_FEATURES.map((d) => [d.id, d]));
const entries = buildShowcaseEntries(seedRecords());
const entry = (id: string) => {
  const found = entries.find((e) => e.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};
const tile = (id: string): HTMLElement => {
  const el = screen.getAllByTestId('feature-tile').find((t) => t.dataset.entryKey?.endsWith(`:${id}`));
  if (el === undefined) throw new Error(`no tile ${id}`);
  return el;
};

describe('FeatureTile pill', () => {
  it('on the Features page (needsTable undefined) every entry that draws rows says Needs a table', () => {
    render(
      <ul>
        <FeatureTile entry={entry('DataTable')} library={library} size="md" onOpen={vi.fn()} actions={[]} />
        <FeatureTile entry={entry('Heading')} library={library} size="md" onOpen={vi.fn()} actions={[]} />
      </ul>,
    );
    const [data, plain] = screen.getAllByTestId('feature-tile');
    const pill = within(data).getByText('Needs a table', { selector: '[data-indicator]' });
    expect(pill.getAttribute('data-indicator')).toBe('needs_table');
    expect(within(plain).queryByText('Needs a table', { selector: '[data-indicator]' })).toBeNull();
  });

  it('puts the pill after the category chip and Sample data, and adds the words to the description', () => {
    render(
      <ul>
        <FeatureTile entry={entry('DataTable')} library={library} size="sm" onOpen={vi.fn()} actions={[]} />
      </ul>,
    );
    const chips = screen.getByRole('button').querySelectorAll('span.flex > span');
    expect(Array.from(chips).map((c) => c.textContent)).toEqual(['Records', 'Sample data', 'Needs a table']);
    const describedBy = screen.getByRole('button').getAttribute('aria-describedby') ?? '';
    const words = describedBy.split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(words).toContain('Needs a table');
    expect(words).toContain('Sample data');
  });

  it('needsTable false draws no pill and no words', () => {
    render(
      <ul>
        <FeatureTile entry={entry('DataTable')} library={library} size="md" onOpen={vi.fn()} actions={[]} needsTable={false} />
      </ul>,
    );
    expect(screen.queryByText('Needs a table')).toBeNull();
  });
});

const designValue = (spec: AppSpec, hidden: readonly string[] | null): DesignContextValue =>
  ({
    ctx: partContextFor(spec, spec.pages[0]),
    ...(hidden === null ? {} : { builder: { hidesEntry: (key: string) => hidden.includes(key) } }),
  }) as unknown as DesignContextValue;

function shelf(value: DesignContextValue | null) {
  const features = seedRecords();
  render(
    <DesignContext.Provider value={value}>
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
      </DndContext>
    </DesignContext.Provider>,
  );
}

const pillOn = (id: string): HTMLElement | null => within(tile(id)).queryByText('Needs a table', { selector: '[data-indicator]' });

describe('FeatureShelf pills and the builder', () => {
  it('an app with no table: data parts and list features say Needs a table, plain parts do not', () => {
    const base = specOf();
    shelf(designValue({ ...base, tables: [], pages: base.pages.map((p) => ({ ...p, sources: [] })) }, null));
    expect(pillOn('DataTable')).not.toBeNull();
    expect(pillOn('kpi_row')).not.toBeNull();
    expect(pillOn('Heading')).toBeNull();
  });

  it('an app whose page has a list that fits: no pill on the same entries', () => {
    shelf(designValue(specOf(), null));
    expect(pillOn('DataTable')).toBeNull();
    expect(pillOn('kpi_row')).toBeNull();
  });

  it('without a design context (the shelf alone) it falls back to the Features page default', () => {
    shelf(null);
    expect(pillOn('DataTable')).not.toBeNull();
  });

  it('keeps the Look tab in a normal session', () => {
    shelf(designValue(specOf(), null));
    expect(screen.getByRole('tab', { name: 'Look' })).toBeTruthy();
  });

  it('in the builder there is no Look tab and hidden entries are gone', () => {
    shelf(designValue(specOf(), ['part:Heading', 'feature:kpi_row']));
    expect(screen.queryByRole('tab', { name: 'Look' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryAllByTestId('feature-tile').some((t) => t.dataset.entryKey === 'part:Heading')).toBe(false);
    expect(screen.queryAllByTestId('feature-tile').some((t) => t.dataset.entryKey === 'feature:kpi_row')).toBe(false);
    expect(screen.queryAllByTestId('feature-tile').some((t) => t.dataset.entryKey === 'part:DataTable')).toBe(true);
  });
});
