// Phase 28: the 300-row invoices CSV of the import flow, built in code (no fixture file, so no date ages). The header is line 1, so
// data row n is on line n + 1; the import words say "Row 58" for line 58. Lines 58 and 201 are bad on purpose: 58 has an amount that is
// not a number, 201 a due date that is not a date. The other 298 rows add as unpaid invoices (no Client column, Paid left empty).

export const CSV_ROWS = 300;
export const BAD_LINES = [58, 201];
export const GOOD_ROWS = CSV_ROWS - BAD_LINES.length;

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (offsetDays) => {
  const d = new Date(Date.UTC(2026, 0, 1 + offsetDays));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** The CSV text: `Issued,Due,Amount,Paid` and 300 data rows, CRLF line ends, lines 58 and 201 bad. */
export function buildInvoicesCsv() {
  const lines = ['Issued,Due,Amount,Paid'];
  for (let n = 1; n <= CSV_ROWS; n++) {
    const line = n + 1;
    const issued = isoDate(n % 300);
    const due = line === 201 ? 'the thirty-first of never' : isoDate((n % 300) + 30);
    const amount = line === 58 ? 'lots of money' : `${(n % 90) + 10}.50`;
    lines.push(`${issued},${due},${amount},`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** A Playwright `setInputFiles` payload for the CSV. */
export const invoicesCsvFile = () => ({ name: 'invoices.csv', mimeType: 'text/csv', buffer: Buffer.from(buildInvoicesCsv(), 'utf8') });
