import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import { btnPrimary, btnSecondary } from '@/components/shared/formStyles.js';
import { baseSpec } from '../../__tests__/fixtures';
import { PAGE_NOT_IN_MENU, PAGE_OPENS_FROM_LIST } from '../PromptBullets';
import ProposalReview, { ASKED_BEFORE, ASKED_FOR } from '../ProposalReview';
import type { ProposalReviewProps } from '../ProposalReview';

afterEach(cleanup);

const withExtraPage = (): AppSpec => {
  const next = structuredClone(baseSpec());
  next.pages.push({ id: 'extra', title: 'Extra', route: '/extra', sources: [], layout: { id: 'root_extra', type: 'Page', props: {}, children: [] } });
  return next;
};

const show = (over: Partial<ProposalReviewProps> = {}) => {
  const props: ProposalReviewProps = {
    mode: 'create',
    before: baseSpec(),
    proposal: withExtraPage(),
    fallbacks: [],
    instruction: null,
    needs: [],
    applying: false,
    applyError: null,
    onUse: vi.fn(),
    onUseAndTry: vi.fn(),
    onRetry: vi.fn(),
    onExit: vi.fn(),
    ...over,
  };
  render(
    <MemoryRouter>
      <ProposalReview {...props} />
    </MemoryRouter>,
  );
  return props;
};

describe('ProposalReview', () => {
  it('names the features used, from the markers, and says nothing without them', () => {
    const proposal = withExtraPage();
    proposal.pages[1].layout.children = [
      { id: 'kpi_1', type: 'Section', name: 'Number row', props: {}, children: [], feature: { id: 'kpi_row', version: 1, params: {} } },
    ];
    show({ proposal });
    expect(screen.getByText('Uses your features: Number row.')).toBeTruthy();
    expect(screen.getByText(/^Extra: the feature Number row/)).toBeTruthy();
    expect(screen.getByText('Extra shows your feature Number row. It is not in the menu.')).toBeTruthy();
    cleanup();
    show();
    expect(screen.queryByText(/Uses your features/)).toBeNull();
  });

  it('shows the proposed look when it differs from the base, and nothing otherwise', () => {
    const proposal = withExtraPage();
    proposal.theme = { preset: 'forest', radius: 'md', id: 'forest' };
    show({ proposal });
    expect(screen.getByText('Look: Forest.')).toBeTruthy();
    expect(screen.getByText('Look: Forest')).toBeTruthy();
    cleanup();
    const before = baseSpec();
    before.theme = { preset: 'forest', radius: 'md', id: 'forest' };
    show({ before, proposal, mode: 'edit' });
    expect(screen.queryByText(/^Look:/)).toBeNull();
    cleanup();
    show();
    expect(screen.queryByText(/^Look:/)).toBeNull();
  });

  it('shows the bullets first, and the headline, a line per table and page and the menu tag behind Show everything', () => {
    show();
    expect(screen.getByText('Crew Roster has 2 pages and 1 table. No page shows Crews yet.')).toBeTruthy();
    expect(screen.getByText('Crews: Name, Size, Status').getAttribute('title')).toBe('Crews: Name (text), Size (whole number), Status (choice)');
    expect(screen.getByText('Extra has words only. It is not in the menu.')).toBeTruthy();
    const fold = screen.getByText('Show everything').closest('details') as HTMLElement;
    expect(fold.textContent).toContain('1 table and 2 pages.');
    expect(fold.textContent).toContain('Crews: Name (text), Size (whole number), Status (choice)');
    expect(screen.getByText('1 table and 2 pages.')).toBeTruthy();
    expect(screen.getByText('Crews: 3 fields (Name, Size, Status)')).toBeTruthy();
    expect(screen.getByText(/^Extra: /)).toBeTruthy();
    expect(screen.getByText(PAGE_NOT_IN_MENU)).toBeTruthy();
    expect(PAGE_NOT_IN_MENU).toBe('. It is not in the menu bar.');
    expect(fold.textContent).toContain('Extra: words only, nothing that shows or adds records. It is not in the menu bar.');
  });

  it('tags a page that opens from a list instead of the menu tag', () => {
    const proposal = withExtraPage();
    proposal.pages.push({ id: 'crew', title: 'Crew', route: '/crews/:id', sources: [], layout: { id: 'root_crew', type: 'Page', props: {}, children: [] } });
    show({ proposal });
    expect(screen.getByText(PAGE_OPENS_FROM_LIST)).toBeTruthy();
    expect(PAGE_OPENS_FROM_LIST).toBe('. It opens from a list.');
    expect(screen.getByText('Crew has words only. It opens from a list.')).toBeTruthy();
    // P17-20: the page line and its tag read as two sentences, not "recordsopens from a list".
    const fold = screen.getByText('Show everything').closest('details') as HTMLElement;
    expect(fold.textContent).toContain('Crew: words only, nothing that shows or adds records. It opens from a list.');
    expect(fold.textContent).not.toContain('recordsopens');
  });

  it('says a part that cannot connect right after its page', () => {
    show({ needs: [{ pageId: 'extra', pageTitle: 'Extra', layerId: 'c1', part: 'Checklist', text: 'needs a yes or no field' }] });
    const bullet = screen.getByText('Extra: a Checklist that needs a yes or no field');
    const page = screen.getByText('Extra has words only. It is not in the menu.');
    expect(page.compareDocumentPosition(bullet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('quotes the words the person asked with, cut at a word with "..." near 300 characters (P17-19)', () => {
    show({ instruction: `A crew roster ${'word '.repeat(100)}` });
    expect(screen.getByText('You asked for:')).toBeTruthy();
    const quote = screen.getByText(/^A crew roster word/).textContent ?? '';
    expect(quote.endsWith('word...')).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(303);
    expect(quote.length).toBeGreaterThan(290);
    cleanup();
    show({ instruction: 'A crew roster' });
    expect(screen.getByText('A crew roster').tagName).toBe('Q');
    cleanup();
    show();
    expect(screen.queryByText('You asked for:')).toBeNull();
    expect(ASKED_FOR).toBe('You asked for: ');
  });

  it('shows only the newest ask as "You asked for" and the earlier asks under "Asked before" (P17-04)', () => {
    show({ mode: 'edit', instruction: 'A crew roster', asks: ['Add a Size field to Crews', 'Add an Extra page'], replaced: baseSpec() });
    expect(screen.getByText('You asked for:')).toBeTruthy();
    expect(screen.getByText('Add an Extra page').tagName).toBe('Q');
    expect(screen.getByText('Asked before:')).toBeTruthy();
    expect(screen.getByText('Add a Size field to Crews').tagName).toBe('Q');
    expect(screen.queryByText('A crew roster')).toBeNull();
    expect(ASKED_BEFORE).toBe('Asked before: ');
    cleanup();
    show({ mode: 'edit', instruction: 'A crew roster', asks: ['Add an Extra page'], replaced: baseSpec() });
    expect(screen.queryByText('Asked before:')).toBeNull();
  });

  it('judges the ask of an edit: Done by a matching change, the rest under It also changed (P17-02)', () => {
    show({ mode: 'edit', instruction: 'Add an Extra page.' });
    expect(screen.getByText('Done: Add an Extra page')).toBeTruthy();
    expect(screen.queryByText('It also changed')).toBeNull();
    expect(screen.queryByText('Nothing changed.')).toBeNull();
    expect(screen.queryByText('The helper did not do what you asked. Try other words, or do it yourself.')).toBeNull();
  });

  it('says Not done with a way to do it by hand, lists the side effects, and says the helper missed when every ask is missed', () => {
    const props = show({ mode: 'edit', instruction: 'Add a Phone field to Crews.' });
    expect(screen.getByText('Not done: Add a Phone field to Crews')).toBeTruthy();
    expect(screen.getByText('The helper did not do what you asked. Try other words, or do it yourself.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 4, name: 'It also changed' })).toBeTruthy();
    const alsoList = screen.getByRole('list', { name: 'It also changed' });
    expect(alsoList.textContent).toContain('Added the page Extra');
    // The side effect is in that list only, not repeated as a plain change bullet.
    expect(screen.getAllByText('Added the page Extra')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Do it on Data\. / }));
    expect(props.onExit).toHaveBeenCalledWith('data');
  });

  it('offers Design for a page or part and the Look tab for a look word', () => {
    const page = show({ mode: 'edit', instruction: 'Remove the Extra page.' });
    fireEvent.click(screen.getByRole('button', { name: /^Do it in Design\. / }));
    expect(page.onExit).toHaveBeenCalledWith('design');
    cleanup();
    const look = show({ mode: 'edit', instruction: 'Change the look to dark green.' });
    fireEvent.click(screen.getByRole('button', { name: /^Change the look in Design\. / }));
    expect(look.onExit).toHaveBeenCalledWith('look');
  });

  it('says Nothing changed, with the Not done lines and Try again, when the answer is the design it replaced', () => {
    show({ proposal: baseSpec(), mode: 'edit', instruction: 'Add a Phone field to Crews.' });
    expect(screen.getByText('Nothing changed.')).toBeTruthy();
    expect(screen.getByText('Not done: Add a Phone field to Crews')).toBeTruthy();
    expect(screen.getByText('The helper did not do what you asked. Try other words, or do it yourself.')).toBeTruthy();
    expect(screen.queryByText('The helper suggested no changes. Try other words.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
  });

  it('judges the newest ask against the design it replaced, and keeps Use this when that ask changed nothing', () => {
    show({ mode: 'create', instruction: 'A crew roster', asks: ['Add a chart'], replaced: withExtraPage() });
    expect(screen.getByText('Nothing changed.')).toBeTruthy();
    expect(screen.getByText('Not done: Add a chart')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeTruthy();
    cleanup();
    show({ mode: 'create', instruction: 'A crew roster', asks: ['Add an Extra page'], replaced: baseSpec() });
    expect(screen.getByText('Done: Add an Extra page')).toBeTruthy();
    expect(screen.queryByText('Nothing changed.')).toBeNull();
  });

  it('says what was not made under the bullets of a first design, and only for a first design (P17-03)', () => {
    const prompt = 'Crews (name, size). A chart of crews by status. A menu button to add a crew. Clients (name).';
    show({ mode: 'create', instruction: prompt });
    const line = screen.getByText('Not made: a page for Crews, Clients, a chart, a menu button');
    const bullets = screen.getByText('Crew Roster has 2 pages and 1 table. No page shows Crews yet.');
    expect(bullets.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    show({ mode: 'edit', instruction: prompt });
    expect(screen.queryByText(/^Not made:/)).toBeNull();
    cleanup();
    show({ mode: 'create', instruction: 'Crews (name, size).' });
    expect(screen.getByText('Not made: a page for Crews')).toBeTruthy();
    expect(screen.queryByText(/Clients|chart|menu button/)).toBeNull();
  });

  it('says the changes of an edit as bullets, and adds the change count in the fold', () => {
    show({ mode: 'edit' });
    expect(screen.queryByText('Nothing changed.')).toBeNull();
    expect(screen.getByText('Added the page Extra')).toBeTruthy();
    expect(screen.getByText('1 page added')).toBeTruthy();
  });

  it('keeps everything behind a fold after the buttons, Use this first and the one primary', async () => {
    const props = show();
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Use this', 'Use this and try it', 'Try again']);
    expect(buttons[0].className).toContain(btnPrimary);
    expect(buttons[1].className).toContain(btnSecondary);
    const everything = screen.getByText('Show everything');
    expect(buttons[2].compareDocumentPosition(everything) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(everything);
    fireEvent.click(screen.getByText('Show every change'));
    expect(await screen.findByText(/Adds the page "?Extra/)).toBeTruthy();
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);
    expect(props.onUse).toHaveBeenCalledTimes(1);
    expect(props.onUseAndTry).toHaveBeenCalledTimes(1);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows removal warnings outside the toggle', () => {
    const gone = structuredClone(baseSpec());
    gone.tables = [];
    show({ proposal: gone });
    const warning = screen.getByRole('region', { name: 'Removal warning' });
    expect(warning.textContent).toContain('These changes remove or reshape data');
    expect(warning.textContent).toContain('Removes the table "Crews" and its data.');
    expect(warning.closest('details')).toBeNull();
    expect(warning.className).toContain('border-accent-red/40');
  });

  it('says no changes and offers only Try again', () => {
    show({ proposal: baseSpec() });
    expect(screen.getByText('The helper suggested no changes. Try other words.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this and try it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows fallback notes without links, the apply error and the busy label', () => {
    show({
      fallbacks: [{ part: 'page', pageId: 'extra', message: 'The model gave an invalid layout.' }],
      applyError: { message: 'Could not save.', issues: [] },
      applying: true,
    });
    expect(
      screen.getByText('Page Extra: The model gave an invalid layout. The helper could not make this part. After you press Use this, add it yourself in Design.'),
    ).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Could not save.')).toBeTruthy();
    // aria-disabled keeps focus on the button the person pressed; the click does nothing while it saves.
    const busy = screen.getByRole('button', { name: 'Saving...' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
  });

  it('ignores presses while applying and moves focus to the error when applying failed (R-2)', () => {
    const props = show({ applying: true });
    fireEvent.click(screen.getByRole('button', { name: 'Saving...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this and try it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onUse).not.toHaveBeenCalled();
    expect(props.onUseAndTry).not.toHaveBeenCalled();
    expect(props.onRetry).not.toHaveBeenCalled();
    cleanup();
    const failed = show({ applyError: { message: 'Could not save.', issues: [{ path: 'app.name', code: 'too_small', message: 'Too small: expected string to have >=1 characters' }] } });
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toBe('Could not save.');
    // The list of problems is part of that one alert, not a second one.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText(/App name: This needs at least 1 characters/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(failed.onUse).toHaveBeenCalledTimes(1);
  });
});
