// Property test for Fix all: 300 seeded random pages (no new dependency, a small LCG), each checked against the four rules of
// docs/phase25/DESIGN-phase25.md section 5, A.
import { describe, expect, it } from 'vitest';
import { checkLayer, partContextFor, CATALOG_CHECKS } from '@/catalog/validateLayout';
import { slotLayers } from '@local-app-studio/runtime/spec/menuSlots';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema';
import type { AppSpec, AppSpecInput, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { connectionIssues } from '../../design/connections';
import { newSourceFor, planDrop, withPageSources, writeTablesFor } from '../bindOnDrop';
import type { DraftPage, Source } from '../bindOnDrop';
import { fixAllConnections } from '../fixAllConnections';
import { configureLayer, findLayer } from '../layoutTree';
import { layerIds } from '../layout';
import { specOf } from './bindFixtures';

const SLUGS = ['appointments', 'crew-board', 'expense-log', 'inventory', 'invoices-and-clients', 'job-tracker', 'membership-attendance', 'reading-list'];
const SOURCE_PARTS = ['DataTable', 'RecordList', 'Chart', 'StatCard', 'ProgressBar', 'Checklist'];
const WRITE_PARTS = ['QuickAdd', 'RecordForm'];
const PARTS = [...SOURCE_PARTS, ...WRITE_PARTS];

const SPECS = import.meta.glob<unknown>('../../../../public/examples/*.spec.json', { eager: true, import: 'default' });
const specJson = (slug: string): unknown => JSON.parse(JSON.stringify(SPECS[`../../../../public/examples/${slug}.spec.json`]));
const example = (slug: string): AppSpec => {
  const input = specJson(slug) as AppSpecInput;
  const out = validateAppSpec(input, { ...CATALOG_CHECKS });
  if (!out.ok) throw new Error(`${slug} invalid`);
  return out.value;
};
const BASES: AppSpec[] = [specOf(), ...SLUGS.map(example)];

/** A small seeded generator (LCG): the same seed always gives the same run. */
function rng(seed: number): { next(): number; pick<T>(items: readonly T[]): T; chance(p: number): boolean } {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return { next, pick: (items) => items[Math.floor(next() * items.length)], chance: (p) => next() < p };
}

const shallow = (l: LayoutLayer): unknown => (Array.isArray(l.children) ? { ...l, children: l.children.map((c) => c.id) } : l);
const byId = (root: LayoutLayer): Map<string, LayoutLayer> => {
  const out = new Map<string, LayoutLayer>();
  const stack = [root];
  for (let l = stack.pop(); l !== undefined; l = stack.pop()) {
    out.set(l.id, l);
    if (Array.isArray(l.children)) stack.push(...l.children);
  }
  return out;
};
const allIds = (spec: AppSpec): Set<string> => {
  const ids = new Set<string>();
  for (const p of spec.pages) layerIds(p.layout).forEach((id) => ids.add(id));
  for (const slot of ['start', 'end'] as const) for (const l of slotLayers(spec.menu, slot)) layerIds(l as LayoutLayer).forEach((id) => ids.add(id));
  return ids;
};

interface Case {
  spec: AppSpec;
  page: DraftPage;
  root: LayoutLayer;
  kept: Set<string>;
  pureUnconnected: boolean;
}

function makeCase(seed: number): Case {
  const r = rng(seed);
  const base = r.pick(BASES);
  const saved = r.pick(base.pages);
  const tables = base.tables.map((t) => t.id);
  let sources: Source[] = [...saved.sources];
  const children: LayoutLayer[] = Array.isArray(saved.layout.children) ? [...saved.layout.children] : [];
  let pureUnconnected = true;
  const count = 1 + Math.floor(r.next() * 5);
  for (let n = 0; n < count; n += 1) {
    const type = r.pick(PARTS);
    const id = `gen_${n}`;
    const prop = WRITE_PARTS.includes(type) ? 'table' : 'source';
    let props: LayoutLayer['props'] = { [prop]: '' };
    if (r.chance(0.4)) {
      pureUnconnected = false;
      const table = r.pick(tables);
      if (prop === 'table') props = type === 'RecordForm' ? { table, mode: 'create' } : { table, field: 'name' };
      else {
        const found = sources.find((s) => s.table === table && s.mode === 'list') ?? newSourceFor(table, 'list', sources);
        if (!sources.includes(found)) sources = [...sources, found];
        props = { source: found.id };
      }
    }
    children.splice(Math.floor(r.next() * (children.length + 1)), 0, { id, type, props, children: [] });
  }
  const root: LayoutLayer = { ...saved.layout, children };
  const spec: AppSpec = { ...base, pages: base.pages.map((p) => (p.id === saved.id ? { ...p, layout: root, sources } : p)) };
  const page: DraftPage = { id: saved.id, title: saved.title, route: saved.route, sources };
  const kept = new Set<string>();
  for (const issue of connectionIssues(spec, { pageId: page.id, layout: root, sources })) if (r.chance(0.2)) kept.add(issue.key);
  return { spec, page, root, kept, pureUnconnected };
}

describe('fixAllConnections (property, 300 seeded cases)', () => {
  it('holds the four rules on every case', () => {
    let fixedSome = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const { spec, page, root, kept, pureUnconnected } = makeCase(seed * 7919);
      const at = `seed ${seed * 7919}`;
      const ctx = { spec, page, takenIds: allIds(spec), kept };
      const out = fixAllConnections(root, ctx);
      const afterSpec = withPageSources(spec, page.id, out.sources);
      const afterPage: DraftPage = { ...page, sources: out.sources };
      const after = connectionIssues(afterSpec, { pageId: page.id, layout: out.result.root, sources: out.sources }).filter((i) => i.pageId === page.id && !kept.has(i.key));
      if (out.fixed.length > 0) fixedSome += 1;

      // (1) nothing left that Fix all could have connected by itself.
      for (const issue of after) {
        const found = findLayer(out.result.root, issue.layerId);
        if (found === null) throw new Error(`${at}: lost ${issue.layerId}`);
        if (issue.code === 'not_connected') {
          const taken = new Set(ctx.takenIds);
          taken.delete(issue.layerId);
          expect(planDrop(found.layer.type, afterSpec, afterPage, taken).kind, `${at} ${issue.key}`).not.toBe('bound');
        } else {
          const shown = new Set(out.sources.map((s) => s.table));
          const fits = writeTablesFor(found.layer.type, afterSpec, afterPage).filter((t) => shown.has(t));
          if (fits.length === 1) {
            // The settings path itself refuses it (a Quick add whose field is not in that table), so it stays listed.
            const refused = configureLayer(out.result.root, issue.layerId, { 'props.table': fits[0] }, partContextFor(afterSpec, { ...afterSpec.pages.find((p) => p.id === page.id)! }), 'page');
            expect(refused.ok, `${at} ${issue.key}`).toBe(false);
          }
        }
      }

      // (2) every other layer is untouched, and the lists only grow at the end.
      const before = byId(root);
      const now = byId(out.result.root);
      expect([...now.keys()].sort()).toEqual([...before.keys()].sort());
      for (const [id, layer] of before) if (!out.fixed.includes(id)) expect(shallow(now.get(id)!), `${at} ${id}`).toEqual(shallow(layer));
      expect(out.sources.slice(0, page.sources.length), at).toEqual(page.sources);
      expect(out.result.root.id).toBe(root.id);

      // (3) fixed layers are valid where they are; a clean result is a valid app.
      const placeCtx = partContextFor(afterSpec, { ...afterSpec.pages.find((p) => p.id === page.id)! });
      for (const id of out.fixed) expect(checkLayer(findLayer(out.result.root, id)!.layer, placeCtx, 'layer', 5), `${at} ${id}`).toEqual([]);
      if (pureUnconnected && kept.size === 0 && out.needTable === 0 && out.otherTable === 0) {
        const done = { ...afterSpec, pages: afterSpec.pages.map((p) => (p.id === page.id ? { ...p, layout: out.result.root } : p)) };
        const v = validateAppSpec(done, { ...CATALOG_CHECKS });
        expect(v.ok, `${at} ${JSON.stringify(v.ok ? [] : v.issues)}`).toBe(true);
      }

      // (4) a second run fixes nothing.
      const again = fixAllConnections(out.result.root, { spec, page: afterPage, takenIds: ctx.takenIds, kept });
      expect(again.fixed, at).toEqual([]);
    }
    expect(fixedSome).toBeGreaterThan(20);
  });
});
