// Rules of the pages of an app that Add a page, Page settings and Delete page share: no two pages with one title, who still goes to a
// page that is about to be deleted, and the page that shows one record (made new, or made out of a plain page). Pure: every function
// returns a new spec or a sentence in plain words, nothing is mutated and no id reaches the person.
import { slotsOf } from '@/catalog/features';
import { slotLayers } from '@local-app-studio/runtime/spec/menuSlots';
import { LIMITS } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, LayoutLayer, Page } from '@local-app-studio/runtime/spec/schema';
import { blockName } from '../design/designLabels';
import { recordPagesFor } from './bindChoice';
import { newSourceFor, planDrop } from './bindOnDrop';
import { toId, uniquePageRoute } from './ids';
import { starterLayout } from './layout';
import { insertLayer } from './layoutTree';
import { rowActionTo } from './rowColumns';

export const PAGE_COPY = {
  /** Under the title of Add a page and Page settings. */
  titleTaken: (title: string): string => `A page called ${title} already exists. Pick another title.`,
  /** Delete page: the last line when parts still go to the page. */
  changeOne: 'Change where it goes first.',
  changeMany: 'Change where they go first.',
  noTable: 'Make a table on Data first.',
  homeNoRecord: 'The home page cannot show one record.',
  alreadyRecord: 'This page already shows one record.',
  sourcesFull: `This page already has ${LIMITS.sourcesPerPage} lists. Remove one in Page settings first.`,
  noDetails: 'That table has no field to show.',
} as const;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The sentence that refuses a title another page has, or null. `exceptPageId` is the page being renamed. */
export function titleClash(spec: AppSpec, title: string, exceptPageId?: string): string | null {
  const other = spec.pages.find((p) => p.id !== exceptPageId && same(p.title, title));
  return other === undefined ? null : PAGE_COPY.titleTaken(other.title);
}

/** The layers of a tree, the layer first. */
function walk(layer: LayoutLayer, visit: (l: LayoutLayer) => void): void {
  visit(layer);
  if (Array.isArray(layer.children)) for (const child of layer.children) walk(child, visit);
}

/** What the person who deletes a page must change first: one plain sentence per part that goes to it. */
export interface PageReferrers {
  lines: string[];
  /** "Change where it goes first." or the plural. */
  closing: string;
}

/** The parts of the other pages and of the menu bar that go to this page (a button, a link, a row click, a form's next page), in plain words. */
export function pageReferrers(spec: AppSpec, pageId: string): PageReferrers {
  const lines: string[] = [];
  const add = (line: string): void => {
    if (!lines.includes(line)) lines.push(line);
  };
  const check = (layer: LayoutLayer, where: string): void => {
    const slots = slotsOf(layer).filter((s) => s.kind === 'page' && s.value === pageId);
    if (slots.length === 0) return;
    const name = blockName(layer);
    if (slots.some((s) => s.target.startsWith('props.rowAction'))) add(`The ${name} on ${where} opens this page when a row is clicked.`);
    if (slots.some((s) => !s.target.startsWith('props.rowAction'))) add(`The ${name} on ${where} goes to this page.`);
  };
  for (const page of spec.pages) {
    if (page.id === pageId) continue;
    walk(page.layout, (l) => check(l, page.title));
  }
  for (const slot of ['start', 'end'] as const) {
    for (const layer of slotLayers(spec.menu, slot) as readonly LayoutLayer[]) walk(layer, (l) => check(l, 'the menu bar'));
  }
  const shown = lines.slice(0, 5);
  if (lines.length > shown.length) shown.push(`And ${lines.length - shown.length} more.`);
  return { lines: shown, closing: lines.length === 1 ? PAGE_COPY.changeOne : PAGE_COPY.changeMany };
}

/** The spec with every Table of records and List of records of `table` that does nothing on a row click made to open the one record page of that table. */
export function withRowActions(spec: AppSpec, table: string): AppSpec {
  const record = recordPagesFor(spec, table);
  if (record.length !== 1) return spec;
  const target = record[0];
  const map = (page: Page, layer: LayoutLayer): LayoutLayer => {
    // A feature block is changed through its own settings, never from here.
    if (layer.feature !== undefined) return layer;
    const kids = Array.isArray(layer.children) ? layer.children : null;
    const mapped = kids === null ? null : kids.map((c) => map(page, c));
    const moved = kids !== null && mapped !== null && mapped.some((c, i) => c !== kids[i]);
    const out: LayoutLayer = moved && mapped !== null ? { ...layer, children: mapped } : layer;
    const source = typeof layer.props.source === 'string' ? page.sources.find((s) => s.id === layer.props.source) : undefined;
    const list = (layer.type === 'DataTable' || layer.type === 'RecordList') && layer.props.rowAction === undefined;
    if (list && source !== undefined && source.mode === 'list' && source.table === table && page.id !== target.id) {
      return { ...out, props: { ...out.props, rowAction: rowActionTo(target.id) } };
    }
    return out;
  };
  return { ...spec, pages: spec.pages.map((p) => ({ ...p, layout: map(p, p.layout) })) };
}

export type PageResult = { ok: true; spec: AppSpec; pageId: string } | { ok: false; message: string };

/** Adds the Record details part, bound to the page's record list, at the end of the page. */
function withDetails(spec: AppSpec, page: Page, table: string): PageResult {
  const withPage: AppSpec = { ...spec, pages: spec.pages.some((p) => p.id === page.id) ? spec.pages.map((p) => (p.id === page.id ? page : p)) : [...spec.pages, page] };
  const taken = new Set<string>();
  walk(page.layout, (l) => taken.add(l.id));
  const plan = planDrop('RecordDetail', withPage, { id: page.id, title: page.title, route: page.route, sources: page.sources }, taken);
  if (plan.kind !== 'bound') return { ok: false, message: PAGE_COPY.noDetails };
  const inserted = insertLayer(page.layout, { parentId: page.layout.id, index: Array.isArray(page.layout.children) ? page.layout.children.length : 0 }, plan.layer);
  if (!inserted.ok) return { ok: false, message: inserted.message };
  const done: Page = { ...page, sources: plan.sources, layout: inserted.root };
  return { ok: true, spec: withRowActions({ ...withPage, pages: withPage.pages.map((p) => (p.id === page.id ? done : p)) }, table), pageId: page.id };
}

/** A new page that shows one record of `table` (an address ending in a record number, out of the menu, a Record details part). Lists of the table that open nothing now open it. */
export function addRecordPage(spec: AppSpec, title: string, table: string): PageResult {
  const clash = titleClash(spec, title);
  if (clash !== null) return { ok: false, message: clash };
  const id = toId(title, new Set(spec.pages.map((p) => p.id)), () => false);
  const route = `${uniquePageRoute(title, new Set(spec.pages.map((p) => p.route.replace(/\/:id$/, ''))))}/:id`;
  const page: Page = { id, title, route, sources: [newSourceFor(table, 'record', [])], layout: starterLayout(id, title) };
  return withDetails(spec, page, table);
}

/** A plain page made to show one record of `table`: the address gets the record number, the menu entry goes, a Record details part is added. */
export function makeRecordPage(spec: AppSpec, pageId: string, table: string): PageResult {
  const page = spec.pages.find((p) => p.id === pageId);
  if (page === undefined) return { ok: false, message: 'That page is no longer there.' };
  if (page.route === '/') return { ok: false, message: PAGE_COPY.homeNoRecord };
  if (page.route.endsWith('/:id')) return { ok: false, message: PAGE_COPY.alreadyRecord };
  if (page.sources.length >= LIMITS.sourcesPerPage) return { ok: false, message: PAGE_COPY.sourcesFull };
  const next: Page = { ...page, route: `${page.route}/:id`, sources: [...page.sources, newSourceFor(table, 'record', page.sources)] };
  return withDetails({ ...spec, nav: spec.nav.filter((n) => n.pageId !== pageId) }, next, table);
}
