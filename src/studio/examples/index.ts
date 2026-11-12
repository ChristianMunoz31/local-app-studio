// The eight example apps: light metadata now, the JSON fetched from public/examples/ only when "Use this example" is pressed.
import type { ThemeId } from '@local-app-studio/runtime/theme/ids';
import type { AppSpecInput } from '@local-app-studio/runtime/spec/schema';
import type { SampleRecords } from '@/studio/lib/sampleData';

export type ExampleId =
  'crew-board' | 'job-tracker' | 'invoices-and-clients' | 'inventory' | 'appointments' | 'expense-log' | 'membership-attendance' | 'reading-list';

export interface ExampleMeta {
  id: ExampleId;
  name: string;
  description: string;
  shows: readonly string[];
  tryThese: readonly string[];
  tables: number;
  pages: number;
  theme: ThemeId;
  mode: 'light' | 'dark';
}

export interface ExampleBody {
  spec: AppSpecInput;
  records: SampleRecords;
}

export const EXAMPLES: readonly ExampleMeta[] = [
  {
    id: 'crew-board',
    name: 'Crew Board',
    description: 'For a small trade business that plans who works on which crew and who leads it.',
    shows: ['linked tables', 'a filter bar', 'a page for each crew', 'a dark look'],
    tryThese: ['Add a Phone field to People', 'Put a chart of people per crew on the Crews page', 'Move the menu to the side'],
    tables: 2,
    pages: 3,
    theme: 'forest',
    mode: 'dark',
  },
  {
    id: 'job-tracker',
    name: 'Job Tracker',
    description: 'For a contractor or freelancer who tracks jobs, their due dates and the steps left on each.',
    shows: ['a checklist you can tick', 'a progress bar', 'a chart of jobs by status', 'parts side by side'],
    tryThese: ['Change the progress goal to 20', 'Add a Paid field to Jobs', 'Group the chart by client'],
    tables: 2,
    pages: 3,
    theme: 'ocean',
    mode: 'light',
  },
  {
    id: 'invoices-and-clients',
    name: 'Invoices and Clients',
    description: 'For a freelancer or small shop that sends invoices and wants to see what is paid and what is still owed.',
    shows: ['a row of totals', 'a chart by month', 'a search box in the menu bar', 'a page for each invoice'],
    tryThese: ['Add a Notes field to Invoices', 'Change the chart to a line', 'Add a filter bar by client on the home page'],
    tables: 2,
    pages: 3,
    theme: 'slate',
    mode: 'light',
  },
  {
    id: 'inventory',
    name: 'Inventory',
    description: 'For a small shop or workshop that keeps track of stock and what to order next.',
    shows: ['a low stock list first', 'a callout', 'a form that logs deliveries', 'a dark take on a light theme'],
    tryThese: ['Change the low stock limit from 5 to 10', 'Add a Price field to Products', 'Add a Suppliers table and link deliveries to it'],
    tables: 2,
    pages: 4,
    theme: 'mono',
    mode: 'dark',
  },
  {
    id: 'appointments',
    name: 'Appointments',
    description: 'For a salon, studio or tutor who books clients and wants to see what is on today and next.',
    shows: ['a side menu', 'a timeline by day', 'a page for each client', 'dates with times'],
    tryThese: ['Move the menu to the top', 'Add a Price field to Appointments', 'Show the bookings as a table'],
    tables: 2,
    pages: 4,
    theme: 'rose',
    mode: 'light',
  },
  {
    id: 'expense-log',
    name: 'Expense Log',
    description: 'For anyone who logs spending by category and wants to see the total for each month.',
    shows: ['a chart by category', 'a monthly total as a line', 'a filter bar', 'a quick add'],
    tryThese: ['Add a Receipt kept field (yes or no) to Expenses', 'Change the month chart to bars', 'Add a Shop field and filter by it'],
    tables: 2,
    pages: 4,
    theme: 'midnight',
    mode: 'dark',
  },
  {
    id: 'membership-attendance',
    name: 'Membership and Attendance',
    description: 'For a club, gym or class that keeps its members and who came to each session.',
    shows: ['three linked tables', 'a grid of cards', 'a progress bar toward a goal', 'check-ins from a session page'],
    tryThese: ['Change the check-in goal to 60', 'Add a Level field to Sessions', 'Add a fourth card to the grid'],
    tables: 3,
    pages: 4,
    theme: 'sand',
    mode: 'light',
  },
  {
    id: 'reading-list',
    name: 'Reading List',
    description: 'For a reader who keeps the books they want to read, are reading and have finished.',
    shows: ['cards side by side', 'a section that folds away', 'a quick add in the menu bar', 'no numbers at all'],
    tryThese: ['Add a Started field to Books', 'Open the Finished section by default', 'Add a Loaned to field'],
    tables: 2,
    pages: 3,
    theme: 'paper',
    mode: 'light',
  },
];

/** Where the JSON lives: public/examples/<id>.spec.json and <id>.records.json, served from the app's own origin (no network beyond the local server). */
const exampleUrl = (id: ExampleId, kind: 'spec' | 'records'): string => `/examples/${id}.${kind}.json`;

/** How long one example file may take before the load gives up (the files are small and same-origin). */
export const EXAMPLE_TIMEOUT_MS = 15_000;

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(EXAMPLE_TIMEOUT_MS);
  const res = await fetch(url, { signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) });
  if (!res.ok) throw new Error(`Example file ${url} answered ${res.status}`);
  return res.json();
}

/**
 * Loads the spec and sample records of one example (two small same-origin files, fetched only when asked for).
 * An optional signal cancels both fetches (the caller left); each fetch also stops after 15 seconds.
 */
export async function loadExample(id: ExampleId, signal?: AbortSignal): Promise<ExampleBody> {
  const [spec, records] = await Promise.all([fetchJson(exampleUrl(id, 'spec'), signal), fetchJson(exampleUrl(id, 'records'), signal)]);
  return { spec: spec as AppSpecInput, records: records as SampleRecords };
}
