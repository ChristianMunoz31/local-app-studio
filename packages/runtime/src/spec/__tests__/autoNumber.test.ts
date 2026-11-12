import { describe, expect, it } from 'vitest';
import {
  AUTO_NUMBER_DEFAULTS,
  autoNumberExample,
  autoNumberStateKey,
  formatAutoNumber,
  isNumbered,
  nextCounter,
  parseAutoNumber,
  readAutoNumber,
} from '../autoNumber.ts';
import type { AutoNumberConfig } from '../autoNumber.ts';

const text = (autoNumber: object): unknown => ({ id: 't', fields: [{ id: 'name', type: 'text' }, { id: 'code', type: 'text', autoNumber }] });
const cfg = (over: Partial<AutoNumberConfig> = {}): AutoNumberConfig => ({ field: 'code', kind: 'text', prefix: 'INV-', start: 1, width: 4, ...over });

describe('readAutoNumber', () => {
  it('fills the defaults of an empty block', () => {
    expect(AUTO_NUMBER_DEFAULTS).toEqual({ prefix: '', start: 1, width: 1 });
    expect(readAutoNumber(text({}))).toEqual({ field: 'code', kind: 'text', prefix: '', start: 1, width: 1 });
  });
  it('reads a full text block and an integer block', () => {
    expect(readAutoNumber(text({ prefix: 'INV-', start: 1001, width: 4 }))).toEqual({ field: 'code', kind: 'text', prefix: 'INV-', start: 1001, width: 4 });
    const t = { fields: [{ id: 'seq', type: 'integer', autoNumber: { start: 0 } }] };
    expect(readAutoNumber(t)).toEqual({ field: 'seq', kind: 'integer', prefix: '', start: 0, width: 1 });
  });
  it('reads malformed blocks and other shapes as null, never throws', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { fields: 'no' }, { fields: [null, 3, { id: 'a', type: 'date', autoNumber: {} }] }]) {
      expect(readAutoNumber(bad)).toBeNull();
    }
    for (const block of [{ start: -1 }, { start: 1.5 }, { start: 1e300 }, { width: 0 }, { width: 13 }, { prefix: 3 }, { prefix: 'x'.repeat(21) }, 'x', [], null]) {
      expect(readAutoNumber(text(block as object))).toBeNull();
    }
  });
  it('skips a malformed block and takes the first well-formed one', () => {
    const t = { fields: [{ id: 'a', type: 'text', autoNumber: { width: 99 } }, { id: 'b', type: 'integer', autoNumber: {} }] };
    expect(readAutoNumber(t)?.field).toBe('b');
  });
});

describe('format and parse', () => {
  it('round trips for widths 1 to 12 and a prefix that ends in a digit', () => {
    for (const prefix of ['', 'INV-', 'A1', 'X9-']) {
      for (let width = 1; width <= 12; width += 1) {
        for (const n of [0, 1, 7, 42, 999, 123456, 999_999_999_999]) {
          const c = cfg({ prefix, width });
          const s = formatAutoNumber(c, n);
          expect(typeof s).toBe('string');
          expect(parseAutoNumber(c, s)).toBe(n);
        }
      }
    }
  });
  it('pads to width and grows past it', () => {
    expect(formatAutoNumber(cfg(), 7)).toBe('INV-0007');
    expect(formatAutoNumber(cfg(), 10000)).toBe('INV-10000');
  });
  it('an integer field gets the number itself', () => {
    const c = cfg({ kind: 'integer', prefix: '', width: 1 });
    expect(formatAutoNumber(c, 12)).toBe(12);
    expect(parseAutoNumber(c, 12)).toBe(12);
    expect(parseAutoNumber(c, '12')).toBeNull();
    expect(parseAutoNumber(c, 1.5)).toBeNull();
    expect(parseAutoNumber(c, 1e300)).toBeNull();
  });
  it('ignores a value this numbering could not have given', () => {
    const c = cfg();
    for (const v of ['', 'INV-', 'INV-12a', 'inv-0001', 'XNV-0001', 'INV- 1', null, undefined, 5, 'INV-99999999999999999999']) {
      expect(parseAutoNumber(c, v)).toBeNull();
    }
  });
});

describe('nextCounter', () => {
  it('is the highest of start, last + 1 and max stored + 1', () => {
    expect(nextCounter(cfg({ start: 1001 }), null, null)).toBe(1001);
    expect(nextCounter(cfg({ start: 1 }), 5, null)).toBe(6);
    expect(nextCounter(cfg({ start: 1 }), null, 9)).toBe(10);
    expect(nextCounter(cfg({ start: 1 }), 5, 9)).toBe(10);
    expect(nextCounter(cfg({ start: 50 }), 5, 9)).toBe(50);
    expect(nextCounter(cfg({ start: 0 }), null, null)).toBe(0);
  });
  it('treats a last that is not a safe integer as missing', () => {
    for (const bad of [1e300, Number.NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(nextCounter(cfg({ start: 3 }), bad, null)).toBe(3);
      expect(nextCounter(cfg({ start: 3 }), bad, 10)).toBe(11);
    }
  });
});

describe('isNumbered', () => {
  it('is true for a field with a block and false without one', () => {
    expect(isNumbered({ id: 'a', autoNumber: {} })).toBe(true);
    expect(isNumbered({ id: 'a', autoNumber: null })).toBe(false);
    expect(isNumbered({ id: 'a' })).toBe(false);
  });
});

describe('state key and example', () => {
  it('builds the key from the ids', () => {
    expect(autoNumberStateKey('invoices', 'number')).toBe('autonumber.invoices.number');
  });
  it('shows three numbers from the start', () => {
    expect(autoNumberExample(cfg({ start: 1 }))).toBe('INV-0001, INV-0002, INV-0003');
    expect(autoNumberExample(cfg({ kind: 'integer', start: 100 }))).toBe('100, 101, 102');
  });
});
