import { describe, expect, it } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { FLOW_WORDS, GRID_WORDS, MOVE_WORDS, askOutcome, namedByMove, namesPage, placeAsk, splitClauses } from '../askOutcome';
import type { AskOutcome } from '../askOutcome';
import { changeBullets } from '../promptBullets';
import { diffSpecs } from '../specDiff';
import { block, gridSpec, three, tile } from './placeFixtures';

const judge = (ask: string, before: AppSpec, after: AppSpec): AskOutcome => askOutcome({ ask, changes: diffSpecs(before, after), before, after });
const also = (after: AppSpec, outcome: AskOutcome): string[] => changeBullets(after, outcome.alsoChanged).shown;

describe('placeAsk words', () => {
  it('every flow word and phrase is a flow clause', () => {
    for (const word of FLOW_WORDS) {
      const a = placeAsk(`Please ${word} them`);
      expect(a.toFlow, word).toBe(true);
      expect(a.toFree, word).toBe(false);
      expect(a.moves, word).toEqual([]);
    }
  });

  it('every grid word is a free clause', () => {
    for (const word of GRID_WORDS) {
      const a = placeAsk(`Use the ${word} for these`);
      expect(a.toFree, word).toBe(true);
      expect(a.toFlow, word).toBe(false);
    }
  });

  it('every move word is a move clause that names the part it speaks of', () => {
    for (const word of MOVE_WORDS) {
      const a = placeAsk(`Please move the chart ${word}`);
      expect(a.moves, word).toHaveLength(1);
      expect(a.moves[0].kind).toBe('move');
      expect([...a.moves[0].parts]).toEqual(['chart']);
      expect(a.toFlow || a.toFree, word).toBe(false);
    }
  });

  it('ordinary asks with place words are not place clauses', () => {
    const plain = [
      'Add a cash flow field to Orders',
      'Rename the Stack table',
      'Show the tech stack table',
      'Remove the chart at the bottom',
      'Show the top customers',
      'Show what is left to do',
      'Hide the field on the right',
      'Delete the table under Jobs',
      'Add a chart to the Dashboard page',
      'Show the cash flow chart',
      'Rename the Dashboard page',
    ];
    for (const ask of plain) {
      const a = placeAsk(ask);
      expect([a.toFlow, a.toFree, a.moves.length], ask).toEqual([false, false, 0]);
    }
    expect(placeAsk('Rename the Stack table').layout).toBe(false);
  });

  it('the place asks people mean still read as place asks', () => {
    for (const ask of ['Stack these instead.', 'Stack them', 'Please stack the tiles', 'Make it flow', 'Let them flow', 'I want it to flow', 'No grid', 'Use one column']) {
      expect(placeAsk(ask).toFlow, ask).toBe(true);
    }
    for (const ask of ['Move the chart to the bottom.', 'Put the chart at the top', 'Make the chart wider', 'Make the tiles smaller']) {
      const a = placeAsk(ask);
      expect([a.toFlow, a.toFree, a.moves.length], ask).toEqual([false, false, 1]);
    }
    for (const ask of ['Place the parts freely', 'Lay it out as a dashboard', 'Arrange them like a dashboard', 'Use a grid']) {
      expect(placeAsk(ask).toFree, ask).toBe(true);
    }
    expect(placeAsk("don't stack").toFlow).toBe(false);
    expect(placeAsk("don't stack").layout).toBe(false);
    expect(placeAsk('Add a tile').moves).toEqual([]);
  });

  it('"one column wide" is a resize, not a flow word', () => {
    const a = placeAsk('Make the chart one column wide');
    expect(a.toFlow).toBe(false);
    expect(placeAsk('Put them in one column').toFlow).toBe(true);
    expect(placeAsk('Use a single column').toFlow).toBe(true);
  });

  it('flow beats free beats move', () => {
    const flow = placeAsk('Stack these on the grid');
    expect([flow.toFlow, flow.toFree, flow.moves.length]).toEqual([true, false, 0]);
    const free = placeAsk('Move the chart to the top of the grid');
    expect([free.toFlow, free.toFree, free.moves.length]).toEqual([false, true, 0]);
    const move = placeAsk('Move the chart to the top');
    expect([move.toFlow, move.toFree, move.moves.length]).toEqual([false, false, 1]);
  });

  it('a negated clause is not a place ask, and "no grid" is a flow ask', () => {
    for (const ask of ["Don't stack them", 'Do not use a grid', 'Never move the chart', 'Please do not make it a dashboard']) {
      const a = placeAsk(ask);
      expect([a.toFlow, a.toFree, a.moves.length, a.layout], ask).toEqual([false, false, 0, false]);
    }
    expect(placeAsk('No grid please').toFlow).toBe(true);
    expect(placeAsk('Use the page without a grid').toFlow).toBe(true);
  });

  it('an add clause is not a move, and an add that names a part asks for a layout', () => {
    expect(placeAsk('Add a chart to the top').moves).toEqual([]);
    expect(placeAsk('Add a new tile on the right').moves).toEqual([]);
    expect(placeAsk('Add a tile').layout).toBe(true);
    expect(placeAsk('Add a chart and then rename the table').layout).toBe(true);
    expect(placeAsk('Add a notes field to Jobs').layout).toBe(false);
    expect(placeAsk("Don't add a chart").layout).toBe(false);
    expect(placeAsk('Rename the Items page').layout).toBe(false);
  });

  it('a place clause asks for a layout, and the stems cover the whole ask', () => {
    const a = placeAsk('Move the chart to the top. Rename the Orders page');
    expect(a.layout).toBe(true);
    expect(a.stems.has('order')).toBe(true);
    expect(a.stems.has('chart')).toBe(true);
  });

  it('reads each clause on its own', () => {
    const a = placeAsk('Move the chart to the top row and put the three stat tiles under it');
    expect(a.moves.map((m) => [...m.parts])).toEqual([['chart'], ['number']]);
  });
});

describe('namedByMove and namesPage', () => {
  it('a move clause names a layer by its part word or its label', () => {
    const a = placeAsk('Move the chart to the top. Make Revenue wider');
    expect(namedByMove(a, { type: 'Chart' })).toBe(true);
    expect(namedByMove(a, { type: 'StatCard', props: { label: 'Revenue' } })).toBe(true);
    expect(namedByMove(a, { type: 'Text', children: 'Revenue' })).toBe(true);
    expect(namedByMove(a, { type: 'Text', name: 'Revenue' })).toBe(true);
    expect(namedByMove(a, { type: 'StatCard', props: { label: 'Orders' } })).toBe(false);
    expect(namedByMove(a, { type: 'DataTable' })).toBe(false);
  });

  it('a move clause that names no part names no layer', () => {
    const a = placeAsk('Move it to the top');
    expect(namedByMove(a, { type: 'Chart' })).toBe(false);
    expect(namedByMove(placeAsk('Add a tile'), { type: 'StatCard' })).toBe(false);
  });

  it('a page is named by the words of its title', () => {
    const a = placeAsk('Lay out the Home page on a grid');
    expect(namesPage(a, 'Home')).toBe(true);
    expect(namesPage(a, 'Orders')).toBe(false);
    expect(namesPage(a, '')).toBe(false);
  });
});

describe('askOutcome on place clauses', () => {
  const free = (): AppSpec => gridSpec(three());
  const flow = (): AppSpec => gridSpec(three().map((l) => ({ ...l, grid: undefined })), { free: false });

  it('a flow clause is Done by a grid turned off, and the layout line is explained', () => {
    const out = judge('Stack these instead', free(), flow());
    expect(out.lines.map((l) => [l.text, l.done])).toEqual([['Done: Stack these instead', true]]);
    expect(out.alsoChanged).toEqual([]);
  });

  it('a flow clause is Not done when the grid stays free, and the layout change stays under It also changed', () => {
    const after = gridSpec([...three(), tile('statcard_3', 'StatCard', block(9, 4, 1))]);
    const out = judge('Stack these instead', free(), after);
    expect(out.lines[0].done).toBe(false);
    expect(out.missedAll).toBe(true);
    expect(also(after, out)).toEqual(['Changed the layout of Home (7 parts)']);
  });

  it('a free clause is Done by a grid turned on or by a part placed', () => {
    expect(judge('Put these on a grid', flow(), free()).lines[0].done).toBe(true);
    const after = gridSpec([...three(), tile('statcard_3', 'StatCard', block(9, 4, 1))]);
    expect(judge('Lay these out as a dashboard', free(), after).lines[0].done).toBe(true);
    expect(judge('Lay these out as a dashboard', free(), free()).lines[0].done).toBe(false);
  });

  it('a move clause is Done by a move of the part it names, not by a move of another', () => {
    const chartUp = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 4)), tile('statcard_2', 'StatCard', block(5, 4, 4)), tile('chart_1', 'Chart', block(1, 8, 1, 3))]);
    const done = judge('Move the chart to the top row', free(), chartUp);
    expect(done.lines[0].done).toBe(true);
    expect(done.alsoChanged).toEqual([]);
    const tileOnly = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 5)), ...three().slice(1)]);
    expect(judge('Move the chart to the top row', free(), tileOnly).lines[0].done).toBe(false);
    expect(judge('Move the tiles to the bottom', free(), tileOnly).lines[0].done).toBe(true);
  });

  it('a move clause that names no part is Done by any move or resize', () => {
    const wide = gridSpec([...three().slice(0, 2), tile('chart_1', 'Chart', block(1, 12, 2, 3))]);
    expect(judge('Make it wider', free(), wide).lines[0].done).toBe(true);
  });

  it('a negated place clause is never Done: Not done when it happened anyway, silent when it did not', () => {
    expect(judge("Don't stack them", free(), flow()).lines.map((l) => l.text)).toEqual(["Not done: Don't stack them"]);
    expect(judge("Don't stack them", free(), free()).lines).toEqual([]);
  });

  it('an add clause keeps the part count rule and never lists the place line under It also changed', () => {
    const after = gridSpec([...three(), tile('statcard_3', 'StatCard', block(9, 4, 1))]);
    const out = judge('Add a tile', free(), after);
    expect(out.lines.map((l) => [l.text, l.done])).toEqual([['Done: Add a tile', true]]);
    expect(out.alsoChanged.filter((c) => c.path.endsWith('.place'))).toEqual([]);
  });

  it('alsoChanged holds no place change', () => {
    const after = gridSpec([tile('statcard_1', 'StatCard', block(1, 4, 3)), ...three().slice(1)]);
    const out = judge('Rename the app to Orders', free(), after);
    expect(out.alsoChanged.some((c) => c.path.endsWith('.grid'))).toBe(false);
    expect(out.alsoChanged.length).toBeGreaterThan(0);
  });
});

describe('askOutcome on asks a place word does not change', () => {
  const free = (): AppSpec => gridSpec(three());
  const withField = (spec: AppSpec): AppSpec => {
    const next = structuredClone(spec);
    next.tables[0].fields.push({ id: 'cash_flow', label: 'Cash flow', type: 'real', required: false });
    return next;
  };

  it('"Add a cash flow field to Crews" is judged as a field add, Done, and asks for no layout', () => {
    const out = judge('Add a cash flow field to Crews', free(), withField(free()));
    expect(out.lines.map((l) => l.done)).toEqual([true]);
    expect(placeAsk('Add a cash flow field to Crews').layout).toBe(false);
  });

  it('"Rename the Crews table" is judged as a rename, not a flow ask', () => {
    const after = free();
    after.tables[0].label = 'Stack';
    after.pages = JSON.parse(JSON.stringify(after.pages).replace(/\bCrews?\b/g, 'Stack')) as AppSpec['pages'];
    after.nav = JSON.parse(JSON.stringify(after.nav).replace(/\bCrews?\b/g, 'Stack')) as AppSpec['nav'];
    const out = judge('Rename the Crews table to Stack', free(), after);
    expect(out.lines.map((l) => l.done)).toEqual([true]);
  });

  it('a clause with an ordinary verb a place word misled can still be Done by its ordinary change', () => {
    const after = withField(free());
    expect(judge('Add the cash flow field on the right to Crews', free(), after).lines.map((l) => l.done)).toEqual([true]);
  });

  it('a flow clause with no verb stays judged by the place changes only', () => {
    expect(judge('Stack these instead', free(), withField(free())).lines.map((l) => l.done)).toEqual([false]);
  });
});

describe('askOutcome on menu and field moves, and joined clauses', () => {
  const withOrders = (inMenu: boolean): AppSpec => {
    const spec = structuredClone(gridSpec(three()));
    const orders = structuredClone(spec.pages[0]);
    orders.id = 'orders';
    orders.title = 'Orders';
    orders.route = '/orders';
    spec.pages.push(orders);
    if (inMenu) spec.nav.push({ pageId: 'orders', label: 'Orders', icon: 'home' });
    return spec;
  };

  it('"Move Orders to the menu" is Done by the nav change and asks for no relayout', () => {
    const ask = 'Move Orders to the menu';
    expect(judge(ask, withOrders(false), withOrders(true)).lines.map((l) => l.done)).toEqual([true]);
    expect(judge(ask, withOrders(false), withOrders(false)).lines.map((l) => l.done)).toEqual([false]);
    expect(placeAsk(ask).layout).toBe(false);
    expect(placeAsk(ask).moves).toEqual([]);
  });

  it('menu, table, field, column and page moves with no part word are not place asks', () => {
    for (const ask of ['Move the Orders page to the top of the menu', 'Move the search box to the menu', 'Move the Notes field to the top', 'Put the Stack table on the menu', 'Move the Notes column to the left']) {
      const a = placeAsk(ask);
      expect([a.toFlow, a.toFree, a.moves.length, a.layout], ask).toEqual([false, false, 0, false]);
    }
  });

  it('a part moved on a page still reads as a move', () => {
    for (const ask of ['Move the chart to the bottom.', 'Put the chart at the top', 'Make the chart wider', 'Make the list taller', 'Move the chart to the top of the page']) {
      const a = placeAsk(ask);
      expect([a.moves.length, a.layout], ask).toEqual([1, true]);
    }
  });

  it('"and" before a place verb starts a clause of its own, with the right kind', () => {
    const cases: [string, string[]][] = [
      ['Add a sales chart and move the tiles to the top', ['move']],
      ['Remove the Notes field and stack the rest', ['flow']],
      ['Rename Orders and stack the tiles', ['flow']],
      ['Rename Orders, put the chart at the top', ['move']],
    ];
    for (const [ask, kinds] of cases) {
      const clauses = splitClauses(ask);
      expect(clauses, ask).toHaveLength(2);
      const a = placeAsk(ask);
      expect(a.layout, ask).toBe(true);
      expect([a.toFlow ? 'flow' : '', ...a.moves.map((m) => m.kind)].filter((k) => k !== ''), ask).toEqual(kinds);
    }
    expect(splitClauses('Add a tile')).toEqual(['Add a tile']);
  });

  it('a joined place clause that nothing explains is Not done', () => {
    const out = judge('Rename Orders and stack the tiles', withOrders(true), withOrders(true));
    expect(out.lines.every((l) => !l.done)).toBe(true);
  });

  it('"Stop stacking the parts" is negated, not a flow ask', () => {
    for (const ask of ['Stop stacking the parts', 'Stop flowing them']) {
      const a = placeAsk(ask);
      expect([a.toFlow, a.layout], ask).toEqual([false, false]);
    }
    expect(placeAsk('Stack the parts').toFlow).toBe(true);
  });
});

describe('placeAsk round 3: names that look like place words', () => {
  it('a list of names holding a flow word is no flow ask', () => {
    for (const ask of ['Add Name, Stack and Status fields to Orders', 'Add Stack and Flow tables', 'Add Revenue and Flow fields']) {
      const a = placeAsk(ask);
      expect(a.toFlow, ask).toBe(false);
      expect(a.toFree, ask).toBe(false);
      expect(a.layout, ask).toBe(false);
      expect(a.moves, ask).toEqual([]);
    }
  });

  it('a place word before a determiner still starts a clause', () => {
    expect(splitClauses('Add a sales chart and move the tiles to the top')).toHaveLength(2);
    expect(splitClauses('Remove the Notes field and stack the rest')).toHaveLength(2);
    expect(splitClauses('Rename Orders and stack the tiles')).toHaveLength(2);
    expect(splitClauses('Add Stack fields and Flow fields')).toHaveLength(1);
    expect(placeAsk('Remove the Notes field and stack the rest').toFlow).toBe(true);
  });

  it('a part word inside a field or column name makes no grid move', () => {
    for (const ask of ['Move the Phone number field to the top', 'Move the Total column to the left', 'Move the Item count field to the top']) {
      const a = placeAsk(ask);
      expect(a.layout, ask).toBe(false);
      expect(a.moves, ask).toEqual([]);
    }
    expect(placeAsk('Move the chart to the top of the page').moves).toHaveLength(1);
  });

  it('adding to the menu is no layout change, adding a chart is', () => {
    expect(placeAsk('Add a search box to the menu').layout).toBe(false);
    expect(placeAsk('Add a button to the menu bar').layout).toBe(false);
    expect(placeAsk('Add a chart').layout).toBe(true);
  });
});
