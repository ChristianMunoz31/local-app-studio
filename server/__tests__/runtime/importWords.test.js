// The words of the CSV import (phase 28, F2): built on the server, pure.
import { describe, expect, it } from 'vitest';
import { ambiguousLinkMessage, clipText, dryRunLines, missingLinkMessage, resultLines, rowLine } from '../../../packages/runtime/server/importWords.js';

describe('importWords', () => {
  it('writes the dry run lines', () => {
    expect(dryRunLines({ valid: 298, invalid: 2, leftOut: [] })).toEqual(['298 rows can be added. 2 rows will be left out.']);
    expect(dryRunLines({ valid: 1, invalid: 0, leftOut: ['Notes', 'Internal ref'] })).toEqual([
      '1 row can be added. 0 rows will be left out.',
      'Left out: Notes, Internal ref.',
    ]);
  });
  it('clips a header to 60 characters in the left out line', () => {
    const [, line] = dryRunLines({ valid: 0, invalid: 0, leftOut: ['h'.repeat(80)] });
    expect(line).toBe(`Left out: ${'h'.repeat(60)}....`);
    expect(clipText('short')).toBe('short');
    expect(clipText('x'.repeat(61))).toBe(`${'x'.repeat(60)}...`);
  });
  it('writes the result lines and the way to carry on', () => {
    expect(resultLines({ added: 298, stoppedAt: null })).toEqual(['Added 298 rows.']);
    expect(resultLines({ added: 1, stoppedAt: null })).toEqual(['Added 1 row.']);
    expect(dryRunLines({ valid: 3, invalid: 1, leftOut: [] })).toEqual(['3 rows can be added. 1 row will be left out.']);
    expect(resultLines({ added: 1000, stoppedAt: 1002 })).toEqual(['Added 1000 rows.', 'Nothing from row 1002 on was added. Import again from row 1002.']);
  });
  it('writes row lines', () => {
    expect(rowLine(58, 'Due must be a date like 2025-01-31.')).toBe('Row 58: Due must be a date like 2025-01-31.');
    expect(rowLine(201, missingLinkMessage('Clients', 'Acme Ltd'))).toBe('Row 201: there is no Clients record named "Acme Ltd".');
    expect(ambiguousLinkMessage('Clients', 'Twin', 2)).toBe('2 Clients records are named "Twin". Give one of them another name, then import again.');
  });
  it('clips the title of a missing link to 60 characters', () => {
    expect(missingLinkMessage('Clients', 'z'.repeat(70))).toBe(`there is no Clients record named "${'z'.repeat(60)}...".`);
  });
});
