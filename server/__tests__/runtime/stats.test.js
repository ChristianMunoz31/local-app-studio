// computeStats: counts and totals are folded in code from query.js rows (the model never computes them).
// Uses the synthetic probe_items table (helpers/probeTable.js) with a hand-made compiled shape, so it runs in the default mode.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../modules/studio.data.js', (importOriginal) => import('../helpers/probeTable.js').then((m) => m.withProbeTable(importOriginal)));
import { closeTestDb, createTestDb, resetDb, seedDb } from '../helpers/testDb.js';
import { computeStats } from '@local-app-studio/runtime/server/stats.js';
import { op } from '../../db/query.js';

const compiled = {
  validators: {
    probe_items: {
      name: { type: 'text', label: 'Name', required: true },
      quantity: { type: 'integer', label: 'Quantity', required: false },
      unit_cost: { type: 'real', label: 'Cost', required: false },
    },
  },
};

let db;
beforeAll(() => {
  db = createTestDb();
});
afterAll(() => closeTestDb(db));
beforeEach(() => resetDb(db));

describe('computeStats', () => {
  it('counts the matching rows and folds sum, average, minimum and maximum per number field', () => {
    seedDb(db, {
      probe_items: [
        { name: 'Lamp', category: 'office', quantity: 2, unit_cost: 12.5 },
        { name: 'Chair', category: 'office', quantity: 1, unit_cost: 80, status: 'done' },
        { name: 'Kettle', category: 'kitchen', quantity: 4, unit_cost: 10.1 },
      ],
    });
    const stats = computeStats(compiled, 'probe_items');
    expect(stats.table).toBe('probe_items');
    expect(stats.count).toBe(3);
    expect(Object.keys(stats.fields)).toEqual(['quantity', 'unit_cost']);
    expect(stats.fields.quantity).toEqual({ count: 3, sum: 7, avg: 7 / 3, min: 1, max: 4 });
    expect(stats.fields.unit_cost).toEqual({ count: 3, sum: 12.5 + 80 + 10.1, avg: (12.5 + 80 + 10.1) / 3, min: 10.1, max: 80 });
  });

  it('honors where and search, and an empty match gives sum 0 and null average, minimum and maximum', () => {
    seedDb(db, {
      probe_items: [
        { name: 'Lamp', category: 'office', quantity: 2, unit_cost: 12.5 },
        { name: 'Kettle', category: 'kitchen', quantity: 4, unit_cost: 10 },
      ],
    });
    const office = computeStats(compiled, 'probe_items', { where: { category: 'office' } });
    expect(office.count).toBe(1);
    expect(office.fields.quantity.sum).toBe(2);
    const found = computeStats(compiled, 'probe_items', { search: { term: 'KET', columns: ['name'] } });
    expect(found.fields.quantity.max).toBe(4);
    const none = computeStats(compiled, 'probe_items', { where: { quantity: op.gt(100) } });
    expect(none).toEqual({
      table: 'probe_items',
      count: 0,
      fields: {
        quantity: { count: 0, sum: 0, avg: null, min: null, max: null },
        unit_cost: { count: 0, sum: 0, avg: null, min: null, max: null },
      },
    });
  });

  it('a table without number fields has only a count', () => {
    seedDb(db, { probe_items: [{ name: 'Lamp' }] });
    expect(computeStats({ validators: { probe_items: { name: { type: 'text' } } } }, 'probe_items')).toEqual({ table: 'probe_items', count: 1, fields: {} });
  });
});
