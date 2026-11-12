// In the Feature builder the shelf is one list of features: no tablist, tab or tabpanel roles for a single tab.
import { DndContext } from '@dnd-kit/core';
import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { ContextType } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { libraryOf } from '../../hooks/useFeatures';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { DesignContext } from '../DesignContext';
import FeatureShelf from '../FeatureShelf';

afterEach(cleanup);

function shelf(inBuilder: boolean) {
  const features = seedRecords();
  const value = inBuilder ? ({ builder: { hidesEntry: () => false } } as unknown as NonNullable<ContextType<typeof DesignContext>>) : null;
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

describe('FeatureShelf roles', () => {
  it('draws no tab roles in the builder', () => {
    shelf(true);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getAllByTestId('feature-tile').length).toBeGreaterThan(0);
  });
  it('keeps the two tabs in Design', () => {
    shelf(false);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toHaveLength(2);
    expect(screen.getByRole('tabpanel')).toBeTruthy();
  });
});
