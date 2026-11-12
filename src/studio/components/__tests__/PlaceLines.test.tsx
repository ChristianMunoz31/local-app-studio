import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseSpec } from '../../__tests__/fixtures';
import { block, gridSpec, three, tile } from '../../lib/__tests__/placeFixtures';
import { PlaceLines } from '../PromptBullets';
import ProposalReview from '../ProposalReview';
import type { ProposalReviewProps } from '../ProposalReview';

afterEach(cleanup);

const show = (over: Partial<ProposalReviewProps>) => {
  const props: ProposalReviewProps = {
    mode: 'edit',
    before: baseSpec(),
    proposal: baseSpec(),
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
};

describe('PlaceLines', () => {
  it('renders nothing for no lines', () => {
    const { container } = render(<PlaceLines lines={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a list named Places with a line each', () => {
    render(<PlaceLines lines={['Moved Chart to the top row', 'Placed Number tile at column 10, row 1, 3 columns wide']} />);
    const list = screen.getByRole('list', { name: 'Places' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Moved Chart to the top row', 'Placed Number tile at column 10, row 1, 3 columns wide']);
  });
});

describe('ProposalReview place lines', () => {
  it('shows the Places list after the ask result in an ask', async () => {
    const before = gridSpec(three());
    const proposal = gridSpec([...three(), tile('statcard_3', 'StatCard', block(1, 3, 5))]);
    show({ before, proposal, instruction: 'Add a tile.' });
    const list = await screen.findByRole('list', { name: 'Places' }, { timeout: 5000 });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Placed Number tile at column 1, row 5, 3 columns wide', 'Nothing moved on the grid']);
    const ask = screen.getByRole('list', { name: 'Your ask' });
    expect(ask.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Done: Add a tile')).toBeTruthy();
  });

  it('names the grid turned off by a stack ask', async () => {
    const before = gridSpec(three());
    const proposal = gridSpec(three().map((l) => ({ ...l, grid: undefined })), { free: false });
    show({ before, proposal, instruction: 'Stack these instead.' });
    const list = await screen.findByRole('list', { name: 'Places' }, { timeout: 5000 });
    expect(within(list).getByText('Turned off Place parts freely for Auto grid on Home')).toBeTruthy();
    expect(screen.getByText('Done: Stack these instead')).toBeTruthy();
    expect(screen.queryByText('It also changed')).toBeNull();
  });

  it('shows it in a create review of a page with a free grid, and not when there is none', async () => {
    const before = baseSpec();
    const proposal = gridSpec(three());
    show({ mode: 'create', before, proposal: Object.assign(proposal, { pages: [...proposal.pages, { ...structuredClone(proposal.pages[0]), id: 'board', title: 'Board', route: '/board' }] }) });
    const list = await screen.findByRole('list', { name: 'Places' }, { timeout: 5000 });
    expect(within(list).getByText('Placed 3 parts in a grid on Board')).toBeTruthy();
  });

  it('shows the Places list when the proposal equals the saved app but differs from the design it replaced', async () => {
    const stacked = gridSpec(three().map((l) => ({ ...l, grid: undefined })), { free: false });
    show({ mode: 'create', before: stacked, proposal: stacked, instruction: 'A crew roster', asks: ['Stack these instead.'], replaced: gridSpec(three()) });
    expect(screen.getByText('Done: Stack these instead')).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Places' }, { timeout: 5000 });
    expect(within(list).getByText('Turned off Place parts freely for Auto grid on Home')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('puts the Places list after the removal warning', async () => {
    const before = gridSpec(three());
    const proposal = gridSpec([...three(), tile('statcard_3', 'StatCard', block(1, 3, 5))]);
    proposal.tables = [];
    show({ before, proposal, instruction: 'Add a tile.' });
    const list = await screen.findByRole('list', { name: 'Places' }, { timeout: 5000 });
    const warning = screen.getByRole('region', { name: 'Removal warning' });
    expect(warning.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is absent when no place changed', () => {
    const before = gridSpec(three());
    const proposal = gridSpec(three());
    proposal.app.name = 'Orders';
    show({ before, proposal, instruction: 'Rename the app to Orders.' });
    expect(screen.queryByRole('list', { name: 'Places' })).toBeNull();
  });
});
