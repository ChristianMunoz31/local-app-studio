import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataStorageSection from '../DataStorageSection';
import * as backupService from '../../../services/backupService';
import { STORAGE_MAP, groupStorageMap } from '../../../constants/storageMap';

vi.mock('../../../services/backupService', () => ({
  listBackups: vi.fn(),
  getBackupStatus: vi.fn(),
  createBackup: vi.fn(),
  updateBackupSettings: vi.fn(),
  uploadBackupFile: vi.fn(),
  restoreBackup: vi.fn(),
}));
vi.mock('../../../hooks/useAppInfo', () => ({ useAppInfo: () => ({ info: null }) }));
backupService.listBackups.mockResolvedValue({
  backups: [],
  status: { health: 'none' },
  settings: { keepDaily: 7, keepWeekly: 4, keepMonthly: 6 },
  location: '/data/backups',
  desktop: false,
});

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DataStorageSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = (label) => screen.getByText(label, { selector: 'p' }).closest('li');

afterEach(cleanup);

describe('DataStorageSection', () => {
  it('has no connection checks, sync mode radios, data browser link or reset', () => {
    renderSection();
    expect(screen.queryByRole('button', { name: 'Recheck' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Settings sync' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset Data & storage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse your data' })).not.toBeInTheDocument();
    expect(screen.queryByText(/database|sqlite/i)).not.toBeInTheDocument();
  });

  it('says where each kind of data is kept', () => {
    renderSection();
    expect(within(row('Settings')).getByText('On this computer')).toBeInTheDocument();
    expect(within(row('Assistant')).getByText('On this computer')).toBeInTheDocument();
    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
    expect(within(row('Update checks')).getByText('Online, if turned on')).toBeInTheDocument();
  });

  it('renders the subsections in order: where data lives, backups, export, import', () => {
    renderSection();
    const nodes = [
      screen.getByRole('heading', { name: 'Where your data lives' }),
      screen.getByRole('heading', { name: 'Backups' }),
      screen.getByRole('heading', { name: 'Export your data' }),
      screen.getByRole('heading', { name: 'Import data' }),
    ];
    for (let i = 0; i < nodes.length - 1; i += 1) {
      expect(nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

// Groups with no entries (nothing is kept only in this browser) are not rendered.
const shownGroups = () => groupStorageMap().filter((group) => group.items.length > 0);

describe('DataStorageSection layout and grouping', () => {
  const groupButtons = () =>
    screen.getAllByRole('heading', { level: 5 }).map((h) => within(h).getByRole('button'));
  const panelOf = (button) => document.getElementById(button.getAttribute('aria-controls'));

  it('renders each group heading with title, derived item count and description', () => {
    renderSection();
    const groups = shownGroups();
    const buttons = groupButtons();
    expect(buttons).toHaveLength(groups.length);
    groups.forEach((group, i) => {
      const n = group.items.length;
      expect(buttons[i]).toHaveAccessibleName(`${group.title} ${n} ${n === 1 ? 'item' : 'items'}`);
      expect(buttons[i]).toHaveAccessibleDescription(group.description);
    });
  });

  it('renders every STORAGE_MAP label inside exactly one group panel', () => {
    renderSection();
    const panels = groupButtons().map(panelOf);
    for (const entry of STORAGE_MAP) {
      const hits = panels.filter((panel) =>
        within(panel)
          .queryAllByRole('listitem')
          .some((li) => li.querySelector('p').textContent === entry.label),
      );
      expect(hits, entry.label).toHaveLength(1);
    }
  });

  it('puts each entry in the panel of its own group, sorted', () => {
    renderSection();
    const panels = groupButtons().map(panelOf);
    shownGroups().forEach((group, i) => {
      const labels = within(panels[i]).getAllByRole('listitem').map((li) => li.querySelector('p').textContent);
      expect(labels).toEqual(group.items.map((item) => item.label));
    });
  });

  it('defaults groups to expanded with visible panels', () => {
    renderSection();
    for (const button of groupButtons()) {
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(panelOf(button)).toBeVisible();
    }
  });

  it('points aria-controls at a unique panel id', () => {
    renderSection();
    const ids = groupButtons().map((b) => b.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(document.getElementById(id)).toBeInTheDocument());
  });

  it('collapses on Enter and expands again on Space from the keyboard', async () => {
    const user = userEvent.setup();
    renderSection();
    const button = groupButtons()[0];
    const panel = panelOf(button);
    button.focus();
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('hidden');
    expect(panel).not.toBeVisible();
    expect(button).toHaveFocus();

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
    expect(panel).toBeVisible();
  });

  it('toggles groups independently', async () => {
    const user = userEvent.setup();
    renderSection();
    const [first, second] = groupButtons();
    first.focus();
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(panelOf(second)).toBeVisible();
  });

  it('reaches group buttons via Tab', async () => {
    const user = userEvent.setup();
    renderSection();
    const first = groupButtons()[0];
    for (let i = 0; i < 20 && document.activeElement !== first; i += 1) {
      await user.tab();
    }
    expect(first).toHaveFocus();
  });

});
