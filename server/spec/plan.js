// planMigration (ADR-004): the app-track migration from the last built spec to the next one. Pure and deterministic.
import { checkSpecShape, computeImportOrder } from './compile.js';
import { normalizeSpec } from './normalize.js';
import {
  columnLine,
  createIndexStatement,
  createSqlText,
  createTableStatement,
  defaultLiteral,
  fileText,
  indexStatements,
  quoteId,
  tableBlock,
} from './sql.js';

const MAX_ISSUES = 20;
const WORKAROUND = 'Keep the field and hide it from pages, or build the app as a new app.';

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * How one field changed. `destructive` is a sentence naming the edit; `rebuild` needs a table rebuild.
 * @param {object} before
 * @param {object} after
 * @returns {{ destructive: string | null, rebuild: boolean }}
 */
function compareField(before, after) {
  const name = `"${after.id}"`;
  let rebuild = false;
  if (before.type !== after.type) {
    const allowed =
      (before.type === 'text' && after.type === 'longtext') || (before.type === 'integer' && after.type === 'real');
    if (!allowed) {
      return { destructive: `Changing the type of field ${name} from ${before.type} to ${after.type} is not supported. ${WORKAROUND}`, rebuild: false };
    }
    rebuild = true;
  }
  if (after.type === 'reference' && before.table !== after.table) {
    return { destructive: `Pointing field ${name} at another table is not supported. ${WORKAROUND}`, rebuild: false };
  }
  if (!before.required && after.required) {
    return { destructive: `Making field ${name} required is not supported. ${WORKAROUND}`, rebuild: false };
  }
  if (before.required && !after.required) rebuild = true;
  if (after.type === 'select' && before.type === 'select') {
    if (before.options.some((o) => !after.options.includes(o))) {
      return { destructive: `Removing an option from field ${name} is not supported. ${WORKAROUND}`, rebuild: false };
    }
    if (!sameList(before.options, after.options)) rebuild = true;
  }
  if (defaultLiteral(before) !== defaultLiteral(after)) rebuild = true;
  return { destructive: null, rebuild };
}

function rebuildBlock(table, builtFieldIds) {
  const kept = table.fields.filter((f) => builtFieldIds.has(f.id)).map((f) => f.id);
  const cols = ['id', ...kept, 'created_at', 'updated_at'].map(quoteId).join(', ');
  const tmp = `${table.id}:new`;
  return [
    createTableStatement(table, tmp),
    `INSERT INTO ${quoteId(tmp)} (${cols}) SELECT ${cols} FROM ${quoteId(table.id)};`,
    `DROP TABLE ${quoteId(table.id)};`,
    `ALTER TABLE ${quoteId(tmp)} RENAME TO ${quoteId(table.id)};`,
    ...indexStatements(table),
  ].join('\n');
}

function alterBlock(table, newFields) {
  const lines = [];
  for (const f of newFields) {
    lines.push(`ALTER TABLE ${quoteId(table.id)} ADD COLUMN ${columnLine(f)};`);
    if (f.type === 'reference') lines.push(createIndexStatement(table.id, f.id));
  }
  return lines.join('\n');
}

/**
 * Plans the app-track migration from the last built spec to the next one.
 * `builtSpec` null gives the create script. Labels, pages, layouts, sources, nav and theme need no migration.
 * @param {object | null} builtSpec the spec the app was last built from
 * @param {object} nextSpec the next spec
 * @param {{ version?: number }} [opts] migration number (default 1 for a first build, else 2)
 * @returns {{ ok: true, file: { name: string, sql: string } | null } | { ok: false, issues: Array<{ path: string, code: string, message: string }> }}
 */
export function planMigration(builtSpec, nextSpec, opts = {}) {
  const next = normalizeSpec(nextSpec);
  const nextProblem = checkSpecShape(next);
  if (nextProblem) return { ok: false, issues: [{ path: '(root)', code: 'invalid_spec', message: nextProblem }] };
  const built = builtSpec === null || builtSpec === undefined ? null : normalizeSpec(builtSpec);
  if (built) {
    const builtProblem = checkSpecShape(built);
    if (builtProblem) {
      return { ok: false, issues: [{ path: '(root)', code: 'invalid_spec', message: `The built spec is not valid: ${builtProblem}` }] };
    }
  }
  const version = Number.isInteger(opts.version) && opts.version >= 1 ? opts.version : built ? 2 : 1;
  const name = `${String(version).padStart(3, '0')}_app.sql`;

  const order = computeImportOrder(next.tables);
  const nextById = new Map(next.tables.map((t) => [t.id, t]));
  if (!built) {
    return { ok: true, file: { name, sql: createSqlText(order.map((id) => nextById.get(id))) } };
  }

  const issues = [];
  const addIssue = (path, message) => {
    issues.push({ path, code: 'destructive_change', message });
  };
  const builtById = new Map(built.tables.map((t) => [t.id, t]));
  for (const t of built.tables) {
    if (!nextById.has(t.id)) {
      addIssue('tables', `Removing the table "${t.id}" is not supported. Keep the table and hide it from pages, or build the app as a new app.`);
    }
  }

  /** @type {Map<string, { rebuild: boolean, newFields: object[], builtIds: Set<string> }>} */
  const changes = new Map();
  next.tables.forEach((table, i) => {
    const old = builtById.get(table.id);
    if (!old) return;
    const nextIds = new Set(table.fields.map((f) => f.id));
    const oldFields = new Map(old.fields.map((f) => [f.id, f]));
    for (const f of old.fields) {
      if (!nextIds.has(f.id)) {
        addIssue(`tables.${i}.fields`, `Removing the field "${f.id}" from table "${table.id}" is not supported. ${WORKAROUND}`);
      }
    }
    let rebuild = false;
    const newFields = [];
    table.fields.forEach((f, j) => {
      const before = oldFields.get(f.id);
      const path = `tables.${i}.fields.${j}`;
      if (!before) {
        if (f.required && (f.type === 'reference' || defaultLiteral(f) === null)) {
          addIssue(path, `Adding the required field "${f.id}" without a default to table "${table.id}" is not supported. Make it optional or give it a default.`);
        } else newFields.push(f);
        return;
      }
      const res = compareField(before, f);
      if (res.destructive) addIssue(path, res.destructive);
      else if (res.rebuild) rebuild = true;
    });
    changes.set(table.id, { rebuild, newFields, builtIds: new Set(oldFields.keys()) });
  });
  if (issues.length) return { ok: false, issues: issues.slice(0, MAX_ISSUES) };

  const blocks = [];
  let anyRebuild = false;
  for (const id of order) {
    const table = nextById.get(id);
    const change = changes.get(id);
    if (!change) blocks.push(tableBlock(table));
    else if (change.rebuild) {
      anyRebuild = true;
      blocks.push(rebuildBlock(table, change.builtIds));
    } else if (change.newFields.length) blocks.push(alterBlock(table, change.newFields));
  }
  if (!blocks.length) return { ok: true, file: null };
  return { ok: true, file: { name, sql: fileText(anyRebuild ? 'rebuild' : 'alter', blocks) } };
}
