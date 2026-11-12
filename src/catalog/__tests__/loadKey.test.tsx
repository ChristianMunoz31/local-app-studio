import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogPageProvider, useSource } from '../context.tsx';
import type { CatalogData } from '../context.tsx';
import { crewAppSpec, makeFakeData } from './fakeData.ts';

afterEach(cleanup);

function Names() {
  const { rows } = useSource('open_crews');
  return <p data-testid="names">{rows.map((r) => String(r.name)).join(',')}</p>;
}

function dataWith(rows: Record<string, unknown>[]): CatalogData {
  const dataSource = makeFakeData();
  dataSource.tables.crews = rows.map((r, i) => ({ id: `x${i}`, status: 'active', ...r }));
  return { apiBase: '/api', spec: crewAppSpec(), pageId: 'home', recordId: null, dataSource };
}

const listCount = (d: CatalogData) => (d.dataSource as ReturnType<typeof makeFakeData>).calls.filter((c) => c.method === 'list' && c.table === 'crews').length;

describe('useLoad key carries the data source (B5)', () => {
  it('refetches from the new data source when only the data source changes, without a remount', async () => {
    const a = dataWith([{ name: 'From A' }]);
    const b = dataWith([{ name: 'From B' }]);
    const { rerender } = render(
      <CatalogPageProvider value={a}>
        <Names />
      </CatalogPageProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('From A'));
    const aCalls = listCount(a);
    rerender(
      <CatalogPageProvider value={b}>
        <Names />
      </CatalogPageProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('From B'));
    expect(listCount(a)).toBe(aCalls);
    expect(listCount(b)).toBe(1);
  });

  it('does not refetch when the same data source is passed again', async () => {
    const a = dataWith([{ name: 'From A' }]);
    const view = (v: CatalogData) => (
      <CatalogPageProvider value={v}>
        <Names />
      </CatalogPageProvider>
    );
    const { rerender } = render(view(a));
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('From A'));
    rerender(view({ ...a }));
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('From A'));
    expect(listCount(a)).toBe(1);
  });
});
