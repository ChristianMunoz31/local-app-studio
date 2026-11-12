import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedRecords } from '../../components/__tests__/featureFixtures';
import { StudioApiError } from '../../services/studioApi';
import type { AppSummary, FeatureRecord } from '../../types';
import FeaturesPage from '../FeaturesPage';

const api = vi.hoisted(() => ({ list: vi.fn(), duplicate: vi.fn(), remove: vi.fn(), importFile: vi.fn(), download: vi.fn(), listApps: vi.fn() }));
vi.mock('../../services/studioApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/studioApi')>();
  return { ...actual, listApps: api.listApps, featuresApi: { ...actual.featuresApi, list: api.list, duplicate: api.duplicate, remove: api.remove, importFile: api.importFile } };
});
vi.mock('../../lib/download', () => ({ downloadJson: api.download }));
vi.mock('../../showcase/PreviewFrame', () => ({ default: () => <div data-testid="preview-stub" /> }));

const app = (id: string, name: string, ok = true): AppSummary => ({
  id,
  name,
  slug: id,
  revision: 1,
  ok,
  issueCount: 0,
  tableCount: 1,
  pageCount: 1,
  description: '',
  hasInstaller: false,
  waiting: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function Where() {
  const loc = useLocation();
  return (
    <p data-testid="where">
      {loc.pathname}|{JSON.stringify(loc.state)}
    </p>
  );
}

const openMenu = (name: string): void => {
  fireEvent.keyDown(screen.getByRole('button', { name: `More actions for ${name}` }), { key: 'Enter' });
};
const mount = async (records: FeatureRecord[] = seedRecords(), url = '/features') => {
  api.list.mockResolvedValue(records);
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('region', { name: 'Layout' }).catch(() => screen.findByTestId('features-count'));
};

beforeEach(() => {
  window.localStorage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.listApps.mockResolvedValue([app('a1', 'Crew Roster')]);
});
afterEach(cleanup);

describe('FeaturesPage', () => {
  it('shows built-in parts and your features by category in a fixed order, without Page, Tab and Column', async () => {
    await mount();
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions).toEqual(['Layout', 'Navigation', 'Records', 'Input', 'Actions', 'Your features']);
    expect(within(screen.getByRole('region', { name: 'Records' })).getByRole('button', { name: 'Show details for Table of records' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Your features' })).getByRole('button', { name: 'Show details for Number row' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show details for Page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show details for Tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show details for Column' })).toBeNull();
    expect(screen.getByTestId('features-count').textContent).toBe('33 shown');
    await waitFor(() => expect(screen.getAllByTestId('preview-stub').length).toBe(33));
  });

  it('marks tiles that show data with Sample data, and only those', async () => {
    await mount();
    const tile = (name: string) => screen.getByRole('button', { name: `Show details for ${name}` }).closest('li') as HTMLElement;
    expect(within(tile('Table of records')).getByText('Sample data', { selector: '[data-sample-badge]' })).toBeTruthy();
    // The button's name is its aria-label, so the words come as its description.
    const described = (name: string): string =>
      (screen.getByRole('button', { name }).getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
    expect(described('Show details for Table of records')).toContain('Sample data');
    expect(described('Show details for Heading')).not.toContain('Sample data');
    expect(within(tile('Number row')).queryByText('Sample data', { selector: '[data-sample-badge]' })).not.toBeNull();
    // P-47: the badge sits under the picture beside the category chip, not over the picture
    const badge = within(tile('Table of records')).getByText('Sample data', { selector: '[data-sample-badge]' });
    expect(badge.closest('[aria-hidden="true"].pointer-events-none')).toBeNull();
    expect(badge.parentElement?.textContent).toContain('Records');
    expect(within(tile('Section')).queryByText(/Sample data/)).toBeNull();
    expect(within(tile('Heading')).queryByText(/Sample data/)).toBeNull();
  });

  it('shows six placeholder tiles while loading', () => {
    api.list.mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter>
        <FeaturesPage />
      </MemoryRouter>,
    );
    const loading = screen.getByTestId('features-loading');
    expect(loading.getAttribute('aria-label')).toBe('Loading features');
    expect(loading.querySelectorAll('li')).toHaveLength(6);
  });

  it('filters by category', async () => {
    await mount();
    fireEvent.click(screen.getByRole('radio', { name: /^Input \(\d/ }));
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Input']);
    expect(screen.getByRole('button', { name: 'Show details for Form' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show details for Heading' })).toBeNull();
  });

  it('searches names and descriptions, then says so when nothing matches and clears', async () => {
    await mount();
    fireEvent.click(screen.getByRole('radio', { name: /^Input \(\d/ }));
    fireEvent.change(screen.getByLabelText('Search parts and features'), { target: { value: 'FORM' } });
    expect(screen.getByRole('button', { name: 'Show details for Form' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show details for Search box' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Search parts and features'), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing matches "zzz". Try another word.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect((screen.getByLabelText('Search parts and features') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Show details for Search box' })).toBeTruthy();
  });

  it('tells you how to make a feature when you have none', async () => {
    await mount([]);
    expect(screen.getByText('No features yet. Press New feature, or in Design select a part and choose Save as feature.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Layout \(\d/ }));
    expect(screen.queryByText(/No features yet/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Your features \(\d/ }));
    expect(screen.getByText(/No features yet/)).toBeTruthy();
  });

  it('shows a failed load in words and keeps the built-in parts', async () => {
    api.list.mockRejectedValue(new Error('The helper is not reachable.'));
    render(
      <MemoryRouter>
        <FeaturesPage />
      </MemoryRouter>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('not reachable');
    expect(screen.getByRole('button', { name: 'Show details for Heading' })).toBeTruthy();
  });

  it('opens the details sheet with Enter and gives focus back on Escape', async () => {
    await mount();
    const tile = screen.getByRole('button', { name: 'Show details for Table of records' });
    tile.focus();
    fireEvent.click(tile);
    const dialog = await screen.findByRole('dialog', { name: 'Table of records' });
    expect(within(dialog).getByText('Your records in rows and columns, with paging.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Use in app' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(tile).toBe(document.activeElement);
  });

  it('shows what a feature asks for in the sheet', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Show details for Number row' }));
    const dialog = await screen.findByRole('dialog', { name: 'Number row' });
    expect(within(dialog).getByText(/^(Not used in an app yet|Used in \d+ apps?)$/)).toBeTruthy();
    expect(within(dialog).getByText('Settings you fill in')).toBeTruthy();
  });

  it('opens Design with the entry chosen from Use in app', async () => {
    await mount();
    openMenu('Number tile');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use in app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use "Number tile" in an app' });
    await waitFor(() => expect((within(dialog).getByLabelText('App') as HTMLSelectElement).value).toBe('a1'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Design' }));
    const where = (await screen.findByTestId('where')).textContent ?? '';
    expect(where.startsWith('/apps/a1/design|')).toBe(true);
    expect(JSON.parse(where.split('|')[1])).toEqual({ stepFocus: true, addEntry: 'part:StatCard' });
  });

  it('sends a saved feature by its key and skips apps that do not load', async () => {
    api.listApps.mockResolvedValue([app('bad', 'Broken app', false), app('a2', 'Second app')]);
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Show details for Number row' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Number row' })).getByRole('button', { name: 'Use in app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use "Number row" in an app' });
    await waitFor(() => expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['Second app']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open Design' }));
    const where = (await screen.findByTestId('where')).textContent ?? '';
    expect(where).toContain('/apps/a2/design');
    expect(where).toContain('feature:kpi_row');
  });

  it('asks for an app first when there are none', async () => {
    api.listApps.mockResolvedValue([]);
    await mount();
    openMenu('Heading');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Use in app' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Make an app first on the Apps page.')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Go to Apps' }).getAttribute('href')).toBe('/apps');
  });

  it('keeps the menu order: Details, Use in app, then Edit, Duplicate, Export, Delete for your own', async () => {
    await mount();
    openMenu('Heading');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Details', 'Use in app']);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    openMenu('Number row');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Details', 'Use in app', 'Edit', 'Duplicate', 'Export', 'Delete']);
  });

  it('duplicates a feature and reloads', async () => {
    api.duplicate.mockResolvedValue(seedRecords()[0]);
    await mount();
    openMenu('Number row');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(api.duplicate).toHaveBeenCalledWith('kpi_row'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('exports a feature as a file', async () => {
    await mount();
    openMenu('Number row');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }));
    expect(api.download).toHaveBeenCalledWith('kpi_row.feature.json', expect.objectContaining({ feature: expect.objectContaining({ id: 'kpi_row' }) }));
  });

  it('opens the builder on the feature when Edit is chosen', async () => {
    await mount();
    openMenu('Number row');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/features/kpi_row/edit|null');
  });

  it('has a New feature button before Import a feature that opens an empty builder', async () => {
    await mount();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    expect(buttons.indexOf('New feature')).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf('New feature')).toBeLessThan(buttons.indexOf('Import a feature'));
    fireEvent.click(screen.getByRole('button', { name: 'New feature' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/features/new|null');
  });

  it('deletes after confirmation', async () => {
    api.remove.mockResolvedValue(undefined);
    await mount();
    openMenu('Number row');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete feature' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('kpi_row'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('says the server refusal of a delete in one plain sentence', async () => {
    const err = new StudioApiError('In use.', 409, 'feature_in_use');
    err.inUse = { apps: [{ id: 'a1', name: 'Crew Roster' }], features: [{ id: 'other', label: 'Other feature' }] };
    api.remove.mockRejectedValue(err);
    await mount();
    openMenu('Number row');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete feature' }));
    const alert = await screen.findByText('Number row is used by Crew Roster and Other feature (feature). Remove it there first.');
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('does not offer Delete for a feature that apps use, and says where it is used (P-39)', async () => {
    const used = seedRecords();
    used[0] = { ...used[0], usedBy: { apps: [{ id: 'a1', name: 'Crew Roster' }], features: [] } };
    await mount(used);
    openMenu('Number row');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((await screen.findByRole('alert')).textContent).toBe('Number row is used by Crew Roster. Remove it there first.');
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('imports a file and reports renamed features', async () => {
    api.importFile.mockResolvedValue({ imported: [seedRecords()[0]], renamed: [{ from: 'kpi_row', to: 'kpi_row_2' }] });
    await mount();
    const file = new File([JSON.stringify({ format: 'x' })], 'f.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('feature-file'), { target: { files: [file] } });
    await waitFor(() => expect(api.importFile).toHaveBeenCalledWith({ format: 'x' }));
    expect(await screen.findByText('Imported "Number row". Renamed: kpi_row is now kpi_row_2.')).toBeTruthy();
  });

  it('refuses a file that is not JSON without calling the server', async () => {
    await mount();
    fireEvent.change(screen.getByTestId('feature-file'), { target: { files: [new File(['nope'], 'f.json')] } });
    expect((await screen.findByRole('alert')).textContent).toBe('That file is not a feature file. Pick a feature file exported from Local App Studio.');
    expect(api.importFile).not.toHaveBeenCalled();
  });

  it('says a refused import in one sentence with each problem once in a fold (P-36)', async () => {
    const issue = { path: 'fragment', code: 'unknown_part', message: 'There is no part "chart_1" in the fragment.' };
    const err = new StudioApiError('There is no part "chart_1" in the fragment. There is no part "chart_1" in the fragment.', 400, 'invalid_feature', [issue, { ...issue, path: 'fragment.a' }, issue]);
    api.importFile.mockRejectedValue(err);
    await mount();
    fireEvent.change(screen.getByTestId('feature-file'), { target: { files: [new File(['{}'], 'f.json')] } });
    const sentence = await screen.findByText('This feature file has problems, so nothing was imported. Ask the person who sent it for a new export.');
    expect(sentence.getAttribute('role')).toBe('alert');
    expect(screen.queryByText(/chart_1" in the fragment\. There is no part/)).toBeNull();
    const fold = screen.getByText('Show what is wrong').closest('details') as HTMLElement;
    expect(within(fold).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['This feature did not work with sample rows.']);
    // P-38: the message is brought into view and takes focus
    await waitFor(() => expect(document.activeElement?.contains(sentence)).toBe(true));
    // The focused box is a named group with a visible focus ring, so its alert is not read twice.
    expect(document.activeElement?.getAttribute('role')).toBe('group');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Messages');
    expect(document.activeElement?.className).not.toContain('focus-visible:outline-hidden focus-visible:ring-0');
    expect(document.activeElement?.className).toContain('focus-visible:ring-2');
  });

  it('lists a damaged import in plain sentences, never a path, a part or a developer word', async () => {
    const issues = [
      { path: 'label', code: 'invalid_feature', message: 'The label is 1 to 40 characters on one line, with no leading or trailing space.' },
      { path: 'fragment.children.0', code: 'invalid_fragment', message: 'Part id "x1" is used twice in the fragment.' },
      { path: 'bindings.1', code: 'invalid_binding', message: 'There is no part "x2" in the fragment.' },
      { path: 'pages.2.layout.children.0.props.source', code: 'unbound_slot', message: 'DataTable keeps the source "open_crews" from the app it came from.' },
    ];
    api.importFile.mockRejectedValue(new StudioApiError('invalid', 400, 'invalid_feature', issues));
    await mount();
    fireEvent.change(screen.getByTestId('feature-file'), { target: { files: [new File(['{}'], 'f.json')] } });
    await screen.findByText('Show what is wrong');
    const fold = screen.getByText('Show what is wrong').closest('details') as HTMLElement;
    const lines = within(fold).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(lines).toEqual(['Give the feature a name.', 'This feature did not work with sample rows.', 'Some parts still need a table slot.']);
    for (const line of lines) expect(line).not.toMatch(/fragment|binding|x1|x2|open_crews|\bid\b/);
  });

  it('says a feature that is already in the library was not added again (P-37)', async () => {
    api.importFile.mockResolvedValue({ imported: [seedRecords()[0]], renamed: [] });
    await mount();
    fireEvent.change(screen.getByTestId('feature-file'), { target: { files: [new File([JSON.stringify({ format: 'x' })], 'f.json')] } });
    expect(await screen.findByText('Number row is already in your library. Nothing was added.')).toBeTruthy();
  });

  it('shows counts in the headings, sub-group headings and chips', async () => {
    await mount();
    const data = screen.getByRole('region', { name: 'Records' });
    expect(within(data).getByRole('heading', { level: 3 }).textContent).toMatch(/^Records \(\d+\)$/);
    expect(within(data).getByRole('heading', { level: 4, name: /^Show \(\d+\)$/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'All (33)' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Navigation \(4\)$/ })).toBeTruthy();
  });

  it('finds Table of records first for "spreadsheet", highlights the name match and keeps the view in the address', async () => {
    await mount(seedRecords(), '/features?q=table');
    const first = screen.getAllByTestId('feature-tile')[0];
    expect(first.getAttribute('data-entry-key')).toBe('part:DataTable');
    expect(first.querySelector('mark')?.textContent).toBe('Table');
    expect((screen.getByLabelText('Search parts and features') as HTMLInputElement).value).toBe('table');
    expect(screen.getByRole('radio', { name: /^All \(\d+\)$/ })).toBeTruthy();
  });

  it('reads the category and order from the address and falls back on bad values', async () => {
    await mount(seedRecords(), '/features?cat=input&sort=az');
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Input']);
    expect((screen.getByLabelText('Order') as HTMLSelectElement).value).toBe('az');
    cleanup();
    await mount(seedRecords(), '/features?cat=nope&sort=nope');
    expect(screen.getAllByRole('region').length).toBe(6);
    expect((screen.getByLabelText('Order') as HTMLSelectElement).value).toBe('default');
  });

  it('writes the view to the address while you type', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Search parts and features'), { target: { value: 'form' } });
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'az' } });
    expect(screen.getByTestId('features-count').textContent).toMatch(/shown$/);
    expect((screen.getByLabelText('Search parts and features') as HTMLInputElement).value).toBe('form');
    expect((screen.getByLabelText('Order') as HTMLSelectElement).value).toBe('az');
  });

  it('focuses the search with / (not inside a field) and clears it with Escape', async () => {
    await mount(seedRecords(), '/features?q=form');
    const box = screen.getByLabelText('Search parts and features') as HTMLInputElement;
    (screen.getByLabelText('Order') as HTMLSelectElement).focus();
    fireEvent.keyDown(screen.getByLabelText('Order'), { key: '/' });
    expect(document.activeElement).not.toBe(box);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
  });

  it('shows Recently used only with no query and category All, skipping gone features', async () => {
    window.localStorage.setItem('app.studio.recentFeatures', JSON.stringify(['part:Text', 'feature:gone', 'part:Card', 'junk']));
    await mount();
    const row = screen.getByTestId('recent-row');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Text', 'Card']);
    fireEvent.change(screen.getByLabelText('Search parts and features'), { target: { value: 'text' } });
    expect(screen.queryByTestId('recent-row')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search parts and features'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: /^Input/ }));
    expect(screen.queryByTestId('recent-row')).toBeNull();
  });

  it('says how many apps use a saved feature', async () => {
    await mount();
    expect(within(screen.getByRole('region', { name: 'Your features' })).getAllByText('Not used in an app yet').length).toBeGreaterThan(0);
    cleanup();
    const used = seedRecords();
    used[0] = { ...used[0], usedBy: { apps: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], features: [] } };
    await mount(used);
    expect(within(screen.getByRole('region', { name: 'Your features' })).getByText('Used in 2 apps')).toBeTruthy();
  });
  it('shows how many match as "N shown" in the same words as the shelf', async () => {
    await mount();
    expect(screen.getByTestId('features-count').textContent).toMatch(/^\d+ shown$/);
    fireEvent.change(screen.getByLabelText('Search parts and features'), { target: { value: 'zzz' } });
    expect(screen.getByTestId('features-count').textContent).toBe('0 shown');
  });

  it('says what is wrong with a damaged feature and removes it with Delete feature', async () => {
    api.remove.mockResolvedValue(undefined);
    const broken = seedRecords().map((r, i) =>
      i === 0 ? { ...r, ok: false, fragment: null, issues: [{ path: 'tables.0.fields.1.id', code: 'invalid', message: 'Invalid input' }] } : r,
    );
    await mount(broken);
    fireEvent.click(screen.getByRole('button', { name: `Show details for ${broken[0].label}` }));
    const dialog = await screen.findByRole('dialog', { name: broken[0].label });
    expect(within(dialog).getByText(/^This feature is damaged, so it cannot be added\./)).toBeTruthy();
    expect(within(dialog).queryByText(/tables\.0|Invalid input/)).toBeNull();
    expect((within(dialog).getByRole('button', { name: 'Use in app' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete feature' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByRole('button', { name: 'Keep feature' })).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete feature' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(broken[0].id));
  });

  it('offers Try again next to a load error', async () => {
    api.list.mockRejectedValueOnce(new Error('Could not load your features. Try again.'));
    api.list.mockResolvedValue(seedRecords());
    render(
      <MemoryRouter initialEntries={['/features']}>
        <Routes>
          <Route path="/features" element={<FeaturesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe('Could not load your features. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Layout' })).toBeTruthy();
  });

  it('sets the page title and has a Help button', async () => {
    await mount();
    expect(document.title).toBe('Features, Local App Studio');
    expect(screen.getByRole('button', { name: 'Help' })).toBeTruthy();
  });
});
