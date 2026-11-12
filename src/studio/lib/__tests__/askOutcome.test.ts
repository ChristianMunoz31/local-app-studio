import { describe, expect, it } from 'vitest';
import type { AppSpec, Field, LayoutLayer, Page, Table } from '@local-app-studio/runtime/spec/schema';
import { ALSO_CHANGED_HEADING, ASK_ALL_MISSED, EXIT_DATA, EXIT_DESIGN, EXIT_LOOK, NOTHING_CHANGED, askOutcome, splitClauses } from '../askOutcome';
import type { AskOutcome } from '../askOutcome';
import { changeBullets } from '../promptBullets';
import { diffSpecs } from '../specDiff';
import { crewRosterSpec, loansSpec, tasksSpec } from './promptBulletsFixtures';

const judge = (ask: string, before: AppSpec, after: AppSpec): AskOutcome => askOutcome({ ask, changes: diffSpecs(before, after), before, after });
const also = (before: AppSpec, after: AppSpec, outcome: AskOutcome): string[] => changeBullets(after, outcome.alsoChanged).shown;

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture is missing a part');
  return value;
}

const text = (id: string, label: string): Field => ({ id, label, type: 'text', required: false });
const withField = (spec: AppSpec, tableId: string, field: Field): AppSpec => {
  const next = structuredClone(spec);
  must(next.tables.find((t) => t.id === tableId)).fields.push(field);
  return next;
};
const withoutPage = (spec: AppSpec, pageId: string): AppSpec => {
  const next = structuredClone(spec);
  next.pages = next.pages.filter((p) => p.id !== pageId);
  next.nav = next.nav.filter((n) => n.pageId !== pageId);
  return next;
};
const withLook = (spec: AppSpec): AppSpec => ({ ...structuredClone(spec), theme: { preset: 'aurora', radius: 'md', id: 'forest' } as AppSpec['theme'] });
const withPersonPage = (spec: AppSpec): AppSpec => {
  const next = structuredClone(spec);
  const body: LayoutLayer = { id: 'h_person', type: 'Heading', props: {}, children: 'Person' };
  const page: Page = {
    id: 'person',
    title: 'Person',
    route: '/people/:id',
    sources: [{ id: 'person', table: 'people', mode: 'record', where: [], orderBy: [], limit: 1 }],
    layout: { id: 'root_person', type: 'Page', props: {}, children: [body] },
  };
  next.pages.push(page);
  return next;
};
/** What the fake helper used to do to every ask: a Notes field on Items and a new icon on a menu item. */
const sideEffects = (spec: AppSpec): AppSpec => {
  const next = withField(spec, 'things', text('notes', 'Notes'));
  must(next.nav.find((n) => n.pageId === 'things')).icon = 'star';
  return next;
};

const tbl = (id: string, label: string, fields: Field[]): Table => ({ id, label, fields }) as unknown as Table;
/** The tutoring app of the phase 26 tutor run: Students, Sessions, Tutors on one Home page. */
const tutorSpec = (): AppSpec => {
  const spec = crewRosterSpec();
  spec.tables = [
    tbl('students', 'Students', [text('name', 'Name'), text('grade', 'Grade')]),
    tbl('sessions', 'Sessions', [text('student', 'Student'), text('hours', 'Hours')]),
    tbl('tutors', 'Tutors', [text('name', 'Name'), text('subjects', 'Subjects')]),
  ];
  return spec;
};

describe('splitClauses', () => {
  it('splits sentences, "and then", semicolons and "and" before another verb', () => {
    expect(splitClauses('Change the look to dark green. Remove the Items page. Add an email address field to People.')).toEqual([
      'Change the look to dark green',
      'Remove the Items page',
      'Add an email address field to People',
    ]);
    expect(splitClauses('Add a chart and then remove the Items page; hide Notes')).toEqual(['Add a chart', 'remove the Items page', 'hide Notes']);
    expect(splitClauses('Add a Clients table and a Jobs table')).toEqual(['Add a Clients table and a Jobs table']);
    expect(splitClauses('Make the look dark, like a climbing gym')).toEqual(['Make the look dark, like a climbing gym']);
    expect(splitClauses('  ')).toEqual([]);
  });
});

describe('askOutcome on the founder asks (loans design)', () => {
  const before = loansSpec();

  it('1. "Add an email address to each person": Done when People got an Email field', () => {
    const after = withField(before, 'people', text('email', 'Email'));
    const outcome = judge('Add an email address to each person.', before, after);
    expect(outcome.lines.map((l) => l.text)).toEqual(['Done: Add an email address to each person']);
    expect(outcome.lines[0].exit).toBeNull();
    expect(outcome.alsoChanged).toEqual([]);
    expect(outcome.nothingChanged).toBe(false);
    expect(outcome.missedAll).toBe(false);
  });

  it('1. Not done when only Notes on Items and a menu icon changed, which are listed under It also changed', () => {
    const after = sideEffects(before);
    const outcome = judge('Add an email address to each person.', before, after);
    expect(outcome.lines.map((l) => l.text)).toEqual(['Not done: Add an email address to each person']);
    expect(outcome.lines[0].exit).toEqual({ kind: 'data', label: EXIT_DATA });
    expect(outcome.missedAll).toBe(true);
    expect(also(before, after, outcome)).toEqual(['Added a Notes field to Items', 'Changed the icon of Items in the menu']);
    expect(ALSO_CHANGED_HEADING).toBe('It also changed');
  });

  it('2. "Add a page for one person that shows their payments": Done by a new Person page, Not done by side effects', () => {
    const ask = 'Add a page for one person that shows their payments.';
    const done = judge(ask, before, withPersonPage(before));
    expect(done.lines.map((l) => l.text)).toEqual([`Done: ${ask.slice(0, -1)}`]);
    const missed = judge(ask, before, sideEffects(before));
    expect(missed.lines.map((l) => l.text)).toEqual([`Not done: ${ask.slice(0, -1)}`]);
    expect(missed.lines[0].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
    expect(missed.alsoChanged).toHaveLength(2);
  });

  it('3. "Change the look to dark green, like a climbing gym": Done by a new look, Not done with a way to the Look tab', () => {
    const ask = 'Change the look to dark green, like a climbing gym.';
    const done = judge(ask, before, withLook(before));
    expect(done.lines.map((l) => l.text)).toEqual(['Done: Change the look to dark green, like a climbing gym']);
    expect(done.alsoChanged).toEqual([]);
    const missed = judge(ask, before, sideEffects(before));
    expect(missed.lines.map((l) => l.text)).toEqual(['Not done: Change the look to dark green, like a climbing gym']);
    expect(missed.lines[0].exit).toEqual({ kind: 'look', label: EXIT_LOOK });
    expect(also(before, sideEffects(before), missed)).toHaveLength(2);
  });

  it('4. "Remove the Items page": Done when the page is gone (and its menu entry with it), Not done when Items is still there', () => {
    const done = judge('Remove the Items page.', before, withoutPage(before, 'things'));
    expect(done.lines.map((l) => l.text)).toEqual(['Done: Remove the Items page']);
    expect(done.alsoChanged).toEqual([]);
    const missed = judge('Remove the Items page.', before, sideEffects(before));
    expect(missed.lines[0].done).toBe(false);
    expect(missed.lines[0].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
  });

  it('5. "Add an email address field to People": an Email field on another table does not count', () => {
    const ask = 'Add an email address field to People.';
    expect(judge(ask, before, withField(before, 'people', text('email', 'Email'))).lines[0].done).toBe(true);
    const wrongTable = withField(before, 'things', text('email', 'Email'));
    const outcome = judge(ask, before, wrongTable);
    expect(outcome.lines.map((l) => l.text)).toEqual(['Not done: Add an email address field to People']);
    expect(outcome.lines[0].exit).toEqual({ kind: 'data', label: EXIT_DATA });
    expect(also(before, wrongTable, outcome)).toEqual(['Added an Email field to Items']);
  });

  it('the joined asks of the critique are judged one by one', () => {
    const after = withoutPage(withLook(before), 'things');
    const outcome = judge('Change the look to dark green. Remove the Items page. Add an email address field to People.', before, after);
    expect(outcome.lines.map((l) => l.text)).toEqual([
      'Done: Change the look to dark green',
      'Done: Remove the Items page',
      'Not done: Add an email address field to People',
    ]);
    expect(outcome.missedAll).toBe(false);
    expect(outcome.alsoChanged).toEqual([]);
  });
});

describe('askOutcome on the freelancer ask (crew roster)', () => {
  const before = crewRosterSpec();
  const ask = 'Add a Clients table (name, phone, address) and a Jobs table with a date, a status and the crew assigned.';

  it('Done when a Clients table was added', () => {
    const after = structuredClone(before);
    const clients: Table = { id: 'clients', label: 'Clients', titleField: 'name', fields: [text('name', 'Name'), text('phone', 'Phone'), text('address', 'Address')] };
    after.tables.push(clients);
    const outcome = judge(ask, before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([true]);
    expect(outcome.lines[0].text.startsWith('Done: Add a Clients table')).toBe(true);
  });

  it('the same Crews design back: Nothing changed, Not done, a way to Data, and the helper did not do what was asked', () => {
    const outcome = judge(ask, before, structuredClone(before));
    expect(outcome.nothingChanged).toBe(true);
    expect(NOTHING_CHANGED).toBe('Nothing changed.');
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0].done).toBe(false);
    expect(outcome.lines[0].exit).toEqual({ kind: 'data', label: EXIT_DATA });
    expect(outcome.missedAll).toBe(true);
    expect(outcome.alsoChanged).toEqual([]);
    expect(ASK_ALL_MISSED).toBe('The helper did not do what you asked. Try other words, or do it yourself.');
  });

  it('is not Done by a Notes table or a Phone field somewhere else', () => {
    const after = withField(before, 'people', text('phone', 'Phone'));
    const outcome = judge(ask, before, after);
    expect(outcome.lines[0].done).toBe(false);
    expect(also(before, after, outcome)).toEqual(['Added a Phone field to People']);
  });
});

describe('askOutcome basics', () => {
  it('has no lines for words that name nothing', () => {
    const before = loansSpec();
    expect(askOutcome({ ask: '   ', changes: [], before, after: before })).toEqual({ lines: [], alsoChanged: [], nothingChanged: true, missedAll: false });
  });

  it('a chart ask is Done by a Chart part on a page and Not done by a list', () => {
    const before = crewRosterSpec();
    const chart = structuredClone(before);
    must(chart.pages[0]).layout.children = [...(must(chart.pages[0]).layout.children as LayoutLayer[]), { id: 'c1', type: 'Chart', props: { source: 'open_crews' }, children: [] }];
    expect(judge('Add a chart to the home page.', before, chart).lines.map((l) => l.done)).toEqual([true]);
    const missed = judge('Add a chart to the home page.', before, withField(before, 'crews', text('notes', 'Notes')));
    expect(missed.lines[0].done).toBe(false);
  });
});

describe('askOutcome never calls a not done ask Done', () => {
  const addPart = (spec: AppSpec, pageId: string, layer: LayoutLayer): AppSpec => {
    const next = structuredClone(spec);
    const page = must(next.pages.find((p) => p.id === pageId));
    const section = (page.layout.children as LayoutLayer[])[0];
    section.children = [...(section.children as LayoutLayer[]), layer];
    return next;
  };
  const chartOf = (id: string, source: string): LayoutLayer => ({ id, type: 'Chart', props: { source, groupBy: 'status' }, children: [] });

  it('"Change the Projects page to show the due date" is Not done by an unrelated edit of the Projects page', () => {
    const before = tasksSpec();
    const after = addPart(before, 'projects', { id: 'h2', type: 'Heading', props: {}, children: 'Hello' });
    const outcome = judge('Change the Projects page to show the due date.', before, after);
    expect(outcome.lines.map((l) => l.text)).toEqual(['Not done: Change the Projects page to show the due date']);
    expect(outcome.alsoChanged).toHaveLength(1);
  });

  it('a page edit still explains a clause that names nothing but the page', () => {
    const before = tasksSpec();
    const after = addPart(before, 'projects', { id: 'h2', type: 'Heading', props: {}, children: 'Hello' });
    expect(judge('Change the Projects page.', before, after).lines.map((l) => l.done)).toEqual([true]);
  });

  it('"Add an address to People" is Not done when only a part was added on the People page', () => {
    const before = loansSpec();
    const after = addPart(before, 'people', { id: 'qa', type: 'QuickAdd', props: { table: 'people', field: 'name' }, children: [] });
    const outcome = judge('Add an address to People.', before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([false]);
    expect(outcome.alsoChanged).toHaveLength(1);
  });

  it('"Add a chart of Projects by Status" is Not done when a chart of Tasks was added, Done when one of Projects was', () => {
    const before = tasksSpec();
    const tasksChart = addPart(before, 'home', chartOf('c1', 'open_tasks'));
    expect(judge('Add a chart of Projects by Status.', before, tasksChart).lines.map((l) => l.done)).toEqual([false]);
    const projectsChart = addPart(before, 'projects', chartOf('c2', 'all_projects'));
    expect(judge('Add a chart of Projects by Status.', before, projectsChart).lines.map((l) => l.done)).toEqual([true]);
  });

  it('"Dont add a chart" is never Done: Not done when a chart came anyway, no line when none did', () => {
    const before = tasksSpec();
    const made = judge("Don't add a chart.", before, addPart(before, 'home', chartOf('c1', 'open_tasks')));
    expect(made.lines.map((l) => l.text)).toEqual(["Not done: Don't add a chart"]);
    expect(made.alsoChanged).toHaveLength(1);
    const kept = judge('Do not add a chart.', before, structuredClone(before));
    expect(kept.lines).toEqual([]);
    expect(kept.missedAll).toBe(false);
  });
});

describe('askOutcome on a rename (phase 17 round 2, N4)', () => {
  const renamed = (spec: AppSpec, tableId: string, label: string): AppSpec => {
    const next = structuredClone(spec);
    const table = must(next.tables.find((t) => t.id === tableId));
    const old = table.label;
    table.label = label;
    // Rename everywhere: the pages and menu that said the old name say the new one (L-4).
    const swap = (text: string): string => text.replace(new RegExp(`\\b${old.replace(/s$/i, '')}s?\\b`, 'gi'), label);
    next.pages = JSON.parse(swap(JSON.stringify(next.pages))) as AppSpec['pages'];
    next.nav = JSON.parse(swap(JSON.stringify(next.nav))) as AppSpec['nav'];
    return next;
  };

  it('"Rename the Tasks table to Jobs" is Not done when the table became Work, Done when it became Jobs', () => {
    const before = tasksSpec();
    const ask = 'Rename the Tasks table to Jobs.';
    expect(judge(ask, before, renamed(before, 'tasks', 'Work')).lines.map((l) => l.done)).toEqual([false]);
    expect(judge(ask, before, renamed(before, 'tasks', 'Jobs')).lines.map((l) => l.done)).toEqual([true]);
  });
});

describe('askOutcome negation (phase 17 round 2, N5)', () => {
  const withChart = (spec: AppSpec): AppSpec => {
    const next = structuredClone(spec);
    const page = must(next.pages.find((p) => p.id === 'home'));
    const section = (page.layout.children as LayoutLayer[])[0];
    section.children = [...(section.children as LayoutLayer[]), { id: 'c1', type: 'Chart', props: { source: 'open_tasks', groupBy: 'status' }, children: [] }];
    return next;
  };

  it('splits before "and dont", "and do not", "and never" and "and not"', () => {
    expect(splitClauses("Add a chart and don't remove anything")).toEqual(['Add a chart', "don't remove anything"]);
    expect(splitClauses('Add a chart and do not remove anything')).toEqual(['Add a chart', 'do not remove anything']);
    expect(splitClauses('Add a chart and never delete a page')).toEqual(['Add a chart', 'never delete a page']);
  });

  it('"Add a chart and dont remove anything" judges each side: the chart is Done, the untouched removal makes no line', () => {
    const before = tasksSpec();
    const outcome = judge("Add a chart and don't remove anything", before, withChart(before));
    expect(outcome.lines.map((l) => l.text)).toEqual(['Done: Add a chart']);
  });

  it('"Add a number field with no decimals" is never Done by a field added, and "no" before a verb still negates', () => {
    const before = tasksSpec();
    const after = withField(before, 'tasks', { id: 'amount', label: 'Amount', type: 'integer', required: false });
    const outcome = judge('Add a number field with no decimals.', before, after);
    expect(outcome.lines.some((l) => l.done)).toBe(false);
    const made = judge('No adding a chart.', before, withChart(before));
    expect(made.lines.map((l) => l.done)).toEqual([false]);
    expect(judge('No chart please.', before, withChart(before)).lines.map((l) => l.done)).toEqual([false]);
  });
});

describe('askOutcome negation round two (RV26-5, RV26-6)', () => {
  it('a "not" deep in a verbless clause is a detail of a thing, not a negation', () => {
    const before = tasksSpec();
    const after = structuredClone(before);
    after.pages.push({ id: 'orders', title: 'Orders', route: '/orders', sources: [], layout: { id: 'r', type: 'Page', props: {}, children: [] } } as unknown as Page);
    const lines = judge('A page for orders that are not paid', before, after).lines;
    expect(lines.map((l) => l.done)).toEqual([true]);
    expect(judge('Not a page for orders', before, after).lines.some((l) => l.done)).toBe(false);
  });

  it("splits before ', but don't', ' but not' and ' but never'", () => {
    expect(splitClauses("Add a Paid field, but don't remove anything")).toEqual(['Add a Paid field', "don't remove anything"]);
    expect(splitClauses('Add a Paid field but not a table')).toEqual(['Add a Paid field', 'not a table']);
    expect(splitClauses('Add a Paid field, but never delete a page')).toEqual(['Add a Paid field', 'never delete a page']);
  });

  it("'Add a Paid field, but don't remove anything' is Done for the field when it was made", () => {
    const before = tasksSpec();
    const after = withField(before, 'tasks', { id: 'paid', label: 'Paid', type: 'boolean', required: false });
    const lines = judge("Add a Paid field, but don't remove anything", before, after).lines;
    expect(lines.map((l) => l.text)).toEqual(['Done: Add a Paid field']);
  });
});

describe('askOutcome part with no table (phase 17 round 2, L5)', () => {
  it('a chart that names no table does not satisfy "Add a chart of Projects", but does satisfy "Add a chart"', () => {
    const before = tasksSpec();
    const after = structuredClone(before);
    const page = must(after.pages.find((p) => p.id === 'home'));
    const section = (page.layout.children as LayoutLayer[])[0];
    section.children = [...(section.children as LayoutLayer[]), { id: 'c0', type: 'Chart', props: {}, children: [] }];
    expect(judge('Add a chart of Projects.', before, after).lines.map((l) => l.done)).toEqual([false]);
    expect(judge('Add a chart.', before, after).lines.map((l) => l.done)).toEqual([true]);
  });
});

describe('askOutcome on a table the app does not have (phase 17 round 3)', () => {
  const before = loansSpec();
  const after = withField(before, 'things', text('notes', 'Notes'));

  it('"Add a Notes field to the Moons table" is Not done when Notes only went to Items', () => {
    const outcome = judge('Add a Notes field to the Moons table', before, after);
    expect(outcome.lines.map((l) => l.text)).toEqual(['Not done: Add a Notes field to the Moons table']);
    expect(outcome.lines[0].exit?.kind).toBe('data');
    expect(outcome.missedAll).toBe(true);
  });

  it('"Add a Notes field to Moons" (a capitalised noun in the target position) is Not done too', () => {
    expect(judge('Add a Notes field to Moons', before, after).lines.map((l) => l.done)).toEqual([false]);
  });

  it('"Add a Notes field to the Items table" is Done when Notes was added to Items', () => {
    const outcome = judge('Add a Notes field to the Items table', before, after);
    expect(outcome.lines.map((l) => l.text)).toEqual(['Done: Add a Notes field to the Items table']);
    expect(outcome.alsoChanged).toEqual([]);
  });

  it('naming People is Not done when Notes went to Items', () => {
    expect(judge('Add a Notes field to the People table', before, after).lines.map((l) => l.done)).toEqual([false]);
  });
});

describe('askOutcome, a detail "not" (B-6)', () => {
  const BAKERY =
    'Make the home page a dashboard: three tiles across the top showing how many orders are for today, how many orders are not paid yet, and total sales, and under them a chart of orders by product.';

  it('is one Not done line with the Design exit when the dashboard was not made, never silence', () => {
    const before = crewRosterSpec();
    const after = structuredClone(before);
    const crews = must(after.tables.find((t) => t.id === 'crews'));
    crews.fields = [...crews.fields, { id: 'sales', label: 'Sales', type: 'text' } as Field];
    const outcome = judge(BAKERY, before, after);
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0].done).toBe(false);
    expect(outcome.lines[0].text.startsWith('Not done: ')).toBe(true);
    expect(outcome.lines[0].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
  });

  it('still reads "don\'t add a chart" and "do not stack" as a refusal', () => {
    const before = crewRosterSpec();
    expect(judge("Don't add a chart", before, before).lines).toEqual([]);
    expect(judge('Do not add a chart', before, before).lines).toEqual([]);
  });
});

describe('askOutcome multi-sentence ask (T-5)', () => {
  const ASK =
    'Make my home page a dashboard on a free grid. Across the top, three tiles: sessions this month, hours taught, and invoices not paid yet. Underneath, a chart of hours by tutor, and next to the chart a list of the latest sessions.';

  it('gives every sentence a line; the middle one with a detail "not" is Not done with its exit', () => {
    const before = tutorSpec();
    const outcome = judge(ASK, before, before);
    expect(outcome.lines.map((l) => l.clause)).toEqual([
      'Make my home page a dashboard on a free grid',
      'Across the top, three tiles: sessions this month, hours taught, and invoices not paid yet',
      'Underneath, a chart of hours by tutor, and next to the chart a list of the latest sessions',
    ]);
    expect(outcome.lines.every((l) => !l.done)).toBe(true);
    expect(outcome.lines[1].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
  });
});

describe('askOutcome table ask met by fields on an existing table (T-7)', () => {
  const ASK = 'Please add a rate per hour to each student, so I know what to charge them. And I need a table for my tutors with their name, email and the subjects they teach.';

  it('is Done when the Tutors table got the Email field, and Email is not listed under It also changed', () => {
    const before = tutorSpec();
    const after = withField(withField(before, 'students', text('rate', 'Rate')), 'tutors', text('email', 'Email'));
    const outcome = judge(ASK, before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([true, true]);
    expect(also(before, after, outcome)).toEqual([]);
  });

  it('is Not done when nothing about Tutors changed, and when an Email field was removed', () => {
    const before = withField(tutorSpec(), 'tutors', text('email', 'Email'));
    const same = judge('And I need a table for my tutors with their name, email and the subjects they teach', before, before);
    expect(same.lines.map((l) => l.done)).toEqual([false]);
    const after = structuredClone(before);
    must(after.tables.find((t) => t.id === 'tutors')).fields = [text('name', 'Name'), text('subjects', 'Subjects')];
    expect(judge('And I need a table for my tutors with their name, email and the subjects they teach', before, after).lines.map((l) => l.done)).toEqual([false]);
  });
});

describe('askOutcome per-unit word (T-9)', () => {
  it('"a rate per hour" asks for Rate only: the unasked Hours field stays under It also changed', () => {
    const before = tutorSpec();
    const sessions = must(before.tables.find((t) => t.id === 'sessions'));
    sessions.fields = sessions.fields.filter((f) => f.id !== 'hours');
    const withHours = withField(before, 'students', text('hours', 'Hours'));
    const after = withField(withField(withField(withHours, 'students', text('rate', 'Rate')), 'students', text('tutors', 'Tutors')), 'tutors', text('email', 'Email'));
    const outcome = judge('Please add a rate per hour to each student, so I know what to charge them.', before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([true]);
    expect(also(before, after, outcome)).toEqual(['Added a Hours field to Students', 'Added a Tutors field to Students', 'Added an Email field to Tutors']);
  });
});

describe('askOutcome rename with the table id kept (T-10)', () => {
  const ASK = 'We say lessons, not sessions. Please rename Sessions to Lessons everywhere in the app.';
  const renamed = (before: AppSpec): AppSpec => {
    const next = structuredClone(before);
    must(next.tables.find((t) => t.id === 'sessions')).label = 'Lessons';
    return next;
  };

  it('is Done on both lines when the base table keeps its id and its label is Lessons', () => {
    const before = tutorSpec();
    const after = renamed(before);
    const outcome = judge(ASK, before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([true, true]);
    expect(outcome.alsoChanged).toEqual([]);
  });

  it('counts a page title that carried the new name, and is Not done when nothing carries it', () => {
    const before = tutorSpec();
    const titled = structuredClone(before);
    must(titled.pages[0]).title = 'Lessons';
    must(titled.tables.find((t) => t.id === 'sessions')).label = 'Lessons';
    titled.pages = JSON.parse(JSON.stringify(titled.pages).replace(/\bSessions?\b/g, 'Lessons')) as AppSpec['pages'];
    titled.nav = JSON.parse(JSON.stringify(titled.nav).replace(/\bSessions?\b/g, 'Lessons')) as AppSpec['nav'];
    expect(judge(ASK, before, titled).lines[1].done).toBe(true);
    const other = renamed(before);
    must(other.tables.find((t) => t.id === 'sessions')).label = 'Classes';
    expect(judge(ASK, before, other).lines[1].done).toBe(false);
    expect(judge(ASK, before, before).lines[1].done).toBe(false);
  });
});

describe('askOutcome T-7 alternative needs the named table (RV26-13)', () => {
  it('is Not done for a new table ask when the only change is a field on a different table', () => {
    const before = tutorSpec();
    before.tables.push(tbl('payments', 'Payments', [text('amount', 'Amount')]));
    const after = withField(before, 'payments', text('date', 'Date'));
    const outcome = judge('Add a date to Payments. And I need a table for invoices with a date and amount', before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([true, false]);
  });
});

describe('askOutcome rename everywhere (L-4)', () => {
  const ASK = 'Please call Repairs "Maintenance" instead, everywhere it shows up in the app';
  const landlord = (): AppSpec => {
    const spec = crewRosterSpec();
    spec.tables = [tbl('repairs', 'Repairs', [text('what', 'What is wrong')])];
    const body: LayoutLayer[] = [
      { id: 'h_repairs', type: 'Heading', props: {}, children: 'Repairs' },
      { id: 'b_open', type: 'Button', props: {}, children: 'View Open Repairs' },
      { id: 'b_add', type: 'Button', props: { label: 'Add Repair' }, children: [] },
    ];
    spec.pages = [{ id: 'repairs', title: 'Repairs', route: '/repairs', sources: [], layout: { id: 'root_repairs', type: 'Page', props: {}, children: body } }];
    spec.nav = [{ pageId: 'repairs', label: 'Repairs' }] as AppSpec['nav'];
    return spec;
  };
  const everywhere = (spec: AppSpec): AppSpec => {
    const next = structuredClone(spec);
    next.tables[0].label = 'Maintenance';
    next.pages[0].title = 'Maintenance';
    next.nav[0].label = 'Maintenance';
    const [h, open, add] = next.pages[0].layout.children as LayoutLayer[];
    h.children = 'Maintenance';
    open.children = 'View Open Maintenance';
    add.props = { label: 'Add Maintenance' };
    return next;
  };

  it('is Not done, naming what still says Repairs, when only the table label changed (proposal-l3c)', () => {
    const before = landlord();
    const after = structuredClone(before);
    after.tables[0].label = 'Maintenance';
    const outcome = judge(ASK, before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([false]);
    expect(outcome.lines[0].text).toBe(`Not done: ${ASK} (still says Repairs in the menu, a page title, a button, a heading)`);
    expect(outcome.lines[0].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
  });

  it('is Not done when the title, menu and heading changed but the buttons still say Repairs', () => {
    const before = landlord();
    const after = everywhere(before);
    const [, open, add] = after.pages[0].layout.children as LayoutLayer[];
    open.children = 'View Open Repairs';
    add.props = { label: 'Add Repair' };
    const outcome = judge(ASK, before, after);
    expect(outcome.lines.map((l) => l.done)).toEqual([false]);
    expect(outcome.lines[0].text).toContain('(still says Repairs in a button)');
  });

  it('is Done when every place carries the new name, and for "Rename X to Y"', () => {
    const before = landlord();
    const after = everywhere(before);
    expect(judge(ASK, before, after).lines.map((l) => l.done)).toEqual([true]);
    expect(judge('Rename Repairs to Maintenance.', before, after).lines.map((l) => l.done)).toEqual([true]);
  });

  it('checks only the thing named when a rename names only a table or only a page (RV26-23)', () => {
    const before = landlord();
    const table = structuredClone(before);
    table.tables[0].label = 'Maintenance';
    expect(judge('Rename the Repairs table to Maintenance.', before, table).lines.map((l) => l.done)).toEqual([true]);
    expect(judge('Rename Repairs to Maintenance everywhere in the app.', before, table).lines.map((l) => l.done)).toEqual([false]);
    // "everywhere" with only the table named still asks for every place (the word boundaries of the qualifier test).
    expect(judge('Rename the Repairs table to Maintenance everywhere.', before, table).lines.map((l) => l.done)).toEqual([false]);
    const page = structuredClone(before);
    page.pages[0].title = 'Maintenance';
    expect(judge('Rename the Repairs page to Maintenance.', before, page).lines.map((l) => l.done)).toEqual([false]);
    page.nav[0].label = 'Maintenance';
    expect(judge('Rename the Repairs page to Maintenance.', before, page).lines.map((l) => l.done)).toEqual([true]);
  });
});

describe('askOutcome exits point to the right place (L-3)', () => {
  const landlordTables = (): AppSpec => {
    const spec = crewRosterSpec();
    spec.tables = [tbl('units', 'Units', [text('unit', 'Unit')]), tbl('repairs', 'Repairs', [text('what', 'What')]), tbl('tenants', 'Tenants', [text('name', 'Name')])];
    return spec;
  };

  it('three number boxes on Home is a Design part, not Data', () => {
    const before = landlordTables();
    const ask =
      'Turn my home page into a dashboard where I can move things around freely. Along the top I want three number boxes: how much rent came in this month, how many units are empty, and how many repairs are still open.';
    const lines = judge(ask, before, before).lines.filter((l) => !l.done && l.clause.includes('number boxes'));
    expect(lines).toHaveLength(1);
    expect(lines[0].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
  });

  it('a list of the repair people with their fields is a new table, so Data', () => {
    const before = landlordTables();
    const ask = "And I'd like a list of the repair people I call: their name, what kind of work they do, and their phone number.";
    const lines = judge(ask, before, before).lines;
    expect(lines.map((l) => l.done)).toEqual([false]);
    expect(lines[0].exit).toEqual({ kind: 'data', label: EXIT_DATA });
  });
});

describe('askOutcome tile and chart clauses need the part (T-V-1)', () => {
  const TILES = 'Across the top, three tiles: sessions this month, hours taught, and invoices not paid yet';
  const CHART = 'Underneath, a chart of hours by tutor';
  const onHome = (spec: AppSpec, ...kids: LayoutLayer[]): AppSpec => {
    const next = structuredClone(spec);
    const home = must(next.pages[0]);
    home.layout = { ...home.layout, children: [...(Array.isArray(home.layout.children) ? home.layout.children : []), ...kids] };
    return next;
  };
  const stat = (n: number): LayoutLayer => ({ id: `statcard_${n}`, type: 'StatCard', props: { table: 'sessions', label: `Tile ${n}` }, children: [] });

  it('is Not done, with the Design exit, when only a Section titled Top Tiles holds a form on another page', () => {
    const before = tutorSpec();
    const after = structuredClone(before);
    const form: LayoutLayer = { id: 'recordform_1', type: 'RecordForm', props: {}, children: [] };
    const section: LayoutLayer = { id: 'section_1', type: 'Section', props: { title: 'Top Tiles' }, children: [form] };
    const other = withPersonPage(after);
    must(other.pages.find((p) => p.id === 'person')).layout.children = [section];
    const out = judge(TILES, before, other);
    expect(out.lines.map((l) => l.done)).toEqual([false]);
    expect(out.lines[0].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
  });

  it('is Not done for a chart when none was added, and points to Design', () => {
    const before = tutorSpec();
    const out = judge(CHART, before, before);
    expect(out.lines.map((l) => l.done)).toEqual([false]);
    expect(out.lines[0].exit).toEqual({ kind: 'design', label: EXIT_DESIGN });
  });

  it('is Done for three StatCards on home, Not done for two', () => {
    const before = tutorSpec();
    expect(judge(TILES, before, onHome(before, stat(1), stat(2), stat(3))).lines.map((l) => l.done)).toEqual([true]);
    expect(judge(TILES, before, onHome(before, stat(1), stat(2))).lines.map((l) => l.done)).toEqual([false]);
  });

  it('is Done for a Chart on home', () => {
    const before = tutorSpec();
    const chart: LayoutLayer = { id: 'chart_1', type: 'Chart', props: { table: 'tutors' }, children: [] };
    expect(judge(CHART, before, onHome(before, chart)).lines.map((l) => l.done)).toEqual([true]);
  });
});

describe('askOutcome tile clauses name their page and leave data asks alone (RV26-43 to 45)', () => {
  const stat = (n: number): LayoutLayer => ({ id: `statcard_${n}`, type: 'StatCard', props: { table: 'sessions', label: `Tile ${n}` }, children: [] });
  const chart = (n: number): LayoutLayer => ({ id: `chart_${n}`, type: 'Chart', props: { table: 'tutors' }, children: [] });
  const withPage = (spec: AppSpec, id: string, title: string, route: string, kids: LayoutLayer[]): AppSpec => {
    const next = structuredClone(spec);
    next.pages.push({ id, title, route, sources: [], layout: { id: `root_${id}`, type: 'Page', props: {}, children: kids } });
    return next;
  };
  const done = (ask: string, before: AppSpec, after: AppSpec): boolean[] => judge(ask, before, after).lines.map((l) => l.done);

  it('judges a named page, not home, and a page titled Dashboard at /dashboard', () => {
    const before = withPage(tutorSpec(), 'overview', 'Overview', '/overview', []);
    const after = structuredClone(before);
    must(after.pages.find((p) => p.id === 'overview')).layout.children = [stat(1), stat(2), stat(3)];
    expect(done('On the page Overview: make it a dashboard with three tiles', before, after)).toEqual([true]);
    expect(done('Add three tiles to the Overview page', before, after)).toEqual([true]);
    const dash = withPage(tutorSpec(), 'dash', 'Dashboard', '/dashboard', []);
    const dashAfter = structuredClone(dash);
    must(dashAfter.pages.find((p) => p.id === 'dash')).layout.children = [stat(1), stat(2), stat(3)];
    expect(done('Add a dashboard with three tiles', dash, dashAfter)).toEqual([true]);
  });

  it('counts tiles inside a Grid and a Section, and a graph as a chart', () => {
    const before = withPage(tutorSpec(), 'overview', 'Overview', '/overview', []);
    const after = structuredClone(before);
    const grid: LayoutLayer = { id: 'grid_1', type: 'Grid', props: {}, children: [stat(1), stat(2)] };
    const section: LayoutLayer = { id: 'section_1', type: 'Section', props: { title: 'Numbers' }, children: [stat(3)] };
    must(after.pages.find((p) => p.id === 'overview')).layout.children = [grid, section];
    expect(done('Add three tiles to the Overview page', before, after)).toEqual([true]);
    const graphed = structuredClone(before);
    must(graphed.pages.find((p) => p.id === 'overview')).layout.children = [chart(1)];
    expect(done('Add a graph to the Overview page', before, graphed)).toEqual([true]);
  });

  it('does not gate the data asks that use a tile, box or chart word', () => {
    const before = tutorSpec();
    const withTable = structuredClone(before);
    withTable.tables.push(tbl('tiles', 'Tiles', [text('name', 'Name')]));
    expect(done('Add a table for the tiles we sell', before, withTable)).toEqual([true]);
    const boxes = withField(before, 'sessions', text('boxes', 'Boxes'));
    expect(done('Add a field for the number of boxes', before, boxes)).toEqual([true]);
    const accounts = structuredClone(before);
    accounts.tables.push(tbl('accounts', 'Chart of Accounts', [text('name', 'Name')]));
    expect(done('Add a chart of accounts table', before, accounts)).toEqual([true]);
  });

  it('accepts a changed StatCard for a verbless clause about existing tiles', () => {
    const base = tutorSpec();
    const before = structuredClone(base);
    must(before.pages[0]).layout.children = [stat(1)];
    const after = structuredClone(before);
    const card = (after.pages[0]?.layout.children as LayoutLayer[])[0];
    must(card).props = { table: 'sessions', label: 'Hours taught' };
    expect(done('The tiles, hours taught first', before, after)).toEqual([true]);
  });
});
