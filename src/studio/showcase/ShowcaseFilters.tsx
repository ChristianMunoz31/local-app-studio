// Search box, category choice with counts, order choice and a count line for the Features page. The shelf in Design uses the
// same SearchField, CategoryPills and ResultCount, so both places read and sort the same way.
import type { RefObject } from 'react';
import CategoryPills from './CategoryPills';
import ResultCount from './ResultCount';
import SearchField from './SearchField';
import SortSelect from './SortSelect';
import type { CategoryChoice, SortChoice } from './search';

export type { CategoryChoice } from './search';

export interface ShowcaseFiltersProps {
  category: CategoryChoice;
  query: string;
  sort: SortChoice;
  /** Matches per category for the current query. */
  counts: Record<CategoryChoice, number>;
  onCategory(next: CategoryChoice): void;
  onQuery(next: string): void;
  onSort(next: SortChoice): void;
  searchRef?: RefObject<HTMLInputElement | null>;
  /** How many tiles match right now. */
  shown: number;
}

export default function ShowcaseFilters({ category, query, sort, counts, onCategory, onQuery, onSort, searchRef, shown }: ShowcaseFiltersProps) {
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <SearchField value={query} onChange={onQuery} inputRef={searchRef} />
        </div>
        <CategoryPills value={category} counts={counts} onChange={onCategory} />
        <SortSelect value={sort} onChange={onSort} />
      </div>
      <ResultCount count={shown} />
    </div>
  );
}
