// Seeded generator for the phase 11 spec fuzz tests (DESIGN-phase11.md 2.0). No dependency: mulberry32 and a few helpers.
// Relative imports only, so the backend Vitest project (no "@/" alias) can import this file too. The layer trees that need
// the Design helpers (layoutTree.ts, menuTree.ts, which use "@/") are built by src/studio/test-utils/specFuzzLayouts.ts.
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import type { AppSpec, AppSpecInput } from '@local-app-studio/runtime/spec/schema.ts';
import { CATALOG_CHECKS } from '../catalog/validateLayout.ts';

export type Rand = () => number;
export type Obj = Record<string, unknown>;

/** The same function as the inline `rng` of src/studio/lib/__tests__/layoutTree.test.ts. */
export function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
/** An integer in [lo, hi]. */
export const int = (rand: Rand, lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
export const chance = (rand: Rand, p: number): boolean => rand() < p;

/** Runs `fn(seed)` for seeds start..start+count-1; a failure is rethrown with the seed in its message. */
export function forSeeds(count: number, fn: (seed: number) => void, start = 1): void {
  for (let seed = start; seed < start + count; seed += 1) {
    try {
      fn(seed);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      throw new Error(`seed ${seed}: ${text}`, { cause: err });
    }
  }
}

export const HOSTILE_STRINGS: readonly string[] = Object.freeze([
  '"',
  "'; DROP TABLE x;--",
  '__proto__',
  'constructor',
  'sqlite_master',
  'é漢🙂',
  'a'.repeat(300),
  '\u0000',
  '../..\\',
  '<script>',
  '%2e%2e',
  'CON',
  'x.',
]);

/** A hostile string that still passes LABEL_RE and the 60 character limits (cut, never padded; the NUL one is refused by design, see the regression tests). */
export const hostileLabel = (rand: Rand): string => pick(rand, HOSTILE_STRINGS.filter((s) => !s.includes(String.fromCharCode(0)))).slice(0, 60);

// ---------------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------------

const TABLE_POOL = ['crews', 'people', 'jobs', 'tools', 'sites', 'orders', 'trucks', 'parts'];
const FIELD_POOL = ['name', 'title', 'status', 'size', 'amount', 'details', 'due_on', 'starts', 'active', 'owner', 'kind', 'code', 'qty', 'price', 'city', 'email'];
const TYPES = ['text', 'longtext', 'integer', 'real', 'boolean', 'date', 'datetime', 'select', 'reference'] as const;
const ICON_POOL = ['home', 'list', 'table', 'users', 'star', 'tag', 'map'] as const;

const titleCase = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, ' ');

export interface GenOptions {
  /** Pages carry list sources over their tables (default true). The planner tests turn it off: only tables matter there. */
  sources?: boolean;
  /** Up to this many tables (default 6). */
  maxTables?: number;
}

function genField(rand: Rand, id: string, earlier: readonly string[]): Obj {
  const label = chance(rand, 0.2) ? hostileLabel(rand) : titleCase(id);
  const type = pick(rand, TYPES.filter((t) => t !== 'reference' || earlier.length > 0));
  const base: Obj = { id, label, type };
  if (chance(rand, 0.3)) base.required = true;
  switch (type) {
    case 'text':
    case 'longtext':
      if (chance(rand, 0.3)) base.default = chance(rand, 0.5) ? hostileLabel(rand) : 'n/a';
      break;
    case 'integer':
      if (chance(rand, 0.3)) base.default = int(rand, -5, 500);
      break;
    case 'real':
      if (chance(rand, 0.3)) base.default = int(rand, -5, 500) / 4;
      break;
    case 'boolean':
      if (chance(rand, 0.3)) base.default = chance(rand, 0.5);
      break;
    case 'date':
      if (chance(rand, 0.3)) base.default = '2026-01-31';
      break;
    case 'datetime':
      if (chance(rand, 0.3)) base.default = '2026-01-31T09:00:00Z';
      break;
    case 'select': {
      const options: string[] = [];
      for (let i = int(rand, 1, 5); i > 0; i -= 1) {
        const o = chance(rand, 0.35) ? hostileLabel(rand) : `opt_${options.length + 1}`;
        if (!options.includes(o)) options.push(o);
      }
      base.options = options;
      if (chance(rand, 0.4)) base.default = pick(rand, options);
      break;
    }
    case 'reference':
      base.table = pick(rand, earlier);
      break;
  }
  return base;
}

function genTable(rand: Rand, id: string, earlier: readonly string[]): Obj {
  const names = [...FIELD_POOL];
  const fields: Obj[] = [];
  for (let i = int(rand, 1, 6); i > 0; i -= 1) {
    const at = Math.floor(rand() * names.length);
    const [fid] = names.splice(at, 1);
    fields.push(genField(rand, fid, earlier));
  }
  const table: Obj = { id, label: chance(rand, 0.2) ? hostileLabel(rand) : titleCase(id), fields };
  const titles = fields.filter((f) => f.type === 'text' || f.type === 'longtext' || f.type === 'select');
  if (titles.length > 0 && chance(rand, 0.5)) table.titleField = (pick(rand, titles) as Obj).id;
  return table;
}

export function genTables(rand: Rand, max = 6): Obj[] {
  const ids = [...TABLE_POOL];
  const tables: Obj[] = [];
  for (let i = int(rand, 0, max); i > 0 && ids.length > 0; i -= 1) {
    const [id] = ids.splice(Math.floor(rand() * ids.length), 1);
    tables.push(genTable(rand, id, tables.map((t) => t.id as string)));
  }
  return tables;
}

const simplePage = (id: string): Obj => ({
  id: `root_${id}`,
  type: 'Page',
  props: {},
  children: [{ id: `heading_${id}`, type: 'Heading', props: { size: 'lg' }, children: 'Hello' }],
});

function genSource(rand: Rand, n: number, tables: readonly Obj[], recordPage: boolean): Obj | null {
  if (tables.length === 0) return null;
  const table = pick(rand, tables);
  const fields = table.fields as Obj[];
  const src: Obj = { id: `src${n}`, table: table.id, mode: recordPage && chance(rand, 0.5) ? 'record' : 'list' };
  if (src.mode === 'list') {
    const where: Obj[] = [];
    const text = fields.find((f) => f.type === 'text');
    const num = fields.find((f) => f.type === 'integer');
    if (text !== undefined && chance(rand, 0.4)) where.push({ field: text.id, op: 'eq', value: chance(rand, 0.5) ? hostileLabel(rand) : 'x' });
    if (num !== undefined && chance(rand, 0.4)) where.push({ field: num.id, op: pick(rand, ['gt', 'lte', 'ne'] as const), value: int(rand, -3, 100) });
    if (where.length > 0) src.where = where;
    if (chance(rand, 0.4)) src.orderBy = [{ field: chance(rand, 0.5) ? 'created_at' : (pick(rand, fields) as Obj).id, dir: pick(rand, ['asc', 'desc'] as const) }];
    if (chance(rand, 0.5)) src.limit = int(rand, 1, 200);
  }
  return src;
}

/**
 * A raw AppSpec built to be valid: 0 to 6 tables, 1 to 4 pages, nav, theme, sometimes a menu look. Layouts are a Page with a
 * heading; src/studio/test-utils/specFuzzLayouts.ts replaces them with deep random trees. Not guaranteed accepted (hostile labels, odd defaults):
 * callers filter with isAccepted.
 */
export function genSpec(rand: Rand, opts: GenOptions = {}): AppSpecInput {
  const tables = genTables(rand, opts.maxTables ?? 6);
  const pages: Obj[] = [];
  const ids = ['home', 'list', 'detail', 'report'];
  const count = int(rand, 1, 4);
  for (let i = 0; i < count; i += 1) {
    const id = ids[i];
    const route = i === 0 ? '/' : id === 'detail' ? '/detail/:id' : `/${id}`;
    const sources: Obj[] = [];
    if (opts.sources !== false) {
      for (let k = int(rand, 0, 3); k > 0; k -= 1) {
        const s = genSource(rand, sources.length + 1, tables, route.endsWith('/:id'));
        if (s !== null) sources.push(s);
      }
    }
    pages.push({ id, title: titleCase(id), route, sources, layout: simplePage(id) });
  }
  const nav = pages
    .filter((p) => !(p.route as string).endsWith('/:id') && chance(rand, 0.8))
    .map((p) => ({ pageId: p.id, label: p.title, ...(chance(rand, 0.5) ? { icon: pick(rand, ICON_POOL) } : {}) }));
  const spec: Obj = {
    specVersion: 1,
    app: { name: 'Fuzz App', slug: 'fuzz-app', identifier: 'com.example.fuzzapp', version: '1.0.0', description: chance(rand, 0.3) ? hostileLabel(rand) : '', icon: null },
    tables,
    pages,
    nav,
    theme: { preset: pick(rand, ['aurora', 'ocean', 'solid'] as const), radius: pick(rand, ['none', 'md', 'lg'] as const) },
  };
  if (chance(rand, 0.5)) spec.menu = { position: pick(rand, ['top', 'side'] as const), style: pick(rand, ['labels', 'icons-and-labels'] as const) };
  return spec as unknown as AppSpecInput;
}

/** validateAppSpec with the catalog hooks, as every production caller runs it. */
export function accepted(spec: unknown): AppSpec | null {
  const result = validateAppSpec(spec, { ...CATALOG_CHECKS });
  return result.ok ? result.value : null;
}

// ---------------------------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------------------------

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every object and array reachable from the value, with its parent key path. Iterative (specs can be deep). */
function containers(root: unknown): Array<Obj | unknown[]> {
  const out: Array<Obj | unknown[]> = [];
  const stack: unknown[] = [root];
  for (let v = stack.pop(); v !== undefined; v = stack.pop()) {
    if (typeof v !== 'object' || v === null) continue;
    out.push(v as Obj | unknown[]);
    stack.push(...(Array.isArray(v) ? v : Object.values(v)));
  }
  return out;
}

const keysOf = (c: Obj | unknown[]): string[] => (Array.isArray(c) ? c.map((_, i) => String(i)) : Object.keys(c));

function wrapDeep(rand: Rand, page: Obj, depth: number): void {
  const wrapper = (child: Obj, n: number): Obj => ({ id: `deep_${n}`, type: 'Section', props: {}, children: [child] });
  let inner: Obj = { id: 'deep_leaf', type: 'Text', props: {}, children: 'x' };
  for (let n = depth; n > 0; n -= 1) inner = wrapper(inner, n);
  const root = page.layout as Obj;
  root.children = [...(Array.isArray(root.children) ? root.children : []), inner];
  if (chance(rand, 0.3)) root.children = [inner];
}

/** One random attack on a deep copy of the spec. */
export function mutateOnce(rand: Rand, spec: unknown): unknown {
  const out = clone(spec);
  const all = containers(out);
  const target = pick(rand, all);
  switch (int(rand, 0, 6)) {
    case 0: {
      // Drop a required key.
      const keys = keysOf(target);
      if (keys.length === 0) break;
      const key = pick(rand, keys);
      if (Array.isArray(target)) target.splice(Number(key), 1);
      else delete target[key];
      break;
    }
    case 1: {
      // Swap a value for another type.
      const keys = keysOf(target);
      if (keys.length === 0) break;
      const key = pick(rand, keys);
      const value = pick(rand, [null, 7, true, 'text', [], {}, [1, 2], { a: 1 }, -0, 1e999, 'é']);
      (target as Obj)[key] = value;
      break;
    }
    case 2:
      // An unknown prop.
      if (!Array.isArray(target)) target.extra = pick(rand, ['x', 1, { a: 1 }]);
      break;
    case 3: {
      // An own "__proto__" key, as JSON.parse creates it.
      if (Array.isArray(target)) break;
      const parsed = JSON.parse('{"__proto__":{"polluted":true}}') as Obj;
      Object.defineProperty(target, '__proto__', { value: Object.getOwnPropertyDescriptor(parsed, '__proto__')?.value, enumerable: true, configurable: true, writable: true });
      break;
    }
    case 4: {
      // sizing where it does not belong (Grid, Row, PageHeader keep it and ignore it; others may refuse it).
      const layers = all.filter((c): c is Obj => isObj(c) && typeof c.type === 'string' && typeof c.id === 'string' && 'props' in c);
      if (layers.length === 0) break;
      const layer = pick(rand, layers);
      layer.sizing = pick(rand, [{ width: 'half', grow: true }, { width: 'bogus' }, { grow: 'yes' }, {}, null, 7]);
      break;
    }
    case 5: {
      // Wrap a layout 30 levels deep.
      const pages = isObj(out) && Array.isArray(out.pages) ? (out.pages as unknown[]).filter(isObj) : [];
      if (pages.length > 0 && isObj(pick(rand, pages).layout)) wrapDeep(rand, pick(rand, pages), 30);
      break;
    }
    default: {
      // A hostile string in every text slot (about half of them).
      for (const c of all) {
        if (Array.isArray(c)) continue;
        for (const key of Object.keys(c)) if (typeof c[key] === 'string' && chance(rand, 0.5)) c[key] = pick(rand, HOSTILE_STRINGS);
      }
    }
  }
  return out;
}

/** 0 to 3 attacks in a row. */
export function mutate(rand: Rand, spec: unknown): unknown {
  let out: unknown = spec;
  for (let i = int(rand, 0, 3); i > 0; i -= 1) out = mutateOnce(rand, out);
  return out;
}

/** Raw JSON values that are not specs at all. */
export function rawJsonValues(): unknown[] {
  let deep: unknown = 'x';
  for (let i = 0; i < 5000; i += 1) deep = [deep];
  let deepObj: unknown = 'x';
  for (let i = 0; i < 5000; i += 1) deepObj = { a: deepObj };
  return [null, undefined, 0, -1, 1.5, 'spec', true, [], [1, 2, 3], {}, { specVersion: 1 }, { specVersion: '1' }, deep, deepObj, JSON.parse('{"__proto__":{"polluted":true}}')];
}

// ---------------------------------------------------------------------------------------------
// Evolution (pairs for planMigration)
// ---------------------------------------------------------------------------------------------

/**
 * A second spec reached from `spec` by 1 to 3 table and field edits: add or remove a table or field, change a type, grow or
 * shrink the options of a select, toggle required, change a default. The result may or may not be accepted.
 */
export function evolve(rand: Rand, spec: unknown): unknown {
  const out = clone(spec) as Obj;
  const tables = Array.isArray(out.tables) ? (out.tables as Obj[]) : [];
  for (let step = int(rand, 1, 3); step > 0; step -= 1) {
    const op = int(rand, 0, 7);
    const table = tables.length > 0 ? pick(rand, tables) : null;
    const fields = table !== null && Array.isArray(table.fields) ? (table.fields as Obj[]) : [];
    switch (op) {
      case 0: {
        const free = TABLE_POOL.filter((id) => !tables.some((t) => t.id === id));
        if (free.length > 0) tables.push(genTable(rand, pick(rand, free), tables.map((t) => t.id as string)));
        break;
      }
      case 1:
        if (table !== null) {
          tables.splice(tables.indexOf(table), 1);
          // Fields that pointed at it go too, so the result can still be accepted.
          for (const t of tables) t.fields = (t.fields as Obj[]).filter((f) => f.table !== table.id);
        }
        break;
      case 2:
        if (table !== null) {
          const free = FIELD_POOL.filter((id) => !fields.some((f) => f.id === id));
          if (free.length > 0) fields.push(genField(rand, pick(rand, free), tables.filter((t) => t !== table).map((t) => t.id as string)));
        }
        break;
      case 3:
        if (fields.length > 1) fields.splice(int(rand, 0, fields.length - 1), 1);
        break;
      case 4:
        if (fields.length > 0) {
          const f = pick(rand, fields);
          const next = pick(rand, ['longtext', 'real', 'text', 'integer', 'boolean'] as const);
          f.type = next;
          delete f.default;
          delete f.options;
          delete f.table;
        }
        break;
      case 5:
        for (const f of fields) {
          if (f.type !== 'select') continue;
          const options = f.options as string[];
          if (chance(rand, 0.5)) options.push(`new_${options.length}`);
          else if (options.length > 1) options.pop();
          if (f.default !== undefined && !options.includes(f.default as string)) delete f.default;
        }
        break;
      case 6:
        if (fields.length > 0) {
          const f = pick(rand, fields);
          f.required = !f.required;
        }
        break;
      default:
        if (fields.length > 0) {
          const f = pick(rand, fields);
          if (f.type === 'text') f.default = pick(rand, ['a', hostileLabel(rand)]);
          else if (f.type === 'integer') f.default = int(rand, 0, 9);
        }
    }
  }
  out.tables = tables;
  return out;
}

// ---------------------------------------------------------------------------------------------
// SQL identifier allowlist (A1.7)
// ---------------------------------------------------------------------------------------------

/** The SQL with every single-quoted literal blanked (quotes doubled inside a literal are part of it). */
export const withoutLiterals = (sql: string): string => sql.replace(/'(?:[^']|'')*'/g, "''");

/** Every double-quoted identifier of a migration or create script, with "" unescaped. Literals and comments are skipped first. */
export function quotedIdentifiers(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n');
  const text = withoutLiterals(noComments);
  const found: string[] = [];
  const re = /"((?:[^"]|"")*)"/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) found.push(m[1].replaceAll('""', '"'));
  return found;
}

/** The identifiers a script for these specs may use: table ids, field ids, runtime columns, `<id>:new` and `idx:<table>:<field>`. */
export function identifierAllowlist(...specs: Array<AppSpec | AppSpecInput | null>): Set<string> {
  const allowed = new Set<string>(['id', 'created_at', 'updated_at', 'app_schema_version']);
  for (const spec of specs) {
    for (const t of spec?.tables ?? []) {
      allowed.add(t.id);
      allowed.add(`${t.id}:new`);
      for (const f of t.fields) {
        allowed.add(f.id);
        allowed.add(`idx:${t.id}:${f.id}`);
      }
    }
  }
  return allowed;
}
