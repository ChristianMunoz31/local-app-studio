// The fake helper's canned Describe answers run through the real pipeline (runDescribe and the validators the
// server uses): every scenario passes with no fallback and no repair round, an edit keeps every id, and the
// prompt words pick the scenario as DESIGN-phase15.md 10.2 says.
import { beforeAll, describe, expect, it } from 'vitest';
import { runDescribe } from '../studio/describe/pipeline.js';
import { validateAppSpec } from '@local-app-studio/runtime/spec/schema.ts';
import { CATALOG_CHECKS } from '../../src/catalog/validateLayout.ts';
import {
  SCENARIOS, CREWS, LOANS, TASKS, DASHBOARD, DASHBOARD_MESSY_PAGE, DASHBOARD_FORGOT_PLACEMENT_PAGE, DASHBOARD_STACKED_PAGE,
  cannedDescribeChat, pickScenario,
} from '../../scripts/lib/fakeDescribeAnswers.js';
import { overlaps, cellsOf, readGrid } from '@local-app-studio/runtime/spec/gridPlacement.ts';
import { describeFakeChat } from '../../e2e/support/describeFake.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

const APP = { name: 'Canned App', slug: 'canned-app', identifier: 'com.example.cannedapp', version: '1.0.0' };
const createBase = () => ({ specVersion: 1, app: { ...APP }, theme: { preset: 'ocean', radius: 'md' } });
const SCOPE = Object.freeze({ categories: ['studio'] });
const CRITIQUE_PROMPT =
  'An app to track equipment loans for my tool rental shop. I have items (name, serial number, condition), people (name, phone), and loans: which person borrowed which item, the date out, and the due date. I want to see which loans are overdue.';
const passes = (spec) => validateAppSpec(spec, { ...CATALOG_CHECKS }).ok;

/** A client whose model is the canned chat hook; records every call. */
function cannedClient() {
  const calls = [];
  return {
    calls,
    async complete({ messages, format }) {
      calls.push({ messages, format });
      const content = cannedDescribeChat({ messages, format });
      if (content === undefined) throw new Error('not a describe step');
      return { content };
    },
  };
}

const create = async (instruction) => {
  const client = cannedClient();
  const result = await runDescribe({ client, scope: SCOPE, instruction, baseSpec: createBase() });
  return { ...result, client };
};
const edit = (baseSpec, instruction) => runDescribe({ client: cannedClient(), scope: SCOPE, mode: 'edit', instruction, baseSpec });
const idsOf = (spec) => ({
  tables: spec.tables.map((t) => t.id),
  fields: spec.tables.flatMap((t) => t.fields.map((f) => `${t.id}.${f.id}`)),
  pages: spec.pages.map((p) => `${p.id} ${p.route}`),
});

describe.skipIf(PUBLIC_BUILD)('cannedDescribeChat through the real pipeline (needs the helper pipeline, which is not in a public build)', () => {
  const CASES = [
    ['crews', 'A roster of work crews.', ['crews']],
    ['tasks', 'Keep track of my chores and projects.', ['projects', 'tasks']],
    ['loans', CRITIQUE_PROMPT, ['things', 'people', 'loans']],
  ];

  it.each(CASES)('creates the %s app with no fallback and no repair', async (_name, prompt, tables) => {
    const { proposal, fallbacks, steps, client } = await create(prompt);
    expect(passes(proposal)).toBe(true);
    expect(fallbacks).toEqual([]);
    expect(steps.every((s) => s.status === 'ok' && s.rounds === 1)).toBe(true);
    expect(proposal.tables.map((t) => t.id)).toEqual(tables);
    expect(client.calls.length).toBe(2 + proposal.pages.length);
  });

  it('gives the loans app links and dates, and the tasks app a link and a due date', async () => {
    const loans = (await create(CRITIQUE_PROMPT)).proposal;
    const fields = loans.tables.find((t) => t.id === 'loans').fields;
    expect(fields.filter((f) => f.type === 'reference').map((f) => f.table)).toEqual(['things', 'people']);
    expect(fields.filter((f) => f.type === 'date').length).toBe(2);
    expect(loans.pages.map((p) => p.id)).toEqual(['home', 'things', 'people', 'loan']);
    const tasks = (await create('A todo list with projects')).proposal;
    expect(tasks.tables.find((t) => t.id === 'tasks').fields.map((f) => f.type)).toEqual(['text', 'reference', 'boolean', 'date']);
  });

  it.each([['A roster of work crews.'], ['Keep track of my chores and projects.'], [CRITIQUE_PROMPT]])(
    'an edit of the app made from "%s" adds Notes to the first table without one and keeps every id',
    async (prompt) => {
      const first = (await create(prompt)).proposal;
      const { proposal, fallbacks } = await edit(first, 'Add a place for notes.');
      expect(passes(proposal)).toBe(true);
      expect(fallbacks).toEqual([]);
      const before = idsOf(first);
      const after = idsOf(proposal);
      expect(after.tables).toEqual(before.tables);
      expect(after.pages).toEqual(before.pages);
      expect(after.fields).toEqual(expect.arrayContaining(before.fields));
      expect(after.fields).toContain(`${first.tables[0].id}.notes`);
      expect(after.fields.length).toBe(before.fields.length + 1);
      expect(proposal.nav.map((n) => n.pageId)).toEqual(first.nav.map((n) => n.pageId));
    },
  );

  it('an edit leaves a table alone once it has notes, and adds notes to the next table', async () => {
    const first = (await create(CRITIQUE_PROMPT)).proposal;
    const once = (await edit(first, 'Add notes.')).proposal;
    const twice = await edit(once, 'Add notes again.');
    expect(twice.fallbacks).toEqual([]);
    expect(twice.proposal.tables[0]).toEqual(once.tables[0]);
    expect(twice.proposal.tables[1].fields.map((f) => f.id)).toContain('notes');
  });
});

// P17-30: an ask the fake can do changes exactly the asked thing; an ask it cannot do changes nothing at all, so a journey
// can prove the product's own judgement (Done, Not done, Nothing changed) instead of the fake's side effects.
describe.skipIf(PUBLIC_BUILD)('the fake does what is asked or changes nothing (needs the helper pipeline, which is not in a public build)', () => {
  let loans;
  let crews;
  beforeAll(async () => {
    loans = (await create(CRITIQUE_PROMPT)).proposal;
    crews = (await create('A roster of work crews.')).proposal;
  });
  const run = async (base, ask) => {
    const { proposal, fallbacks } = await edit(base, ask);
    expect(fallbacks).toEqual([]);
    expect(passes(proposal)).toBe(true);
    // src/studio/lib/specDiff.ts needs the browser aliases, so the backend project compares the whole spec as JSON.
    return { proposal, changes: JSON.stringify(base) === JSON.stringify(proposal) ? [] : ['changed'] };
  };
  const fieldsOf = (spec, id) => spec.tables.find((t) => t.id === id).fields;

  it.each([
    ['Make the header blue'],
    ['add a chart of loans per person'],
    ['remove the Nothing page'],
    ['add a page for one gadget'],
    ['add a pretty field to Gadgets'],
  ])('an ask it cannot do ("%s") gives a design with an empty diff', async (ask) => {
    for (const base of [loans, crews]) {
      const { proposal, changes } = await run(base, ask);
      expect(changes).toEqual([]);
      expect(proposal.nav).toEqual(base.nav);
      expect(proposal.menu).toEqual(base.menu);
      expect(proposal.pages).toEqual(base.pages);
    }
  });

  it('add a field: "add a phone number field to Items" adds exactly one text field', async () => {
    const { proposal, changes } = await run(loans, 'add a phone number field to Items');
    const before = fieldsOf(loans, 'things');
    const after = fieldsOf(proposal, 'things');
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toMatchObject([{ id: 'phone_number', label: 'Phone number', type: 'text' }]);
    expect(after.length).toBe(before.length + 1);
    expect(changes).toEqual(['changed']);
    expect(proposal.pages).toEqual(loans.pages);
    expect(proposal.tables.filter((t) => t.id !== 'things')).toEqual(loans.tables.filter((t) => t.id !== 'things'));
  });

  it('add a field to each noun: "add an email address to each person", and a date or an amount by the words', async () => {
    const email = await run(loans, 'add an email address to each person');
    expect(fieldsOf(email.proposal, 'people').at(-1)).toMatchObject({ id: 'email_address', label: 'Email address', type: 'text' });
    expect(email.changes).toEqual(['changed']);
    const date = await run(loans, 'add a return date field to Loans');
    expect(fieldsOf(date.proposal, 'loans').at(-1)).toMatchObject({ id: 'return_date', type: 'date' });
    const price = await run(loans, 'add a replacement price field to Items');
    expect(fieldsOf(price.proposal, 'things').at(-1)).toMatchObject({ id: 'replacement_price', type: 'real' });
  });

  it('add a table: with brackets or "with", a date field, a status select and a link to an existing table', async () => {
    const a = await run(loans, 'add a Clients table (phone, email)');
    const clients = a.proposal.tables.find((t) => t.id === 'clients');
    expect(clients.label).toBe('Clients');
    expect(clients.fields.map((f) => `${f.id}:${f.type}`)).toEqual(['name:text', 'phone:text', 'email:text']);
    expect(a.proposal.tables.length).toBe(loans.tables.length + 1);
    expect(a.proposal.tables.slice(0, loans.tables.length)).toEqual(loans.tables);
    const b = await run(loans, 'add a Repairs table with a date, status and Items');
    const repairs = b.proposal.tables.find((t) => t.id === 'repairs');
    expect(repairs.fields.map((f) => `${f.id}:${f.type}`)).toEqual(['name:text', 'date:date', 'status:select', 'items:reference']);
    expect(repairs.fields.at(-1).table).toBe('things');
    expect(b.proposal.pages).toEqual(loans.pages);
  });

  it('notes are added only when the ask says notes', async () => {
    const yes = await run(crews, 'add a place for notes');
    expect(fieldsOf(yes.proposal, 'crews').map((f) => f.id)).toContain('notes');
    const no = await run(crews, 'make it friendlier');
    expect(no.changes).toEqual([]);
  });

  it('add a page for one record adds /<table>/:id with a record source, in no menu', async () => {
    const { proposal, changes } = await run(loans, 'add a page for one person');
    const page = proposal.pages.find((p) => p.route === '/people/:id');
    expect(page.title).toBe('Person');
    expect(page.sources).toMatchObject([{ table: 'people', mode: 'record' }]);
    expect(proposal.nav).toEqual(loans.nav);
    expect(changes).toEqual(['changed']);
    expect(proposal.pages.length).toBe(loans.pages.length + 1);
    expect((await run(loans, 'add a page per loan')).changes).toEqual([]);
  });

  it('remove the page drops the page and its menu item, and keeps the home page', async () => {
    const { proposal, changes } = await run(loans, 'remove the People page');
    expect(proposal.pages.map((p) => p.id)).toEqual(['home', 'things', 'loan']);
    expect(proposal.nav.map((n) => n.pageId)).toEqual(['home', 'things']);
    expect(changes).toEqual(['changed']);
    expect((await run(loans, 'remove the Open loans page')).changes).toEqual([]);
  });

  it('keeps the menu icons and the list filters of the design it changes', async () => {
    const { proposal } = await run(loans, 'add an email address to each person');
    expect(proposal.nav).toEqual(loans.nav);
    expect(proposal.pages.find((p) => p.id === 'home').sources).toEqual(loans.pages.find((p) => p.id === 'home').sources);
    expect(proposal.menu).toEqual({ position: 'top', style: 'icons-and-labels' });
  });

  it('"change the look to dark green" sets the forest look through the real pipeline and changes nothing else', async () => {
    const { proposal, changes } = await run(crews, 'change the look to dark green');
    expect(changes).toEqual(['changed']);
    expect(proposal.theme.id).toBe('forest');
    expect(proposal.tables).toEqual(crews.tables);
    expect(proposal.pages).toEqual(crews.pages);
    expect(proposal.nav).toEqual(crews.nav);
  });

  it('the first crews design lists the open crews on Home with a form, but describeFakeChat keeps its old Home', () => {
    const types = [];
    const walk = (l) => {
      types.push(l.type);
      if (Array.isArray(l.children)) l.children.filter((c) => typeof c === 'object').forEach(walk);
    };
    walk(crews.pages.find((p) => p.id === 'home').layout);
    expect(types).toEqual(['Page', 'Section', 'Heading', 'DataTable', 'RecordForm']);
    expect(CREWS.pages.home.children[0].children.map((c) => c.type)).toEqual(['Heading', 'Button']);
  });
});

describe('pickScenario', () => {
  const pick = (instruction) =>
    pickScenario({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: `The app: ${instruction}\nReply with its tables.` }] });

  it('lists the scenarios', () => {
    expect(SCENARIOS).toEqual(['crews', 'tasks', 'loans', 'dashboard', 'change']);
  });

  it.each([
    ['loan', 'loans'], ['LOANS', 'loans'], ['borrow my drill', 'loans'], ['borrowed', 'loans'], ['lend tools', 'loans'],
    ['lending library', 'loans'], ['rental shop', 'loans'], ['rent a van', 'loans'], ['when is it due', 'loans'],
    ['overdue books', 'loans'], ['checkout desk', 'loans'], ['task list', 'tasks'], ['my Projects', 'tasks'],
    ['a todo', 'tasks'], ['chore chart', 'tasks'], ['chores', 'tasks'], ['a roster of crews', 'crews'], ['recipes', 'crews'],
  ])('"%s" picks %s', (words, expected) => {
    expect(pick(words)).toBe(expected);
  });

  it('matches whole words only', () => {
    expect(pick('rentals')).toBe('crews');
    expect(pick('product dueling')).toBe('crews');
    expect(pick('subtasks')).toBe('crews');
  });

  it.each([
    ['a sales dashboard', 'dashboard'], ['Dashboards for my shop', 'dashboard'], ['kpi tiles', 'dashboard'], ['show my KPIs', 'dashboard'],
    ['tiles of numbers', 'dashboard'], ['a dashboard of loans', 'dashboard'], ['a dashboard of tasks', 'dashboard'],
  ])('"%s" picks %s', (words, expected) => {
    expect(pick(words)).toBe(expected);
  });

  it('does not take dashboard words inside other words, and an edit stays change', () => {
    expect(pick('dashboarding')).toBe('crews');
    expect(pick('a kpish thing')).toBe('crews');
    const edit = [{ role: 'user', content: 'Current tables:\n{"tables":[]}\nChange: add a dashboard\nReply with the whole tables block.' }];
    expect(pickScenario({ messages: edit })).toBe('change');
  });

  it('loans win over tasks when both appear', () => {
    expect(pick('tasks and loans')).toBe('loans');
  });

  it('picks change for an edit, in the tables and outline steps', () => {
    const tables = [{ role: 'user', content: 'Current tables:\n{"tables":[]}\nChange: add loans\nReply with the whole tables block.' }];
    expect(pickScenario({ messages: tables })).toBe('change');
    const outline = [{ role: 'user', content: 'Tables:\nx (X): a text\nCurrent pages:\nhome "Home" /\nCurrent menu: home\nReply.\nChange: tasks' }];
    expect(pickScenario({ messages: outline })).toBe('change');
  });

  it('reads only the person words, not the table summary of the outline step', () => {
    const outline = [{ role: 'user', content: 'Tables:\nloans (Loans): due date\nThe app: A roster of crews' }];
    expect(pickScenario({ messages: outline })).toBe('crews');
  });

  it('picks the 241-character newcomer prompt as loans', () => {
    expect(CRITIQUE_PROMPT.length).toBe(241);
    expect(pick(CRITIQUE_PROMPT)).toBe('loans');
  });
});

describe('cannedDescribeChat and describeFakeChat', () => {
  it('a green look is the forest theme only when the helper may propose a look', () => {
    const reply = (system) =>
      JSON.parse(
        cannedDescribeChat({
          format: { properties: { tables: {} } },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: 'Current tables:\n{"tables":[]}\nChange: change the look to dark green\nReply with the whole tables block after the change.' },
          ],
        }),
      );
    expect(reply('Tables. Optionally add "theme" for the look: slate.').theme).toBe('forest');
    expect(reply('Tables.').theme).toBeUndefined();
  });

  it('returns undefined when there is no schema, so the plain reply path answers', () => {
    expect(cannedDescribeChat({ messages: [{ role: 'user', content: 'hello' }] })).toBeUndefined();
    expect(cannedDescribeChat(null)).toBeUndefined();
  });

  it('keeps describeFakeChat on the crew roster for every prompt', () => {
    const body = (properties) => ({ format: { properties }, messages: [{ role: 'user', content: `The app: ${CRITIQUE_PROMPT}\nReply with its tables.` }] });
    expect(JSON.parse(describeFakeChat(body({ tables: {} })))).toEqual(CREWS.tables);
    expect(JSON.parse(describeFakeChat(body({ nav: {} })))).toEqual(CREWS.outline);
    expect(JSON.parse(describeFakeChat(body({ type: {} })))).toEqual(CREWS.pages.home);
  });

  it('has a layer for every page of every answer set', () => {
    for (const set of [CREWS, TASKS, LOANS]) {
      expect(Object.keys(set.pages).sort()).toEqual(set.outline.pages.map((p) => p.id).sort());
    }
  });
});

const dashboardSpec = (home) => {
  let n = 0;
  const withIds = (layer) => {
    const { children, grid, ...rest } = layer;
    const out = { id: `l${(n += 1)}`, ...rest, children: Array.isArray(children) ? children.map(withIds) : (children ?? []) };
    return grid ? { ...out, grid } : out;
  };
  const page = DASHBOARD.outline.pages[0];
  const grid = home.children.find((c) => c.type === 'Grid');
  const layout = withIds({
    ...home,
    children: home.children.map((c) => (c === grid && c.props.placement === 'free' ? { ...c, props: { ...c.props, columns: 12, rows: Math.max(...placesOf(c).flatMap((q) => cellsOf(q).map((x) => x.row))) } } : c)),
  });
  return {
    specVersion: 1,
    app: { ...APP },
    theme: { preset: 'ocean', radius: 'md' },
    tables: DASHBOARD.tables.tables,
    pages: [{ id: page.id, title: page.title, route: page.route, sources: page.sources, layout }],
    nav: DASHBOARD.outline.nav,
  };
};
const freeGridOf = (page) => page.children.find((c) => c.type === 'Grid');
const placesOf = (grid) => grid.children.map((c) => readGrid(c.grid));
const stepBody = (properties, content) => ({ format: { properties }, messages: [{ role: 'user', content }] });

describe('the dashboard answers (static shape, no pipeline)', () => {
  it('has the orders table, one Dashboard page and the Grid and Chart parts', () => {
    expect(DASHBOARD.tables.tables.map((t) => t.id)).toEqual(['orders']);
    expect(DASHBOARD.tables.tables[0].fields.map((f) => f.id)).toEqual(['name', 'status', 'amount', 'placed']);
    expect(DASHBOARD.outline.pages.map((p) => [p.id, p.title, p.route])).toEqual([['home', 'Dashboard', '/']]);
    expect(DASHBOARD.outline.pages[0].parts).toEqual(['Grid', 'Chart']);
    expect(Object.keys(DASHBOARD.pages)).toEqual(['home']);
  });

  it('lays the home page out as a Heading, then a free Grid of three stat cards, a chart and a list at the Part 0 cells', () => {
    const home = DASHBOARD.pages.home;
    expect(home.children.map((c) => c.type)).toEqual(['Heading', 'Grid']);
    const grid = freeGridOf(home);
    expect(grid.props).toEqual({ placement: 'free' });
    expect(grid.children.map((c) => [c.type, c.grid])).toEqual([
      ['StatCard', { col: 1, span: 4, row: 1, rowSpan: 1 }],
      ['StatCard', { col: 5, span: 4, row: 1, rowSpan: 1 }],
      ['StatCard', { col: 9, span: 4, row: 1, rowSpan: 1 }],
      ['Chart', { col: 1, span: 8, row: 2, rowSpan: 3 }],
      ['RecordList', { col: 9, span: 4, row: 2, rowSpan: 3 }],
    ]);
    const places = placesOf(grid);
    places.forEach((a, i) => places.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    expect(Math.max(...places.flatMap((p) => cellsOf(p).map((c) => c.row)))).toBe(4);
  });

  it('the fixtures: messy has the five problems, forgot has no placement and no cells, stacked is a one column flow', () => {
    const messy = freeGridOf(DASHBOARD_MESSY_PAGE);
    expect(DASHBOARD_MESSY_PAGE.children[0].grid).toEqual({ col: 1, span: 12, row: 1, rowSpan: 1 });
    expect(messy.children.map((c) => c.grid)).toEqual([
      { col: 1, span: 4, row: 1, rowSpan: 1 }, { col: 1, span: 8, row: 1, rowSpan: 3 }, { col: 5, span: 4, row: 1, rowSpan: 1 },
      undefined, { col: 9, span: 6, row: 2, rowSpan: 3 },
    ]);
    const forgot = freeGridOf(DASHBOARD_FORGOT_PLACEMENT_PAGE);
    expect(forgot.props).toEqual({});
    expect(forgot.children.every((c) => c.grid === undefined)).toBe(true);
    expect(forgot.children.map((c) => c.type)).toEqual(['StatCard', 'StatCard', 'StatCard', 'Chart', 'RecordList']);
    const stacked = freeGridOf(DASHBOARD_STACKED_PAGE);
    expect(stacked.props).toEqual({ columns: 1 });
    expect(stacked.children.every((c) => c.grid === undefined)).toBe(true);
  });

  it('answers each step from the dashboard words', () => {
    const asks = 'A sales dashboard for my orders';
    const tables = JSON.parse(cannedDescribeChat(stepBody({ tables: {} }, `The app: ${asks}\nReply with its tables.`)));
    expect(tables).toEqual(DASHBOARD.tables);
    const outline = JSON.parse(cannedDescribeChat(stepBody({ nav: {} }, `Tables:\norders (Orders): name text\nThe app: ${asks}`)));
    expect(outline).toEqual(DASHBOARD.outline);
    const pageMsg = `App "A": ${asks}\nLay out the page "Dashboard" (id home, route /). Purpose: x\nSources: all_orders: list of orders (fields name)\nOther pages: none`;
    expect(JSON.parse(cannedDescribeChat(stepBody({ type: {} }, pageMsg)))).toEqual(DASHBOARD.pages.home);
    const stackedMsg = pageMsg.replace(asks, `${asks}, stacked`);
    expect(JSON.parse(cannedDescribeChat(stepBody({ type: {} }, stackedMsg)))).toEqual(DASHBOARD_STACKED_PAGE);
  });
});

describe('the dashboard layout edits (page step with Current layout)', () => {
  const layoutOf = () => JSON.parse(JSON.stringify(DASHBOARD.pages.home));
  const ask = (instruction, layout = layoutOf()) => {
    const user =
      `App "A": ${instruction}\nLay out the page "Dashboard" (id home, route /). Purpose: x\n` +
      `Current layout: ${JSON.stringify(layout)}\nSources: all_orders: list of orders (fields name)\nOther pages: none`;
    return JSON.parse(cannedDescribeChat(stepBody({ type: {} }, user)));
  };

  it.each([['stack these instead'], ['Make it stacked'], ['one column please'], ['no grid'], ['put one under another']])(
    '"%s" makes the free Grid flow',
    (words) => {
      const grid = freeGridOf(ask(words));
      expect(grid.props).toEqual({ columns: 1 });
      expect(grid.children.every((c) => c.grid === undefined)).toBe(true);
      expect(grid.children.map((c) => c.type)).toEqual(['StatCard', 'StatCard', 'StatCard', 'Chart', 'RecordList']);
    },
  );

  it('"add a tile" adds one StatCard at the end with no cell and keeps every cell', () => {
    const grid = freeGridOf(ask('Add a tile.'));
    expect(grid.children.length).toBe(6);
    const tile = grid.children[5];
    expect(tile.type).toBe('StatCard');
    expect(tile.props.source).toBe('all_orders');
    expect(tile.grid).toBeUndefined();
    expect(grid.children.slice(0, 5)).toEqual(freeGridOf(DASHBOARD.pages.home).children);
    expect(grid.props.placement).toBe('free');
  });

  it('"move the chart to the bottom" puts the chart on row 5 and nothing else moves', () => {
    const grid = freeGridOf(ask('move the chart to the bottom'));
    expect(grid.children.find((c) => c.type === 'Chart').grid).toEqual({ col: 1, span: 8, row: 5, rowSpan: 3 });
    expect(grid.children.filter((c) => c.type !== 'Chart')).toEqual(freeGridOf(DASHBOARD.pages.home).children.filter((c) => c.type !== 'Chart'));
  });

  it('does clauses in order, and leaves the layout alone for anything else', () => {
    const both = freeGridOf(ask('Add a tile. Move the chart to the bottom'));
    expect(both.children.length).toBe(6);
    expect(both.children.find((c) => c.type === 'Chart').grid.row).toBe(5);
    expect(ask('make the chart red')).toEqual(DASHBOARD.pages.home);
    expect(ask('Make it blue')).toEqual(DASHBOARD.pages.home);
  });

  it('never turns a flow Grid, and an unparseable layout gets a plain page', () => {
    const flow = { type: 'Page', props: {}, children: [{ type: 'Grid', props: { columns: 2 }, children: [{ type: 'Text', props: {}, children: 'x' }] }] };
    expect(ask('stack these', flow)).toEqual(flow);
    const bad = 'App "A": stack\nLay out the page "Home" (id home, route /). Purpose: x\nCurrent layout: {nope\nSources: none\nOther pages: none';
    expect(JSON.parse(cannedDescribeChat(stepBody({ type: {} }, bad))).type).toBe('Page');
  });
});

describe.skipIf(PUBLIC_BUILD)('the dashboard answers validate (needs the helper pipeline, which is not in a public build)', () => {
  it.each([
    ['the clean home page', DASHBOARD.pages.home],
    ['the stacked page', DASHBOARD_STACKED_PAGE],
  ])('%s passes the real validator once the pipeline has filled in columns and rows', (_name, home) => {
    expect(validateAppSpec(dashboardSpec(home), { ...CATALOG_CHECKS }).ok).toBe(true);
  });

  it('the edited layouts pass too', () => {
    const ask = (instruction) => {
      const user =
        `App "A": ${instruction}\nLay out the page "Dashboard" (id home, route /). Purpose: x\n` +
        `Current layout: ${JSON.stringify(DASHBOARD.pages.home)}\nSources: all_orders: list of orders (fields name)\nOther pages: none`;
      return JSON.parse(cannedDescribeChat(stepBody({ type: {} }, user)));
    };
    expect(validateAppSpec(dashboardSpec(ask('move the chart to the bottom')), { ...CATALOG_CHECKS }).ok).toBe(true);
    expect(validateAppSpec(dashboardSpec(ask('stack these')), { ...CATALOG_CHECKS }).ok).toBe(true);
  });
});
