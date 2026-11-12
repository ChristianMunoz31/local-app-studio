import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// F-19: a built app's Settings names no license and no update check; Studio's keeps them.
const get = vi.fn();
const list = vi.fn();
vi.mock('../../../services/networkService', () => ({ networkService: { get, set: vi.fn() } }));
vi.mock('../../../services/networkActivityService', () => ({ networkActivityService: { list } }));
vi.mock('../../../services/backupService', () => ({
  listBackups: vi.fn().mockResolvedValue({ backups: [], status: { health: 'none' }, settings: { keepDaily: 7, keepWeekly: 4, keepMonthly: 6 }, location: '/d', desktop: false }),
  getBackupStatus: vi.fn(),
  createBackup: vi.fn(),
  updateBackupSettings: vi.fn(),
  uploadBackupFile: vi.fn(),
  restoreBackup: vi.fn(),
}));
vi.mock('../../../hooks/useAppInfo', () => ({ useAppInfo: () => ({ info: { desktop: true } }) }));

const features = {
  features: [
    { id: 'updates', enabled: false, label: 'Update check', description: 'Asks GitHub whether a newer release exists.', hosts: ['api.github.com'] },
    { id: 'license', enabled: false, label: 'License activation', description: 'Contacts Gumroad or Lemon Squeezy in Settings > License.', hosts: ['api.gumroad.com'] },
    { id: 'cloudAi', enabled: false, label: 'Cloud AI provider', description: 'Sends prompts to a provider.', hosts: ['api.example.com'] },
  ],
};

async function renderAll(shell) {
  vi.resetModules();
  vi.doMock('../../../modules', () => ({ MODULE_SHELL: shell }));
  const { default: NetworkSection } = await import('../NetworkSection');
  const { default: NetworkActivityPanel } = await import('../NetworkActivityPanel');
  const { default: VerifyYourself } = await import('../VerifyYourself');
  const { default: DataStorageSection } = await import('../DataStorageSection');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NetworkSection />
        <NetworkActivityPanel />
        <VerifyYourself />
        <DataStorageSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockResolvedValue(features);
  list.mockResolvedValue({ entries: [], nextBefore: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Settings words for features a built app does not have', () => {
  it('leaves out license and update words in a built app', async () => {
    const { container } = await renderAll({ kitSettings: [], hiddenNetworkFeatures: ['license', 'updates'] });
    await screen.findByText('Cloud AI provider', {}, { timeout: 5000 });
    await screen.findByText(/hasn.t connected to the internet/, {}, { timeout: 5000 });
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/license|update check|updates|github|gumroad|lemon/i);
  });

  it('keeps a hidden feature that is switched on, so it can be switched off', async () => {
    get.mockResolvedValue({ features: features.features.map((f) => (f.id === 'updates' || f.id === 'license' ? { ...f, enabled: true } : f)) });
    const { container } = await renderAll({ kitSettings: [], hiddenNetworkFeatures: ['license', 'updates'] });
    await screen.findByText('License activation', {}, { timeout: 5000 });
    expect(screen.getByText('Update check')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /License activation/ })).toBeChecked();
    expect((await screen.findAllByText(/like update checks/, {}, { timeout: 5000 })).length).toBeGreaterThan(0);
    expect(container.textContent ?? '').toMatch(/like update checks/);
  });

  it('keeps them in Studio', async () => {
    const { container } = await renderAll(null);
    await screen.findByText('License activation', {}, { timeout: 5000 });
    await screen.findByText(/hasn.t connected to the internet/, {}, { timeout: 5000 });
    const text = container.textContent ?? '';
    expect(text).toMatch(/Update check/);
    expect(text).toMatch(/Gumroad or Lemon Squeezy/);
    expect(text).toMatch(/like update checks/);
  });

  it('names no Local App Studio in the Network, Network activity and Verify yourself words of a built app (L-6)', async () => {
    const { container } = await renderAll({ kitSettings: [], hiddenNetworkFeatures: ['license', 'updates'] });
    await screen.findByText('Cloud AI provider', {}, { timeout: 5000 });
    await screen.findByText(/hasn.t connected to the internet/, {}, { timeout: 5000 });
    // The three sections come before Data & storage, whose backup words are outside this finding.
    const text = (container.textContent ?? '').split('Data & storage')[0];
    expect(text).toMatch(/Verify|These checks work on your own computer/);
    expect(text).not.toMatch(/Local App Studio|Local-App-Studio|local-app-studio/);
    expect(text).toMatch(/This app hasn.t connected to the internet/);
    expect(text).toMatch(/See what this app connected to/);
    expect(screen.queryByText('Check your download')).toBeNull();
    expect(screen.getByText('See what this app connected to').closest('li')).toHaveAttribute('value', '3');
  });

  it('words a built app as this app when its shell hides no network feature (a shell is the signal, not a hidden list)', async () => {
    const { container } = await renderAll({ kitSettings: [] });
    await screen.findByText('Cloud AI provider', {}, { timeout: 5000 });
    await screen.findByText(/hasn.t connected to the internet/, {}, { timeout: 5000 });
    const text = (container.textContent ?? '').split('Data & storage')[0];
    expect(text).not.toMatch(/Local App Studio|Local-App-Studio|local-app-studio/);
    expect(text).toMatch(/This app makes no internet calls on its own/);
    expect(text).toMatch(/This app hasn.t connected to the internet/);
    expect(text).toMatch(/The window of this app uses msedgewebview2\.exe/);
    expect(text).toMatch(/the process of this app.s local server/);
    expect(screen.queryByText('Check your download')).toBeNull();
    // Nothing is hidden, so the licence and update rows stay.
    expect(screen.getByText('License activation')).toBeInTheDocument();
    expect(screen.getByText('Update check')).toBeInTheDocument();
  });

  it('keeps the Local App Studio words in Studio (L-6)', async () => {
    const { container } = await renderAll(null);
    await screen.findByText('License activation', {}, { timeout: 5000 });
    await screen.findByText(/hasn.t connected to the internet/, {}, { timeout: 5000 });
    const text = container.textContent ?? '';
    expect(text).toMatch(/Local App Studio hasn.t connected to the internet/);
    expect(text).toMatch(/local-app-studio-server\.exe/);
    expect(screen.getByText('Check your download')).toBeInTheDocument();
  });

  it('names no Local App Studio in Data and storage or Backups of a built app, and keeps it in Studio (phase 27 LOW)', async () => {
    async function dataAndStorage(shell) {
      vi.resetModules();
      vi.doMock('../../../modules', () => ({ MODULE_SHELL: shell }));
      const { default: DataStorageSection } = await import('../DataStorageSection');
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <DataStorageSection />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      // The retention form and the intro sentence only show once the backups have loaded.
      await screen.findByText(/keeps the newest backup/, {}, { timeout: 5000 });
      return view.container;
    }
    const built = await dataAndStorage({ kitSettings: [] });
    const builtText = built.textContent ?? '';
    expect(builtText).toMatch(/Data & storage/);
    expect(builtText).toMatch(/Saved in this app's data file on this computer/);
    expect(builtText).toMatch(/Bring in data from an export of this app/);
    expect(builtText).toMatch(/This app saves a backup file of your data on this computer about once a day/);
    expect(builtText).toMatch(/This app keeps the newest backup/);
    expect(builtText).not.toMatch(/Local App Studio/);
    cleanup();
    const studio = await dataAndStorage(null);
    const studioText = studio.textContent ?? '';
    expect(studioText).toMatch(/Saved in Local App Studio's data file on this computer/);
    expect(studioText).toMatch(/Bring in data from a Local App Studio export/);
    expect(studioText).toMatch(/Local App Studio saves a backup file of your data on this computer about once a day/);
    expect(studioText).toMatch(/Local App Studio keeps the newest backup/);
  });

  it('words the backup sentences and the restore defaults as this app in a built app', async () => {
    vi.resetModules();
    vi.doMock('../../../modules', () => ({ MODULE_SHELL: { kitSettings: [] } }));
    const { statusSentence, noticeSentence } = await import('../backupStatusText');
    const sentences = [
      statusSentence({ health: 'failing', autoEnabled: true }),
      statusSentence({ recoveryRequired: true }),
      noticeSentence({ health: 'none', autoEnabled: true }),
      noticeSentence({ health: 'none', autoEnabled: false }),
    ];
    for (const sentence of sentences) expect(sentence).not.toMatch(/Local App Studio/);
    expect(sentences[0]).toBe('The last backup did not finish. This app will try again.');
    expect(sentences[1]).toBe('This app could not finish undoing the restore. Your data is safe. Restart this app to finish recovering it.');
    expect(sentences[2]).toBe("This app hasn't made a backup yet. It will make one soon.");
  });
});
