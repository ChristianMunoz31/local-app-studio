// Fix all (phase 25): one pass over the open page's connection issues that does what Connect and Change table do, one part at a
// time, and nothing else. Pure; Design applies the result as one Undo step (docs/phase25/DESIGN-phase25.md).
import { getPartDefinition } from '@/catalog/definitions';
import { partContextFor } from '@/catalog/validateLayout';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { connectionIssues } from '../design/connections';
import type { ConnectionIssue } from '../design/connections';
import { dataBindOf } from './bindChoice';
import { connectLayer, planDrop, withPageSources, writeTablesFor } from './bindOnDrop';
import type { ConnectChoice, DraftPage, Source } from './bindOnDrop';
import { followResult } from './followWords';
import { configureLayer, findLayer } from './layoutTree';
import type { TreeResult } from './layoutTree';

export const FIX_ALL = 'Fix all';

export interface FixAllContext {
  spec: AppSpec;
  page: DraftPage;
  takenIds: ReadonlySet<string>;
  kept: ReadonlySet<string>;
}

export interface FixAllResult {
  result: Extract<TreeResult, { ok: true }>;
  sources: Source[];
  fixed: string[];
  needTable: number;
  otherTable: number;
  elsewhere: number;
}

/** True when the open page has at least one issue that is not kept. */
export const canFixAll = (issues: readonly ConnectionIssue[], pageId: string, kept: ReadonlySet<string>): boolean =>
  issues.some((i) => i.pageId === pageId && !kept.has(i.key));

const textOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function fixAllConnections(root: LayoutLayer, ctx: FixAllContext): FixAllResult {
  const open = (layout: LayoutLayer, sources: readonly Source[]) => ({ pageId: ctx.page.id, layout, sources });
  const todo = connectionIssues(ctx.spec, open(root, ctx.page.sources)).filter((i) => !ctx.kept.has(i.key));
  let cur = root;
  let sources = ctx.page.sources;
  let spec = withPageSources(ctx.spec, ctx.page.id, sources);
  let focusId = root.id;
  const fixed: string[] = [];
  const done = (id: string, next: LayoutLayer, nextSources: Source[], focus: string): void => {
    cur = next;
    sources = nextSources;
    spec = withPageSources(ctx.spec, ctx.page.id, sources);
    if (fixed.length === 0) focusId = focus;
    fixed.push(id);
  };
  for (const issue of todo) {
    if (issue.pageId !== ctx.page.id) continue;
    const located = findLayer(cur, issue.layerId);
    if (located === null) continue;
    const layer = located.layer;
    const draft: DraftPage = { ...ctx.page, sources };
    if (issue.code === 'not_connected') {
      const taken = new Set(ctx.takenIds);
      taken.delete(layer.id);
      const plan = planDrop(layer.type, spec, draft, taken);
      if (plan.kind !== 'bound') continue;
      const def = getPartDefinition(layer.type);
      const bind = def === undefined ? null : dataBindOf(def);
      const sourceId = textOf(plan.layer.props.source);
      const table = textOf(plan.layer.props.table);
      let choice: ConnectChoice | null = null;
      if (bind?.kind === 'source') {
        if (plan.added !== null) choice = { newSourceOn: plan.added.table };
        else if (sourceId !== undefined) choice = { sourceId };
      } else if (bind?.kind === 'table' && table !== undefined) choice = { table };
      if (choice === null) continue;
      const out = connectLayer(cur, layer.id, choice, spec, draft, ctx.takenIds);
      if (out.result.ok) done(layer.id, out.result.root, out.sources, out.result.focusId);
    } else {
      const shown = new Set(sources.map((s) => s.table));
      const fits = writeTablesFor(layer.type, spec, draft).filter((t) => shown.has(t));
      const page = spec.pages.find((p) => p.id === ctx.page.id);
      if (fits.length !== 1 || page === undefined) continue;
      const res = followResult(cur, configureLayer(cur, layer.id, { 'props.table': fits[0] }, partContextFor(spec, page), 'page'), layer.id, spec, sources);
      if (res.ok) done(layer.id, res.root, sources, res.focusId);
    }
  }
  const left = connectionIssues(spec, open(cur, sources)).filter((i) => !ctx.kept.has(i.key) && i.pageId === ctx.page.id);
  return {
    result: { ok: true, root: cur, focusId },
    sources: [...sources],
    fixed,
    needTable: left.filter((i) => i.code === 'not_connected').length,
    otherTable: left.filter((i) => i.code === 'other_table').length,
    elsewhere: todo.filter((i) => i.pageId !== ctx.page.id).length,
  };
}

/** The sentence for the notice line: what was connected, then what is left, each only when above zero. */
export function fixAllOutcome(r: FixAllResult): string {
  const n = r.fixed.length;
  const parts = [n === 0 ? 'Nothing could be connected by itself.' : `Connected ${n} ${n === 1 ? 'part' : 'parts'}.`];
  if (r.needTable > 0) parts.push(r.needTable === 1 ? '1 still needs a table.' : `${r.needTable} still need a table.`);
  if (r.otherTable > 0) parts.push(r.otherTable === 1 ? '1 still adds to a table the page does not show.' : `${r.otherTable} still add to a table the page does not show.`);
  if (r.elsewhere > 0) parts.push(r.elsewhere === 1 ? '1 more is on another page.' : `${r.elsewhere} more are on other pages.`);
  return parts.join(' ');
}

/** The Undo label. */
export const fixAllLabel = (count: number): string => `connected ${count} ${count === 1 ? 'part' : 'parts'}`;
