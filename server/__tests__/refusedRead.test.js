// A refused read never becomes a number in the reply (server/agents/refusedRead.js).
import { describe, expect, it } from 'vitest';
import { readTarget, readVerb, standingRefusal, withRefusedReadGuard } from '../agents/refusedRead.js';

const REFUSAL = 'Unknown argument "order" for get_stats__rent_payments. Allowed: match. Call get_stats__rent_payments again without it.';
// The refusal as the person reads it: no tool name, no retry words for the model (B-V-5).
const PERSON = 'I could not count that, because the request was refused: Unknown argument "order" for the records. Allowed: match. Nothing was read.';
const DASH = String.fromCharCode(0x2014);
const refused = (table) => ({ table, verb: 'count', ok: false, refusal: REFUSAL });

describe('readTarget', () => {
  it('names the table of a per-table read and null for the rest', () => {
    expect(readTarget('get_stats__rent_payments')).toEqual({ table: 'rent_payments' });
    expect(readTarget('list_records__repairs')).toEqual({ table: 'repairs' });
    expect(readTarget('describe_data')).toEqual({ table: null });
    expect(readTarget('list_records')).toEqual({ table: null });
    expect(readTarget('save_record__repairs')).toBeNull();
    expect(readTarget(undefined)).toBeNull();
  });
});

describe('withRefusedReadGuard', () => {
  it('replaces a reply with a number after a refused read (landlord shape)', () => {
    expect(withRefusedReadGuard('you collected a total of $0', [refused('rent_payments')])).toBe(
      PERSON,
    );
  });

  it('clips a long refusal sentence to 160 characters', () => {
    const out = withRefusedReadGuard('3 left', [{ table: 'a', ok: false, refusal: `${'x'.repeat(300)}.` }]);
    expect(out).toBe(`I could not read that, because the request was refused: ${'x'.repeat(160)}. Nothing was read.`);
  });

  it('keeps the reply when a later read of the same table, or an untabled read, succeeded', () => {
    expect(withRefusedReadGuard('3 left', [refused('rent_payments'), { table: 'rent_payments', ok: true }])).toBe('3 left');
    expect(withRefusedReadGuard('3 left', [refused('rent_payments'), { table: null, ok: true }])).toBe('3 left');
  });

  it('still replaces when nothing was read, and appends when another table was read (RV26-22)', () => {
    expect(withRefusedReadGuard('3 left', [refused('rent_payments')])).toBe(
      PERSON,
    );
    const kept = withRefusedReadGuard('You have 3 repairs.', [refused('rent_payments'), { table: 'repairs', ok: true }]);
    expect(kept).toBe(`You have 3 repairs.\n${PERSON.replace('Nothing was read.', 'Nothing was read from that table.')}`);
    expect(withRefusedReadGuard('3 left', [{ table: 'repairs', ok: true }, refused('rent_payments')])).toContain('Nothing was read from that table.');
  });

  it('appends after a sentence break: a full stop is added when the reply has none (RV26-36)', () => {
    const reads = [refused('rent_payments'), { table: 'repairs', ok: true }];
    const tail = PERSON.replace('Nothing was read.', 'Nothing was read from that table.');
    expect(withRefusedReadGuard('You have 3 repairs', reads)).toBe(`You have 3 repairs.\n${tail}`);
    expect(withRefusedReadGuard('Is it 3 repairs?', reads)).toBe(`Is it 3 repairs?\n${tail}`);
    expect(withRefusedReadGuard('You have 3 repairs.  \n', reads)).toBe(`You have 3 repairs.\n${tail}`);
  });

  it('clears a generic refusal only by a call with no table (RV26-22)', () => {
    expect(withRefusedReadGuard('3 left', [refused(null), { table: 'repairs', ok: true }])).toContain('Nothing was read from that table.');
    expect(standingRefusal([refused(null), { table: 'repairs', ok: true }])).toBe(REFUSAL);
    expect(standingRefusal([refused(null), { table: null, ok: true }])).toBeNull();
    expect(withRefusedReadGuard('3 left', [refused(null), { table: null, ok: true }])).toBe('3 left');
  });

  it('sends the composed sentence through sanitizeModelText (RV26-28)', () => {
    const out = withRefusedReadGuard('3 left', [{ table: 'a', ok: false, refusal: `Bad key ${DASH} retry, total $1234.5 is not allowed.` }]);
    expect(out).not.toContain(DASH);
    expect(out).toContain('$1,234.50');
  });

  it('keeps a reply with no digit, and any reply when nothing was refused', () => {
    expect(withRefusedReadGuard('I could not get that.', [refused('a')])).toBe('I could not get that.');
    expect(withRefusedReadGuard('You have 3 crews.', [{ table: 'crews', ok: true }])).toBe('You have 3 crews.');
    expect(withRefusedReadGuard('You have 3 crews.', [])).toBe('You have 3 crews.');
    expect(standingRefusal(undefined)).toBeNull();
  });
});

describe('the refusal is worded for the person (B-V-5)', () => {
  const generic = 'Argument "table" must be one of: products, orders. Nothing was read. Call list_records again with table as one of those names';

  it('says read for a list or describe call and count only for get_stats', () => {
    expect(withRefusedReadGuard('3 left', [{ table: null, ok: false, refusal: `${generic}.`, verb: 'read' }])).toMatch(/^I could not read that, /);
    expect(withRefusedReadGuard('3 left', [{ table: null, ok: false, refusal: `${generic}.`, verb: 'count' }])).toMatch(/^I could not count that, /);
    expect(readVerb('get_stats__orders')).toBe('count');
    expect(readVerb('list_records__orders')).toBe('read');
    expect(readVerb('describe_data')).toBe('read');
  });

  it('names no tool and gives no retry words for a bad table, and never ends cut', () => {
    const out = withRefusedReadGuard('3 left', [{ table: null, ok: false, refusal: `${generic}, or call one of: list_records__products, list_records__orders.`, verb: 'read' }]);
    expect(out).toBe('I could not read that, because the request was refused: That request named a table this app does not have. Nothing was read.');
    expect(out).not.toMatch(/list_records|get_stats| call\.| or call/);
  });
});
