// The canned, schema-valid answers of the fake helper for the Describe steps (tables, outline, one call per page).
// The sandbox's fake Ollama uses `cannedDescribeChat`, which picks an answer by the words in the prompt, so a
// sandbox walk takes the helper path end to end; `e2e/support/describeFake.js` keeps giving the crew roster only.
// An edit is answered honestly (P17-30): the fake does the change it can read and otherwise returns the current design
// unchanged, so a journey can prove the product's own judgement of an ask. The phrasings are listed above `cannedDescribeChat`.
// Pure data and string work: nothing here imports server code, and the answers are run through the real
// pipeline in server/__tests__/fakeDescribeAnswers.test.js.

export const SCENARIOS = Object.freeze(['crews', 'tasks', 'loans', 'dashboard', 'change']);

/**
 * A page body: one Section with a Heading and either a DataTable of a list source or, with no list source,
 * a Button to another page.
 * @param {string} title
 * @param {{ list?: string, home?: string }} [opts] `list` is a list source id; `home` the page id the Button opens.
 * @returns {object}
 */
export function pageLayer(title, { list, home } = {}) {
  const children = [{ type: 'Heading', props: { size: 'lg' }, children: title }];
  if (list) children.push({ type: 'DataTable', props: { source: list }, children: [] });
  else if (home) children.push({ type: 'Button', props: { action: { action: 'navigate', pageId: home } }, children: 'Home' });
  return { type: 'Page', props: {}, children: [{ type: 'Section', props: { title }, children }] };
}

const listSource = (id, table, where = [], orderBy = []) => ({ id, table, mode: 'list', where, orderBy });
const recordSource = (id, table) => ({ id, table, mode: 'record' });

const pagesOf = (outline) =>
  Object.fromEntries(
    outline.pages.map((p) => {
      const list = p.sources.find((s) => s.mode === 'list')?.id;
      return [p.id, pageLayer(p.title, { list, home: list ? undefined : 'home' })];
    }),
  );

const CREWS_OUTLINE = {
  pages: [
    {
      id: 'home',
      title: 'Home',
      route: '/',
      purpose: 'Lists the open crews.',
      sources: [listSource('open_crews', 'crews', [{ field: 'status', op: 'eq', value: 'open' }])],
    },
    { id: 'crew', title: 'Crew', route: '/crews/:id', purpose: 'One crew.', sources: [recordSource('crew', 'crews')] },
  ],
  nav: [{ pageId: 'home', label: 'Home', icon: 'home' }],
};

/** The crew roster (one table). The default answer, and the only one `e2e/support/describeFake.js` gives. */
export const CREWS = Object.freeze({
  tables: {
    tables: [
      {
        id: 'crews',
        label: 'Crews',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'status', label: 'Status', type: 'select', options: ['open', 'closed'] },
        ],
      },
    ],
  },
  outline: CREWS_OUTLINE,
  pages: { home: pageLayer('Crew Roster', { home: 'home' }), crew: pageLayer('Crew', { home: 'home' }) },
});

/**
 * The crew roster pages `cannedDescribeChat` gives (the sandbox): Home lists the open crews. `CREWS.pages` stays as it is
 * because `e2e/support/describeFake.js` and the existing e2e flows rely on its Home (a heading and a Button to Home).
 */
const SANDBOX_CREWS_PAGES = Object.freeze({ home: pageLayer('Crew Roster', { list: 'open_crews' }), crew: CREWS.pages.crew });

const TASKS_OUTLINE = {
  pages: [
    {
      id: 'home',
      title: 'Open tasks',
      route: '/',
      purpose: 'Lists the tasks that are not done.',
      sources: [listSource('open_tasks', 'tasks', [{ field: 'done', op: 'eq', value: false }])],
    },
    { id: 'projects', title: 'Projects', route: '/projects', purpose: 'Lists the projects.', sources: [listSource('all_projects', 'projects')] },
  ],
  nav: [
    { pageId: 'home', label: 'Open tasks', icon: 'home' },
    { pageId: 'projects', label: 'Projects', icon: 'folder' },
  ],
};

/** Two tables: projects and tasks, with a link from a task to its project. */
export const TASKS = Object.freeze({
  tables: {
    tables: [
      {
        id: 'projects',
        label: 'Projects',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'status', label: 'Status', type: 'select', options: ['Planned', 'Active', 'Done'] },
        ],
      },
      {
        id: 'tasks',
        label: 'Tasks',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'project', label: 'Project', type: 'reference', table: 'projects' },
          { id: 'done', label: 'Done', type: 'boolean' },
          { id: 'due', label: 'Due', type: 'date' },
        ],
      },
    ],
  },
  outline: TASKS_OUTLINE,
  pages: pagesOf(TASKS_OUTLINE),
});

const LOANS_OUTLINE = {
  pages: [
    {
      id: 'home',
      title: 'Open loans',
      route: '/',
      purpose: 'Lists the loans that are not returned, soonest due first.',
      sources: [listSource('open_loans', 'loans', [{ field: 'returned', op: 'eq', value: false }], [{ field: 'due_date', dir: 'asc' }])],
    },
    { id: 'things', title: 'Items', route: '/things', purpose: 'Lists the items.', sources: [listSource('all_things', 'things')] },
    { id: 'people', title: 'People', route: '/people', purpose: 'Lists the people.', sources: [listSource('all_people', 'people')] },
    { id: 'loan', title: 'Loan', route: '/loans/:id', purpose: 'One loan.', sources: [recordSource('loan', 'loans')] },
  ],
  nav: [
    { pageId: 'home', label: 'Open loans', icon: 'home' },
    { pageId: 'things', label: 'Items', icon: 'box' },
    { pageId: 'people', label: 'People', icon: 'users' },
  ],
};

/**
 * Three tables with links and dates: items, people and the loans that link them. The items table has the id `things`
 * (label "Items") because `items` is a kit table and category id and `/items` a shell route: the validator refuses both.
 */
export const LOANS = Object.freeze({
  tables: {
    tables: [
      {
        id: 'things',
        label: 'Items',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'serial_number', label: 'Serial number', type: 'text' },
          { id: 'condition', label: 'Condition', type: 'select', options: ['Good', 'Fair', 'Needs repair'] },
        ],
      },
      {
        id: 'people',
        label: 'People',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'phone', label: 'Phone', type: 'text' },
        ],
      },
      {
        id: 'loans',
        label: 'Loans',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'item', label: 'Item', type: 'reference', table: 'things' },
          { id: 'person', label: 'Person', type: 'reference', table: 'people' },
          { id: 'date_out', label: 'Date out', type: 'date' },
          { id: 'due_date', label: 'Due date', type: 'date' },
          { id: 'returned', label: 'Returned', type: 'boolean' },
        ],
      },
    ],
  },
  outline: LOANS_OUTLINE,
  pages: pagesOf(LOANS_OUTLINE),
});

const DASHBOARD_OUTLINE = {
  pages: [
    {
      id: 'home',
      title: 'Dashboard',
      route: '/',
      purpose: 'Shows how the orders are doing at a glance.',
      sources: [listSource('all_orders', 'orders', [], [{ field: 'placed', dir: 'desc' }])],
      parts: ['Grid', 'Chart'],
    },
  ],
  nav: [{ pageId: 'home', label: 'Dashboard', icon: 'home' }],
};

const place = (col, span, row, rowSpan) => ({ col, span, row, rowSpan });
const stat = (label, extra, grid) => ({
  type: 'StatCard',
  props: { source: 'all_orders', label, ...extra },
  ...(grid ? { grid } : {}),
});
const ordersChart = (grid) => ({
  type: 'Chart',
  props: { source: 'all_orders', groupBy: 'status', measure: 'count', title: 'Orders by status' },
  ...(grid ? { grid } : {}),
});
const recentOrders = (grid) => ({
  type: 'RecordList',
  props: { source: 'all_orders', titleField: 'name', badgeField: 'status' },
  ...(grid ? { grid } : {}),
});
const dashboardPage = (gridProps, children) => ({
  type: 'Page',
  props: {},
  children: [
    { type: 'Heading', props: { size: 'lg' }, children: 'Sales dashboard' },
    { type: 'Grid', props: gridProps, children },
  ],
});
const plainTiles = () => [
  stat('Orders', { stat: 'count' }),
  stat('Revenue', { stat: 'sum', field: 'amount' }),
  stat('Average order', { stat: 'avg', field: 'amount' }),
  ordersChart(),
  recentOrders(),
];

/** The free-grid home page as a model writes it: `placement` only, three stat cards, a chart and a list (rows 1 to 4). */
const DASHBOARD_HOME = dashboardPage({ placement: 'free' }, [
  stat('Orders', { stat: 'count' }, place(1, 4, 1, 1)),
  stat('Revenue', { stat: 'sum', field: 'amount' }, place(5, 4, 1, 1)),
  stat('Average order', { stat: 'avg', field: 'amount' }, place(9, 4, 1, 1)),
  ordersChart(place(1, 8, 2, 3)),
  recentOrders(place(9, 4, 2, 3)),
]);

/** The same page with the Grid in flow and no cells: what the "stack" ask gives when no current layout is sent. */
export const DASHBOARD_STACKED_PAGE = dashboardPage({ columns: 1 }, plainTiles());

/**
 * Unit-test only (no prompt words reach it): a home page that needs every repair once. The Heading carries a grid block
 * (grid_not_free), Orders and the Chart overlap (grid_overlap_moved), RecordList runs past column 12 (grid_clipped) and
 * Average has no block (grid_missing_place).
 */
export const DASHBOARD_MESSY_PAGE = {
  type: 'Page',
  props: {},
  children: [
    { type: 'Heading', props: { size: 'lg' }, children: 'Sales dashboard', grid: place(1, 12, 1, 1) },
    {
      type: 'Grid',
      props: { placement: 'free' },
      children: [
        stat('Orders', { stat: 'count' }, place(1, 4, 1, 1)),
        ordersChart(place(1, 8, 1, 3)),
        stat('Revenue', { stat: 'sum', field: 'amount' }, place(5, 4, 1, 1)),
        stat('Average order', { stat: 'avg', field: 'amount' }),
        recentOrders(place(9, 6, 2, 3)),
      ],
    },
  ],
};

/** Unit-test only: the clean home page with the Grid's `placement` and every `grid` block left out (a model that ignored placement). */
export const DASHBOARD_FORGOT_PLACEMENT_PAGE = dashboardPage({}, plainTiles());

/** One table, `orders`, and a home page laid out on a free grid: three stat cards, a chart and a list. */
export const DASHBOARD = Object.freeze({
  tables: {
    tables: [
      {
        id: 'orders',
        label: 'Orders',
        titleField: 'name',
        fields: [
          { id: 'name', label: 'Name', type: 'text', required: true },
          { id: 'status', label: 'Status', type: 'select', options: ['New', 'Paid', 'Shipped'] },
          { id: 'amount', label: 'Amount', type: 'real' },
          { id: 'placed', label: 'Placed', type: 'date' },
        ],
      },
    ],
  },
  outline: DASHBOARD_OUTLINE,
  pages: { home: DASHBOARD_HOME },
});

const BY_NAME = { crews: CREWS, tasks: TASKS, loans: LOANS, dashboard: DASHBOARD };

const wordsRe = (words) => new RegExp(`\\b(?:${words.join('|')})\\b`, 'i');
// The first matching row wins: an edit, then a dashboard, then loans, then tasks, else the crew roster (DESIGN-phase15.md 10.2).
const DASHBOARD_WORDS = wordsRe(['dashboard', 'dashboards', 'tiles', 'kpi', 'kpis']);
const LOANS_WORDS = wordsRe(['loan', 'loans', 'borrow', 'borrowed', 'lend', 'lending', 'rental', 'rent', 'due', 'overdue', 'checkout']);
const TASKS_WORDS = wordsRe(['task', 'tasks', 'project', 'projects', 'todo', 'chore', 'chores']);

const lastUserText = (body) => {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user' && typeof messages[i].content === 'string') return messages[i].content;
  }
  return '';
};

/** The person's own words inside a step message: the tables, outline and page prompts each wrap them differently. */
function instructionOf(user) {
  const tables = /^The app: ([\s\S]*?)\nReply with its tables\.$/.exec(user);
  if (tables) return tables[1];
  const outline = /\nThe app: ([\s\S]*)$/.exec(user);
  if (outline) return outline[1];
  const page = /^App "[\s\S]*?": ([\s\S]*?)\nLay out the page "/.exec(user);
  return page ? page[1] : user;
}

const isEditMessage = (user) => user.startsWith('Current tables:\n') || user.includes('\nChange: ');

/**
 * The scenario for a Describe step body, by whole words in the last user message (case-insensitive): an edit
 * is `change`, then dashboard words, then loan words, then task words, else the crew roster.
 * @param {{ messages?: Array<{ role?: string, content?: unknown }> }} body
 * @returns {'crews' | 'tasks' | 'loans' | 'dashboard' | 'change'}
 */
export function pickScenario(body) {
  const user = lastUserText(body);
  if (isEditMessage(user)) return 'change';
  const words = instructionOf(user);
  if (DASHBOARD_WORDS.test(words)) return 'dashboard';
  if (LOANS_WORDS.test(words)) return 'loans';
  if (TASKS_WORDS.test(words)) return 'tasks';
  return 'crews';
}

/** The current tables from an edit-mode tables message, or null. */
function currentTables(user) {
  const m = /^Current tables:\n(.*)\nChange: /.exec(user);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    return Array.isArray(parsed?.tables) ? parsed.tables : null;
  } catch {
    return null;
  }
}

/** The person's change words from an edit message (tables or outline step), or ''. */
function changeOf(user) {
  const m = /(?:^|\n)Change: ([\s\S]*?)(?:\nReply with the whole tables block[\s\S]*)?$/.exec(user);
  return m ? m[1].trim() : '';
}

/** The clauses of an ask: split at full stops, semicolons and line breaks. */
const clausesOf = (ask) => ask.split(/[.;\n]+/).map((c) => c.trim()).filter(Boolean);

const IRREGULAR_SINGULAR = { people: 'person', children: 'child' };
/** A rough singular for matching a table or page noun ("things" and "thing", "people" and "person"). */
function singular(word) {
  const w = word.trim().toLowerCase();
  if (IRREGULAR_SINGULAR[w]) return IRREGULAR_SINGULAR[w];
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ss|us)$/.test(w)) return w;
  if (/(ch|sh|x|z|s)es$/.test(w)) return w.slice(0, -2);
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

const NOUN_ARTICLE = /^(?:the|a|an|one|each|every|all)\s+/i;
const matchTable = (tables, noun) => {
  const n = singular(noun.replace(NOUN_ARTICLE, ''));
  return tables.find((t) => singular(t.label) === n || singular(t.id) === n);
};

const snake = (words) => {
  const id = words.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 31).replace(/_+$/, '');
  return /^[a-z]/.test(id) ? id : `f_${id}`.slice(0, 31);
};
const capital = (words) => words.trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 60);
const RESERVED_IDS = new Set(['id', 'created_at', 'updated_at']);

/** The field type the words ask for: a date, a decimal amount, else text. */
const typeOfWords = (words) => (/\bdate\b/i.test(words) ? 'date' : /\b(?:amount|price|cost)\b/i.test(words) ? 'real' : 'text');

const FIELD_ASK = /^add (?:a |an |the |one )?(.+?)(?: field| column)? to (?:each |every |all |the )?(.+?)(?: table| records?)?$/i;
const TABLE_ASK = /^add (?:a |an |the )?(.+?) table(?: with (.+?)| ?\((.+?)\))?$/i;

/** Adds the fields the ask names ("a, b and c" or one) to one table; an id that is taken or reserved is skipped. */
function addFields(tables, table, words) {
  const labels = words.split(/\s*(?:,|\band\b)\s*(?:an? |the )?/i).map((w) => w.trim()).filter(Boolean);
  const fields = [...table.fields];
  for (const label of labels) {
    const id = snake(label);
    if (!id || RESERVED_IDS.has(id) || fields.some((f) => f.id === id)) continue;
    fields.push({ id, label: capital(label), type: typeOfWords(label) });
  }
  return tables.map((t) => (t === table ? { ...t, fields } : t));
}

/** The field of a new table for one word group: a link to an existing table, a date, a status select, an amount or text. */
function newTableField(tables, raw) {
  const words = raw.replace(NOUN_ARTICLE, '').trim();
  const id = snake(words);
  if (!id || RESERVED_IDS.has(id) || id === 'name') return null;
  const target = matchTable(tables, words);
  if (target) return { id, label: capital(words), type: 'reference', table: target.id };
  if (/^status$/i.test(words)) return { id, label: capital(words), type: 'select', options: ['New', 'Active', 'Done'] };
  return { id, label: capital(words), type: typeOfWords(words) };
}

function addTable(tables, name, fieldWords) {
  const label = capital(name);
  const base = snake(name);
  // `items` is a kit table and category id: the validator refuses it as a table id (the loans design uses `things`).
  const id = base === 'items' ? 'things' : base;
  if (!id || RESERVED_IDS.has(id) || tables.some((t) => t.id === id)) return tables;
  const fields = [{ id: 'name', label: 'Name', type: 'text', required: true }];
  for (const word of (fieldWords ?? '').split(/\s*(?:,|\band\b)\s*/i)) {
    const f = word.trim() ? newTableField(tables, word) : null;
    if (f && !fields.some((x) => x.id === f.id)) fields.push(f);
  }
  return [...tables, { id, label, titleField: 'name', fields }];
}

const withNotes = (tables) => {
  const index = tables.findIndex((t) => Array.isArray(t.fields) && !t.fields.some((f) => f.id === 'notes'));
  if (index < 0) return tables;
  return tables.map((t, i) => (i === index ? { ...t, fields: [...t.fields, { id: 'notes', label: 'Notes', type: 'longtext' }] } : t));
};

/** The edit tables answer: the changes the ask spells out, else the current tables untouched. */
function editedTables(tables, ask) {
  let out = tables;
  let did = false;
  for (const clause of clausesOf(ask)) {
    const field = FIELD_ASK.exec(clause);
    const target = field ? matchTable(out, field[2]) : undefined;
    if (field && target) {
      out = addFields(out, target, field[1]);
      did = true;
      continue;
    }
    const table = TABLE_ASK.exec(clause);
    if (table && !/ (?:to|field) /i.test(` ${table[1]} `)) {
      out = addTable(out, table[1], table[2] ?? table[3]);
      did = true;
    }
  }
  return did || !/\bnotes?\b/i.test(ask) ? out : withNotes(out);
}

/** True when the tables step may propose a look (the system message carries the theme line). */
const mayProposeTheme = (body) => /Optionally add "theme"/.test(String(body?.messages?.find((m) => m?.role === 'system')?.content ?? ''));

// The filters, order and menu icons of the canned designs: the edit outline message carries only ids, titles, routes and
// source tables, so they are put back from the canned outlines by source id and table (an unknown one is a plain list).
const KNOWN_OUTLINES = [CREWS_OUTLINE, TASKS_OUTLINE, LOANS_OUTLINE, DASHBOARD_OUTLINE];
const knownSource = (id, table, mode) =>
  KNOWN_OUTLINES.flatMap((o) => o.pages.flatMap((p) => p.sources)).find((s) => s.id === id && s.table === table && s.mode === mode);
const knownIcon = (pageId, title) => KNOWN_OUTLINES.flatMap((o) => o.nav).find((n) => n.pageId === pageId && n.label === title)?.icon;

/** The current pages and menu from an edit-mode outline message, or null. An unknown menu item gets the home or file icon. */
function currentOutline(user) {
  const m = /\nCurrent pages:\n([\s\S]*?)\nCurrent menu: (.*)\n/.exec(user);
  if (!m) return null;
  const pages = [];
  for (const line of m[1].split('\n')) {
    const p = /^(\S+) "(.*)" (\S+)(?: sources: (.*))?$/.exec(line);
    if (!p) return null;
    const sources = [];
    for (const raw of p[4] ? p[4].split(', ') : []) {
      const s = /^(\S+)=(\S+?)( record)?$/.exec(raw);
      if (!s) return null;
      sources.push(s[3] ? recordSource(s[1], s[2]) : (knownSource(s[1], s[2], 'list') ?? listSource(s[1], s[2])));
    }
    pages.push({ id: p[1], title: p[2], route: p[3], purpose: p[2], sources });
  }
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ids = m[2] === 'none' ? [] : m[2].split(', ').filter((id) => byId.has(id));
  const nav = ids.map((id) => {
    const page = byId.get(id);
    return { pageId: id, label: page.title, icon: knownIcon(id, page.title) ?? (page.route === '/' ? 'home' : 'file') };
  });
  return { pages, nav };
}

/** The tables of an edit outline message, as { id, label } from its "id (Label): fields" lines. */
function outlineTables(user) {
  const block = /^Tables:\n([\s\S]*?)\nCurrent pages:/.exec(user)?.[1] ?? '';
  return block.split('\n').flatMap((line) => {
    const t = /^(\S+) \((.*?)\): /.exec(line);
    return t ? [{ id: t[1], label: t[2] }] : [];
  });
}

const ADD_PAGE_ASK = /^(?:add|make|create) (?:a |one |the )?(?:new )?page (?:for|per) (.+)$/i;
const REMOVE_PAGE_ASK = /^(?:remove|delete|drop) (?:the )?(.+?) page$/i;

/** The edit outline answer: a record page added for a table, or a page removed with its menu item, else the current one. */
function editedOutline(user) {
  const current = currentOutline(user);
  if (!current) return null;
  const tables = outlineTables(user);
  let { pages, nav } = current;
  for (const clause of clausesOf(changeOf(user))) {
    const remove = REMOVE_PAGE_ASK.exec(clause);
    if (remove) {
      const name = remove[1].trim().toLowerCase();
      const gone = pages.find((p) => p.route !== '/' && (p.title.toLowerCase() === name || p.id === name));
      if (gone) {
        pages = pages.filter((p) => p !== gone);
        nav = nav.filter((n) => n.pageId !== gone.id);
      }
      continue;
    }
    const add = ADD_PAGE_ASK.exec(clause);
    const table = add ? matchTable(tables, add[1]) : undefined;
    if (!add || !table) continue;
    const route = `/${table.id}/:id`;
    if (pages.some((p) => p.route === route || p.sources.some((s) => s.mode === 'record' && s.table === table.id))) continue;
    const noun = capital(add[1].replace(NOUN_ARTICLE, ''));
    let id = snake(singular(add[1].replace(NOUN_ARTICLE, '')));
    if (pages.some((p) => p.id === id)) id = `${id}_page`;
    pages = [...pages, { id, title: noun, route, purpose: `One ${noun.toLowerCase()}.`, sources: [recordSource(id, table.id)] }];
  }
  return { pages, nav };
}

/** The page being laid out, from a page-step message: its id, title, source ids, first list source and another page. */
function pageRequest(user) {
  const head = /Lay out the page "(.*)" \(id (\S+), route/.exec(user);
  if (!head) return null;
  const tail = /\nSources: (.*)\nOther pages: (.*)$/.exec(user);
  const sources = tail && tail[1] !== 'none' ? tail[1].split('; ') : [];
  const ids = sources.map((s) => s.split(':')[0]);
  const list = sources.find((s) => /^\S+: list of /.test(s))?.split(':')[0];
  const record = sources.find((s) => /^\S+: record of /.test(s))?.split(':')[0];
  const other = tail && tail[2] !== 'none' ? tail[2].split(', ')[0].split(' ')[0] : undefined;
  return { title: head[1], id: head[2], ids, list, record, other };
}

const LAYOUT_MARKER = 'Current layout: ';
const STACK_ASK = /\b(?:stack|stacked|one column|no grid)\b|\bone (?:under|below) (?:another|the other)\b/i;
const ADD_TILE_ASK = /^add (?:a |an |one |another )?(?:new |number |stat )?tiles?$/i;
const MOVE_CHART_ASK = /^move (?:the )?chart to the bottom$/i;

/** The current layout from a page-step edit message (the line `Current layout: <one-line JSON>`), or null. */
function currentLayout(user) {
  const line = user.split('\n').find((l) => l.startsWith(LAYOUT_MARKER));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(LAYOUT_MARKER.length));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const isFreeGrid = (layer) => layer?.type === 'Grid' && layer.props?.placement === 'free' && Array.isArray(layer.children);

/** A copy of the layout with every free Grid mapped by `fn`; other layers are copied as they are. */
function mapFreeGrids(layer, fn) {
  if (!layer || typeof layer !== 'object') return layer;
  const copy = Array.isArray(layer.children) ? { ...layer, children: layer.children.map((c) => mapFreeGrids(c, fn)) } : { ...layer };
  return isFreeGrid(copy) ? fn(copy) : copy;
}

const lastUsedRow = (grid) =>
  grid.children.reduce((max, c) => (c?.grid ? Math.max(max, c.grid.row + (c.grid.rowSpan ?? 1) - 1) : max), 0);

/** The free Grid made flow: placement and rows removed, one column, no child cells. */
const flowGrid = (grid) => {
  const props = { ...grid.props, columns: 1 };
  delete props.placement;
  delete props.rows;
  const children = grid.children.map((child) => {
    const copy = { ...child };
    delete copy.grid;
    return copy;
  });
  return { ...grid, props, children };
};

/** One more StatCard at the end of the Grid, on the first stat card's source, with no cell (the pipeline places it). */
function withTile(grid) {
  const first = grid.children.find((c) => c?.type === 'StatCard' && c.props?.source);
  if (!first) return grid;
  return { ...grid, children: [...grid.children, { type: 'StatCard', props: { source: first.props.source, stat: 'count', label: 'New tile' } }] };
}

/** The Chart moved to one row past the last used row, keeping its columns and height. */
function chartToBottom(grid) {
  const row = lastUsedRow(grid) + 1;
  return { ...grid, children: grid.children.map((c) => (c?.type === 'Chart' && c.grid ? { ...c, grid: { ...c.grid, row } } : c)) };
}

/**
 * The page-step answer for an edit that carries the current layout: each clause of the ask that the fake can read is done
 * in turn (stack, add a tile, move the chart to the bottom); anything else leaves the layout as it is.
 */
function editedLayout(layout, ask) {
  let out = layout;
  for (const clause of clausesOf(ask.replace(/^Change: /i, ''))) {
    if (STACK_ASK.test(clause)) out = mapFreeGrids(out, flowGrid);
    else if (ADD_TILE_ASK.test(clause)) out = mapFreeGrids(out, withTile);
    else if (MOVE_CHART_ASK.test(clause)) out = mapFreeGrids(out, chartToBottom);
  }
  return out;
}

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The `chat` hook for `startFakeOllama({ describe: 'canned' })` and the `fakeChat` hook of `startApp`: JSON text for a
 * Describe step (tables, outline or page, told apart by the schema in `body.format`), or undefined for any other chat so
 * the plain reply or the Assistant tool path answers.
 *
 * Asks the fake does in an edit (the whole clause, case-insensitive; clauses are split at a full stop or semicolon):
 * - "add a due date field to Loans", "add an email address to each person": a field on a table named by its label, id
 *   or singular (`date` in the words makes a date field, `amount`, `price` or `cost` a decimal, else text);
 * - "add a Clients table (name, phone)", "add a Clients table with a date, status and Loans": a new table with Name and
 *   those fields (`date` a date, `status` a select, a table's name a link to it);
 * - "add a page for one loan", "add a page per person": a record page /<table>/:id for that table;
 * - "remove the Projects page": the page and its menu item (the home page stays);
 * - "add a place for notes": a Notes field on the first table without one, only when the ask says notes;
 * - a green look ("make it green") when the helper may propose a look: the forest theme.
 * - on a page step that carries `Current layout: <json>`: "stack these" (also "stacked", "one column", "no grid", "one under
 *   another") makes the free Grid flow; "add a tile" adds one StatCard at the end of the Grid with no cell; "move the chart to
 *   the bottom" puts the Chart one row past the last used row (clauses are done in order, anything else leaves the layout).
 * Anything else returns the current design unchanged, so the design diff is empty.
 * Create words that give the dashboard (an orders table and a free-grid home page): dashboard, dashboards, tiles, kpi, kpis.
 * @param {{ format?: unknown, messages?: Array<{ role?: string, content?: unknown }> }} body
 * @returns {string | undefined}
 */
export function cannedDescribeChat(body) {
  const format = body?.format;
  if (!format || typeof format !== 'object') return undefined;
  const props = format.properties;
  const user = lastUserText(body);
  const scenario = pickScenario(body);
  if (props?.tables) {
    const current = scenario === 'change' ? currentTables(user) : null;
    if (!current) return JSON.stringify((BY_NAME[scenario] ?? CREWS).tables);
    const ask = changeOf(user);
    const theme = mayProposeTheme(body) && /\bgreen\b/i.test(ask) ? { theme: 'forest' } : {};
    return JSON.stringify({ tables: editedTables(current, ask), ...theme });
  }
  if (props?.nav) {
    const current = scenario === 'change' ? editedOutline(user) : null;
    return JSON.stringify(current ?? (BY_NAME[scenario] ?? CREWS).outline);
  }
  const layout = currentLayout(user);
  if (layout) return JSON.stringify(editedLayout(layout, instructionOf(user)));
  const page = pageRequest(user);
  if (!page) return JSON.stringify(CREWS.pages.home);
  if (scenario === 'dashboard' && page.id === 'home' && STACK_ASK.test(instructionOf(user))) return JSON.stringify(DASHBOARD_STACKED_PAGE);
  const pages = scenario === 'crews' ? SANDBOX_CREWS_PAGES : BY_NAME[scenario]?.pages;
  const scenarioPage = BY_NAME[scenario]?.outline.pages.find((p) => p.id === page.id);
  if (scenarioPage && sameIds(scenarioPage.sources.map((s) => s.id), page.ids)) return JSON.stringify(pages[page.id]);
  if (page.record && !page.list) {
    const children = [
      { type: 'Heading', props: { size: 'lg' }, children: page.title },
      { type: 'RecordDetail', props: { source: page.record }, children: [] },
    ];
    return JSON.stringify({ type: 'Page', props: {}, children: [{ type: 'Section', props: { title: page.title }, children }] });
  }
  return JSON.stringify(pageLayer(page.title, { list: page.list, home: page.list ? undefined : page.other }));
}
