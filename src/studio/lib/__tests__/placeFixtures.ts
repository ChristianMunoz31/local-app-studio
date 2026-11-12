// Small specs with a Grid on the home page, for the place words of the review (specDiff, promptBullets, askOutcome, ProposalReview).
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { baseSpec } from '../../__tests__/fixtures';

export interface Block {
  col: number;
  span: number;
  row: number;
  rowSpan: number;
}

export const block = (col: number, span: number, row: number, rowSpan = 1): Block => ({ col, span, row, rowSpan });

/** A part with an id and an optional block and name. */
export const tile = (id: string, type: string, grid?: Block, name?: string): LayoutLayer =>
  ({
    id,
    type,
    ...(name === undefined ? {} : { name }),
    props: {},
    children: type === 'Heading' ? 'Title' : [],
    ...(grid === undefined ? {} : { grid }),
  }) as unknown as LayoutLayer;

export interface GridOptions {
  free?: boolean;
  gridId?: string;
  gridName?: string;
}

/** The home page: a Heading, then one Grid (free by default) holding `children`. */
export function gridSpec(children: LayoutLayer[], { free = true, gridId = 'grid_1', gridName }: GridOptions = {}): AppSpec {
  const spec = structuredClone(baseSpec());
  const grid = {
    id: gridId,
    type: 'Grid',
    ...(gridName === undefined ? {} : { name: gridName }),
    props: free ? { placement: 'free', columns: 12, rows: 4 } : { columns: 2 },
    children,
  } as unknown as LayoutLayer;
  const root = spec.pages[0].layout;
  root.children = [(root.children as LayoutLayer[])[0], grid];
  return spec;
}

/** Two number tiles across the top and a chart under them. */
export const three = (): LayoutLayer[] => [
  tile('statcard_1', 'StatCard', block(1, 4, 1)),
  tile('statcard_2', 'StatCard', block(5, 4, 1)),
  tile('chart_1', 'Chart', block(1, 8, 2, 3)),
];
