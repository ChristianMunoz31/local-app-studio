import { describe, expect, it } from 'vitest';
import { defaultCopyName, duplicatedNotice, exportFileName, exportedNotice, waitingLine } from '../appFiles';

describe('appFiles', () => {
  it('names the export after the app with no code word (P17-15)', () => {
    expect(exportFileName('Job Green')).toBe('Job Green app.json');
    expect(exportFileName('A<b>:c"/d\\e|f?g*')).toBe('A b c d e f g app.json');
    expect(exportFileName('  ...  ')).toBe('My app.json');
    expect(exportFileName('Ends. ')).toBe('Ends app.json');
  });

  it('says what the file holds', () => {
    expect(exportedNotice('Job Green', 'Job Green app.json')).toBe(
      'Exported "Job Green" as Job Green app.json. It holds the design. Records added in Preview stay on this computer.',
    );
  });

  it('gives the copy the same default name as the server and says it starts empty (P17-16)', () => {
    expect(defaultCopyName('Job Green')).toBe('Job Green Copy');
    expect(defaultCopyName('x'.repeat(40))).toHaveLength(40);
    expect(duplicatedNotice('Job Green', 'Green Acre North Site')).toBe('Duplicated "Job Green" as "Green Acre North Site". The copy starts with no records.');
  });

  it('says a design is waiting with plural rules', () => {
    expect(waitingLine({ tableCount: 1, pageCount: 2 })).toBe('A design is waiting: 1 table, 2 pages.');
    expect(waitingLine({ tableCount: 0, pageCount: 1 })).toBe('A design is waiting: 0 tables, 1 page.');
  });
});
