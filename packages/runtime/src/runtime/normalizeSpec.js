// The one place AppSpec defaults are filled (mirrors the zod defaults of src/spec/schema.ts). No imports and no
// Node APIs: the browser imports it and the server re-exports it (server/spec/normalize.js). It never validates.

export const SPEC_DEFAULTS = Object.freeze({
  sourceLimit: 50,
  theme: Object.freeze({ preset: 'aurora', radius: 'md' }),
  menu: Object.freeze({ position: 'top', style: 'icons-and-labels' }),
  // The menu slots (src/spec/menuSlots.ts MENU_SLOTS; menuSlots.test.ts pins the two lists together).
  menuSlots: Object.freeze(['start', 'end']),
  sizing: Object.freeze({ width: 'full', grow: false }),
});

/** Stops the layout walk on a tree far larger than any valid page (validation reports the size). */
const MAX_LAYOUT_NODES = 10000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const out = {};
    for (const key of Object.keys(value)) {
      const copy = clone(value[key]);
      // JSON.parse makes "__proto__" an own data key. Assigning it would swap the copy's prototype instead of copying it.
      if (key === '__proto__') Object.defineProperty(out, key, { value: copy, enumerable: true, configurable: true, writable: true });
      else out[key] = copy;
    }
    return out;
  }
  return value;
}

/** Sets a missing key (absent or undefined) on the end of the object. */
function fill(obj, key, value) {
  if (obj[key] === undefined) obj[key] = value;
}

function normalizeField(field) {
  if (!isObject(field)) return;
  fill(field, 'required', false);
}

function normalizeTable(table) {
  if (!isObject(table) || !Array.isArray(table.fields)) return;
  table.fields.forEach(normalizeField);
}

function normalizeSource(source) {
  if (!isObject(source)) return;
  fill(source, 'mode', 'list');
  fill(source, 'where', []);
  fill(source, 'orderBy', []);
  if (Array.isArray(source.orderBy)) {
    for (const entry of source.orderBy) if (isObject(entry)) fill(entry, 'dir', 'asc');
  }
  fill(source, 'limit', SPEC_DEFAULTS.sourceLimit);
}

/**
 * `sizing` has no default of its own: absent stays absent (the whole row), so only a present block is filled (the menu
 * pattern). Iterative; a sizing that is not an object is left for validation.
 */
function normalizeLayout(root) {
  const stack = [root];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_LAYOUT_NODES) {
    const layer = stack.pop();
    visited += 1;
    if (!isObject(layer)) continue;
    if (isObject(layer.sizing)) {
      fill(layer.sizing, 'width', SPEC_DEFAULTS.sizing.width);
      fill(layer.sizing, 'grow', SPEC_DEFAULTS.sizing.grow);
    }
    if (Array.isArray(layer.children)) for (let i = layer.children.length - 1; i >= 0; i -= 1) stack.push(layer.children[i]);
  }
}

function normalizePage(page) {
  if (!isObject(page)) return;
  fill(page, 'sources', []);
  if (Array.isArray(page.sources)) page.sources.forEach(normalizeSource);
  normalizeLayout(page.layout);
}

/**
 * Deep copy with every zod default of schema.ts filled. Idempotent. null or undefined in gives null out. Never validates.
 * @param {unknown} input
 * @returns {object | null}
 */
export function normalizeSpec(input) {
  if (input === null || input === undefined) return null;
  const spec = clone(input);
  if (!isObject(spec)) return spec;
  if (isObject(spec.app)) {
    fill(spec.app, 'description', '');
    fill(spec.app, 'icon', null);
  }
  fill(spec, 'tables', []);
  if (Array.isArray(spec.tables)) spec.tables.forEach(normalizeTable);
  if (Array.isArray(spec.pages)) spec.pages.forEach(normalizePage);
  fill(spec, 'nav', []);
  fill(spec, 'theme', { ...SPEC_DEFAULTS.theme });
  if (isObject(spec.theme)) {
    fill(spec.theme, 'preset', SPEC_DEFAULTS.theme.preset);
    fill(spec.theme, 'radius', SPEC_DEFAULTS.theme.radius);
  }
  // `menu` has no default of its own: absent stays absent (the classic look), so only a present block is filled.
  if (isObject(spec.menu)) {
    fill(spec.menu, 'position', SPEC_DEFAULTS.menu.position);
    fill(spec.menu, 'style', SPEC_DEFAULTS.menu.style);
    // Slots have no default: an absent or empty slot stays as it is; present layers get their `sizing` filled like a page's.
    for (const slot of SPEC_DEFAULTS.menuSlots) {
      if (Array.isArray(spec.menu[slot])) spec.menu[slot].forEach(normalizeLayout);
    }
  }
  return spec;
}

/**
 * The field that names a record of a table: its titleField when that names a real field of the table, else the first
 * text field, else 'id'. The one rule behind the compiler, the catalog and the data browser (src/catalog/parts/format.ts
 * mirrors it without an import and a parity test pins the two).
 * @param {{ titleField?: unknown, fields?: ReadonlyArray<{ id: string, type: string }> }} table
 * @returns {string}
 */
export function titleFieldOf(table) {
  const fields = Array.isArray(table?.fields) ? table.fields : [];
  const named = typeof table?.titleField === 'string' && fields.some((f) => f.id === table.titleField);
  if (named) return table.titleField;
  return fields.find((f) => f.type === 'text')?.id ?? 'id';
}
