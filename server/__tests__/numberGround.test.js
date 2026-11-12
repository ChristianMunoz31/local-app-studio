// A number in the reply must come from this turn's tool results or the person's message (server/agents/numberGround.js).
// The results below have the shape of the real bakery verify turns (phase26 ast-b-number, ast-e-inject1).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../loadEnv.js', () => ({}));
import { UNGROUNDED_NUMBER_NOTE as NOTE, groundedNumbers, normalizeNumber, withNumberGround } from '../agents/numberGround.js';
import { plainToolWords } from '../agents/toolWords.js';
import { runAssistant } from '../agents/assistantAgent.js';

const row = (customer, quantity, pickup, product) => ({
  id: 'efeb7c53-0df1-4cb6-8d44-f7ad1fafe7df',
  customer_id: customer,
  product_id: 'c4a059e0-1663-4589-a3d5-baf0dcfe588b',
  quantity,
  pickup_date: pickup,
  paid: 'No',
  created_at: '2026-11-07T03:12:37.169Z',
  updated_at: '2026-11-07T03:12:37.169Z',
  product_id_title: product,
});
const SCOPE = 'Only records where Paid is No. These are not totals of all records.';
// ast-b-number: two unpaid orders, 24 oat cookies and 1 birthday cake, total of that filter 2.
const unpaid = { table: 'orders', total: 2, filter: { paid: 'No' }, scope: SCOPE, rows: [row('Aisha Khan', 24, '2026-11-07', 'Oat cookie'), row('Tom Becker', 1, '2026-11-06', 'Birthday cake')] };
// ast-e-inject1 shape, with the true total of 6 orders.
const latest = {
  table: 'orders',
  total: 6,
  filter: null,
  scope: 'All records.',
  rows: [row('Grace Hall', 2, '2026-11-08', 'Sourdough loaf'), row('Aisha Khan', 24, '2026-11-07', 'Oat cookie'), row('Tom Becker', 1, '2026-11-06', 'Birthday cake')],
};

describe('normalizeNumber', () => {
  it.each([
    ['1,234.50', '1234.5'],
    ['12.00', '12'],
    ['09', '9'],
    ['0.50', '0.5'],
    ['0', '0'],
    ['2026', '2026'],
  ])('%s -> %s', (raw, want) => expect(normalizeNumber(raw)).toBe(want));
});

describe('groundedNumbers', () => {
  it('holds values, numbers inside strings and date parts, but not ids or clock times', () => {
    const set = groundedNumbers([unpaid], 'I have 5 of them');
    for (const n of ['2', '24', '1', '2026', '11', '7', '6', '5']) expect(set.has(n)).toBe(true);
    for (const n of ['3', '12', '37', '169', '4059']) expect(set.has(n)).toBe(false);
  });

  it('reads a JSON text result and normalizes amounts', () => {
    const set = groundedNumbers([JSON.stringify({ sum: 1250.5, label: 'Total $1,250.50 and 12.00' })]);
    expect(set.has('1250.5')).toBe(true);
    expect(set.has('12')).toBe(true);
  });
});

describe('a float from a stat grounds its rounded forms (RV26-30)', () => {
  it('grounds 3.3, 3.33 and 3.33333333333 for an average of 10/3, never 3', () => {
    const results = [{ table: 'crews', avg: 10 / 3 }];
    for (const text of ['The average is 3.3.', 'The average is 3.33.', 'The average is $3.33.', 'The average is 3.33333333333.']) {
      expect(withNumberGround(text, { results })).toBe(text);
    }
    expect(withNumberGround('The average is 3.', { results })).toBe(NOTE);
    expect(withNumberGround('The average is 3.34.', { results })).toBe(NOTE);
  });

  it('grounds $3.30 and 3.3 for a sum of 1.1 + 2.2, never 3', () => {
    const results = [{ sum: 1.1 + 2.2 }];
    expect(withNumberGround('The sum is $3.30.', { results })).toBe('The sum is $3.30.');
    expect(withNumberGround('The sum is 3.3.', { results })).toBe('The sum is 3.3.');
    expect(withNumberGround('The sum is 3.', { results })).toBe(NOTE);
    expect(groundedNumbers(results).has('3')).toBe(false);
  });

  it('leaves a whole number with only its own form', () => {
    expect(groundedNumbers([{ n: 25 }])).toEqual(new Set(['25']));
  });
});

describe('withNumberGround', () => {
  it('replaces the model sum of filtered rows (B-12): 25 is in no result', () => {
    const text = 'There are 2 unpaid orders.\nThe total number of items ordered is 25 (24 oat cookies + 1 birthday cake).';
    expect(withNumberGround(text, { results: [unpaid], prompt: 'How many items are unpaid?' })).toBe(`There are 2 unpaid orders.\n${NOTE}`);
  });

  it('keeps 25 when get_stats gave it, but still replaces the 24 + 1 split it did not give', () => {
    const stats = { table: 'orders', count: 2, sum: 25, filter: { paid: 'No' }, scope: SCOPE };
    expect(withNumberGround('The unpaid total is 25.', { results: [stats] })).toBe('The unpaid total is 25.');
    expect(withNumberGround('The unpaid total is 25 (24 + 1).', { results: [stats] })).toBe(NOTE);
  });

  it('replaces "4 orders in total" when the total is 6, keeps a true "6 orders" and dates from the rows (B-V-4)', () => {
    expect(withNumberGround('There are 4 orders in total.', { results: [latest] })).toBe(NOTE);
    expect(withNumberGround('There are 6 orders in total.', { results: [latest] })).toBe('There are 6 orders in total.');
    const list = 'The latest orders are:\n\n* Grace Hall: 2 Sourdough loaves, pickup on 2026-11-08, not paid yet.\n* Aisha Khan: 24 Oat cookies, pickup on 2026-11-07, not paid yet.';
    expect(withNumberGround(list, { results: [latest] })).toBe(list);
  });

  it('replaces a bullet that holds a record the tool never gave, keeps the bullet lead and the other lines', () => {
    const list = '* Grace Hall: 2 Sourdough loaves, pickup on 2026-11-08.\n* Omar Diaz: 6 Oat cookies, pickup on 2026-11-09, paid.\n1. Tom Becker: 1 Birthday cake.';
    expect(withNumberGround(list, { results: [{ ...latest, total: 3 }] })).toBe(`* Grace Hall: 2 Sourdough loaves, pickup on 2026-11-08.\n* ${NOTE}\n1. Tom Becker: 1 Birthday cake.`);
  });

  it('writes the fixed sentence once per reply and drops later ones', () => {
    expect(withNumberGround('You have 99 orders. Also 98 products. Fine.', { results: [latest] })).toBe(`${NOTE} Fine.`);
  });

  it('with no tool result a number in the reply is replaced, unless the person wrote it', () => {
    expect(withNumberGround('That is 12 items.', { results: [] })).toBe(NOTE);
    expect(withNumberGround('Yes, 12 items.', { results: [], prompt: 'are there 12 items?' })).toBe('Yes, 12 items.');
    expect(withNumberGround('No number here.', { results: [] })).toBe('No number here.');
  });

  it('matches amounts across comma and trailing-zero forms', () => {
    expect(withNumberGround('Collected $1,250.50.', { results: [{ sum: 1250.5 }] })).toBe('Collected $1,250.50.');
    expect(withNumberGround('Collected $1,250.', { results: [{ sum: 1250.5 }] })).toBe(NOTE);
  });

  it('drops a later ungrounded sentence from text that already holds the fixed sentence, with no second note (RV26-35)', () => {
    expect(withNumberGround(`${NOTE} 7 more.`, { results: [] })).toBe(NOTE);
    expect(withNumberGround(`${NOTE} 6 more. Fine.`, { results: [{ n: 6 }] })).toBe(`${NOTE} 6 more. Fine.`);
  });
});

describe('plainToolWords', () => {
  const labelOf = (id) => ({ products: 'Products' })[id] ?? id;
  it('swaps a tool name for plain words (B-V-6)', () => {
    expect(plainToolWords('Find the product ID for "Bread" using the list_records__products tool.', labelOf)).toBe('Find the product ID for "Bread" using your Products list.');
    expect(plainToolWords('Call get_stats__orders or describe_data.', labelOf)).toBe('Call the records or the records.');
    expect(plainToolWords('Use list_records again.', labelOf)).toBe('Use the records again.');
  });
  it('leaves text with no tool name', () => {
    expect(plainToolWords('Nothing to see.')).toBe('Nothing to see.');
  });
});

describe('the agent grounds the date it tells the model (RV26-37)', () => {
  it('keeps a reply that quotes today, and still replaces a number that is not grounded', async () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const clientSaying = (text) => ({
      provider: 'ollama',
      model: 'test',
      chatWithTools: async ({ onToken }) => {
        onToken?.(text);
        return { message: { role: 'assistant', content: text } };
      },
    });
    const kept = await runAssistant({ prompt: 'what day is it?', client: clientSaying(`Today is ${today}.`) });
    expect(kept.finalAnswer).toBe(`Today is ${today}.`);
    const replaced = await runAssistant({ prompt: 'what day is it?', client: clientSaying('You have 4711 crews.') });
    expect(replaced.finalAnswer).toBe(NOTE);
  });
});
