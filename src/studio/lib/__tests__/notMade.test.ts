import { describe, expect, it } from 'vitest';
import type { AppSpec, LayoutLayer } from '@local-app-studio/runtime/spec/schema';
import { NOT_MADE_PREFIX, notMade } from '../notMade';
import { crewRosterSpec, loansSpec } from './promptBulletsFixtures';

const FREELANCER =
  'A job tracking app for Green Acre Landscaping. Clients (name, phone, address). Jobs with a date, a status (Scheduled, In progress, Done) and the crew assigned. ' +
  'A chart of jobs by status on the home page. A menu button to add a job.';
const FOUNDER =
  'A membership app for my climbing gym. Members, plans, payments with an amount and a date, a page per member, one number with the total paid, and a chart of payments by month.';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture is missing a part');
  return value;
}

const addToHome = (spec: AppSpec, ...layers: LayoutLayer[]): AppSpec => {
  const next = structuredClone(spec);
  const home = must(next.pages[0]);
  home.layout.children = [...(home.layout.children as LayoutLayer[]), ...layers];
  return next;
};

describe('notMade', () => {
  const TILES = 'A sales dashboard: tiles for orders and revenue, a chart of orders by status and the list of orders.';

  it('does not report "tiles" when the design has Number tiles, and still does when it has none', () => {
    const withTile = addToHome(crewRosterSpec(), {
      id: 'statcard_1',
      type: 'StatCard',
      props: {},
      children: [],
    } as unknown as LayoutLayer);
    expect(notMade(TILES, withTile).items).not.toContain('Tiles');
    expect(notMade(TILES, crewRosterSpec()).items).toContain('Tiles');
  });

  it('lists what the freelancer asked for that the crew roster lacks, and nothing false like Status or Address', () => {
    const result = notMade(FREELANCER, crewRosterSpec());
    expect(result.items).toEqual(['Clients', 'Jobs', 'a chart', 'a menu button']);
    expect(result.line).toBe('Not made: Clients, Jobs, a chart, a menu button');
    expect(NOT_MADE_PREFIX).toBe('Not made: ');
    for (const word of ['Status', 'Address', 'Phone', 'Progress', 'Done', 'Scheduled']) expect(result.items).not.toContain(word);
  });

  it('lists what the founder asked for that the loans design lacks', () => {
    const result = notMade(FOUNDER, loansSpec());
    expect(result.items).toEqual(['Members', 'Plans', 'Payments', 'a chart', 'a number']);
    expect(result.line).toBe('Not made: Members, Plans, Payments, a chart, a number');
  });

  it('says nothing when the design has every table, field and part the prompt names', () => {
    const covered =
      'Crews (name, size). A chart of crews by status on the home page. A search box. A menu button to add a crew. One number with the total crews. A form to add a crew.';
    let spec = crewRosterSpec();
    spec = addToHome(
      spec,
      { id: 'chart1', type: 'Chart', props: { source: 'open_crews' }, children: [] },
      { id: 'stat1', type: 'StatCard', props: { source: 'open_crews' }, children: [] },
      { id: 'form1', type: 'RecordForm', props: { table: 'crews' }, children: [] },
      { id: 'search1', type: 'SearchBox', props: { source: 'open_crews' }, children: [] },
    );
    spec.menu = { position: 'top', style: 'icons-and-labels', end: [{ id: 'mb1', type: 'Button', props: {}, children: 'Add crew' }] } as AppSpec['menu'];
    expect(notMade(covered, spec)).toEqual({ items: [], line: null });
  });

  it('names a field the prompt gives a table the design has but is missing', () => {
    const result = notMade('Crews (name, size, phone).', crewRosterSpec());
    expect(result.items).toEqual(['a phone field in Crews']);
  });

  it('asks for a page per record only when the table exists and no page opens from a list for it', () => {
    expect(notMade('Crews. A page for each crew.', crewRosterSpec()).items).toEqual(['a page for each crew']);
    expect(notMade('A page per member.', loansSpec()).items).toEqual([]);
    expect(notMade('Loans. A page per loan.', loansSpec()).items).toEqual([]);
  });

  it('does not take everyday plural words, verbs, or words after "of" or "for my" for things kept', () => {
    const words = 'This app has a status, an address and progress. It shows jobs of my crews for my clients. It adds notes and keeps records. Useless things.';
    // Only the two plain things the sentences keep: jobs and notes. Crews exists; clients follows "my".
    expect(notMade(words, crewRosterSpec()).items).toEqual(['Jobs', 'Notes']);
  });

  it('shows at most eight items and counts the rest', () => {
    const many = 'Alphas, betas, gammas, deltas, epsilons, zetas, etas, thetas, iotas, kappas.';
    const result = notMade(many, crewRosterSpec());
    expect(result.items.length).toBeGreaterThan(8);
    expect(result.line?.endsWith(` and ${result.items.length - 8} more`)).toBe(true);
  });

  it('counts a field label or a page title as making a plural word, not only a table label', () => {
    const spec = crewRosterSpec();
    must(spec.tables.find((t) => t.id === 'crews')).fields.push({ id: 'expenses', label: 'Expenses', type: 'text', required: false });
    must(spec.pages[0]).title = 'Reports';
    expect(notMade('Crews, expenses, reports and jobs.', spec).items).toEqual(['Jobs']);
  });

  it('does not take "the number of jobs" or "the total amount" for a Number tile, and still takes "one number"', () => {
    const spec = crewRosterSpec();
    expect(notMade('Show the number of crews on the home page.', spec).items).toEqual([]);
    expect(notMade('Show the total amount for each crew.', spec).items).toEqual([]);
    expect(notMade('Show one number with the total crews.', spec).items).toEqual(['a number']);
    expect(notMade('Show a total tile.', spec).items).toEqual(['a total']);
  });

  it('is empty for an empty prompt', () => {
    expect(notMade('   ', crewRosterSpec())).toEqual({ items: [], line: null });
  });
});

describe('notMade, a table no page shows (B-3)', () => {
  it('lists "a page for Crews" when the table exists and no page has a source of it', () => {
    const bare = crewRosterSpec();
    bare.pages = bare.pages.map((p) => ({ ...p, sources: [] }));
    const result = notMade('Crews (name, size). A page for the crews.', bare);
    expect(result.items).toContain('a page for Crews');
    expect(notMade('Crews (name, size).', crewRosterSpec()).items).not.toContain('a page for Crews');
  });

  it('skips "a page for X" for a lookup-only table, and for a table whose page the ask removed (RV26-10)', () => {
    const bare = crewRosterSpec();
    bare.pages = bare.pages.map((p) => ({ ...p, sources: [] }));
    const lookup = must(bare.tables.find((t) => bare.tables.some((o) => o.id !== t.id && o.fields.some((f) => f.type === 'reference' && f.table === t.id))));
    expect(notMade(`${lookup.label} (name).`, bare).items).not.toContain(`a page for ${lookup.label}`);
    const other = must(bare.tables.find((t) => t.id !== lookup.id));
    expect(notMade(`${other.label} (name).`, bare).items).toContain(`a page for ${other.label}`);
    expect(notMade(`Remove the ${other.label} page. ${other.label} (name).`, bare).items).not.toContain(`a page for ${other.label}`);
  });
});

describe('notMade round 2 (N6)', () => {
  it('reports nothing for a part the prompt says it does not want', () => {
    const bare = crewRosterSpec();
    bare.nav = [];
    delete (bare as { menu?: unknown }).menu;
    for (const prompt of [
      "A job tracker. I don't need a chart.",
      'A job tracker with no menu.',
      "A job tracker. Don't add a search box, no chart, and no menu.",
      'A job tracker without a chart.',
    ]) {
      expect(notMade(prompt, bare).items, prompt).toEqual([]);
    }
  });

  it('still reports a part asked for next to one it refused', () => {
    expect(notMade("A job tracker. No menu, but a chart of jobs by status.", crewRosterSpec()).items).toContain('a chart');
  });

  it('does not report a verb in a list as a thing ("manages clients")', () => {
    const result = notMade('An app that tracks jobs, manages clients and sends invoices.', crewRosterSpec());
    expect(result.items).not.toContain('Manages');
    expect(result.items).not.toContain('Sends');
  });

  it('counts "Statuses" as the Status field the design has', () => {
    const result = notMade('Jobs, statuses and crews.', crewRosterSpec());
    expect(result.items).not.toContain('Statuses');
  });
});

describe('notMade on the landlord prompt (L-8)', () => {
  const LANDLORD =
    "I own six rental apartments in two small buildings and I'm tired of keeping it all in a notebook. For each unit I want the building it's in, the unit number, how many bedrooms and the monthly rent. For my tenants I need their name, phone number, which unit they live in and when their lease starts and ends. Every month I want to write down the rent payments: which tenant paid, for what month, how much and the date it came in. And when something breaks I want to log the repair: which unit, what's wrong, the date they told me, whether it's open or fixed, and what it cost. Mostly I want to see quickly who hasn't paid this month and which repairs are still open.";
  const landlordSpec = (where: boolean): AppSpec => {
    const spec = crewRosterSpec();
    const mk = (id: string, label: string) => ({ id, label, titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: false }] });
    const lease = [{ id: 'ls', label: 'Lease Start', type: 'text', required: false }, { id: 'le', label: 'Lease End', type: 'text', required: false }];
    spec.tables = ['Units', 'Buildings', 'Tenants', 'Rent Payments', 'Repairs'].map((l) => mk(l.toLowerCase().replace(' ', '_'), l)) as unknown as AppSpec['tables'];
    must(spec.tables.find((t) => t.id === 'tenants')).fields.push(...(lease as unknown as AppSpec['tables'][number]['fields']));
    spec.pages = spec.tables.map((t) => ({
      id: t.id,
      title: t.label,
      route: `/${t.id}`,
      sources: [{ id: 'list', table: t.id, mode: 'list', where: where && (t.id === 'repairs' || t.id === 'rent_payments') ? [{ field: 'name', op: 'eq', value: 'open' }] : [], orderBy: [], limit: 50 }],
      layout: { id: `root_${t.id}`, type: 'Page', props: {}, children: [] },
    })) as unknown as AppSpec['pages'];
    return spec;
  };

  it('does not list Apartments (the person business) and lists the two filtered views no page has', () => {
    const result = notMade(LANDLORD, landlordSpec(false));
    expect(result.items).not.toContain('Apartments');
    expect(result.items).toEqual(["a list of only people who haven't paid", 'a list of only repairs that are still open']);
    expect(result.line).toBe(`${NOT_MADE_PREFIX}a list of only people who haven't paid, a list of only repairs that are still open`);
  });

  it('keeps a plural after "I have" when no count leads it, and drops a filtered view a page source has', () => {
    expect(notMade('I have clients. Clients (name).', loansSpec()).items).toContain('Clients');
    const items = notMade(LANDLORD, landlordSpec(true)).items;
    expect(items).toEqual([]);
    const noPayments = landlordSpec(true);
    for (const p of noPayments.pages) if (p.id === 'rent_payments') p.sources[0].where = [];
    expect(notMade(LANDLORD, noPayments).items).toEqual(["a list of only people who haven't paid"]);
  });

  it('does not read a field word after "a" or "an" as a filtered view, and binds the who-not view to payments only for paid or pay (RV26-25)', () => {
    expect(notMade('Tenants (name). Rent Payments with a date and an unpaid checkbox.', landlordSpec(false)).items).not.toContain('a list of only unpaid');
    expect(notMade('Show me the unpaid ones.', landlordSpec(false)).items).toEqual(['a list of only unpaid']);
    const repairsOnly = landlordSpec(false);
    for (const p of repairsOnly.pages) if (p.id === 'repairs') p.sources[0].where = [{ field: 'name', op: 'eq', value: 'open' }] as never;
    expect(notMade("Tenants (name). Who hasn't called me back.", repairsOnly).items).toEqual([]);
    expect(notMade("Tenants (name). Who hasn't paid.", repairsOnly).items).toEqual(["a list of only people who haven't paid"]);
  });
});
