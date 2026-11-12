// The CSV export guard (phase 28, M4): a cell that would read as a formula gets a leading quote, also when quotes come first, so
// the importer that strips exactly one quote can never expose a formula on the next export.
import { describe, expect, it } from 'vitest';
import { unguardCell } from '../../../packages/runtime/server/csvParse.js';
import { cellText, toCsv } from '../../export/csv.js';

describe('cellText guard', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    [' +1', "' +1"],
    ['@x', "'@x"],
    ['-5', "'-5"],
    ['\tcmd', "'\tcmd"],
    ["'=x", "''=x"],
    ["''+1", "'''+1"],
    ["' =x", "'' =x"],
  ])('guards %j as %j in a text column', (value, expected) => {
    expect(cellText(value, 'text')).toBe(expected);
  });

  it('leaves a plain number in a numeric column alone, and a number typed in a text field is guarded', () => {
    expect(cellText('-12.5', 'real')).toBe('-12.5');
    expect(cellText('-12', 'integer')).toBe('-12');
    expect(cellText(-12.5, 'real')).toBe('-12.5');
    expect(cellText('-5', 'text')).toBe("'-5");
  });

  it('leaves other text alone', () => {
    for (const v of ['hello', "it's", "'quoted", "'", 'a=b', 'a-b']) expect(cellText(v, 'text')).toBe(v);
  });

  it('is undone by unguardCell for every guarded sample', () => {
    for (const v of ['=x', ' +1', '@x', '-5', "'=x", "''+1", "' =x"]) expect(unguardCell(cellText(v, 'text'))).toBe(v);
  });

  it('guards a header and a whole table the same way', () => {
    expect(toCsv([{ name: '=bad', type: 'text' }], [{ '=bad': "'=x" }])).toBe("'=bad\r\n''=x\r\n");
  });
});
