import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiSettingsService } from '@/services/aiSettingsService';
import { __resetPullStoreForTests } from '@/hooks/ollamaPullStore';
import HelperSetupCard from '../HelperSetupCard';

vi.mock('@/services/aiSettingsService', () => ({ aiSettingsService: { setup: vi.fn(), pull: vi.fn() } }));
const setupMock = vi.mocked(aiSettingsService.setup as unknown as (...a: unknown[]) => Promise<unknown>);
const pullMock = vi.mocked(aiSettingsService.pull as unknown as (...a: unknown[]) => Promise<unknown>);

const REC = { name: 'qwen2.5:3b', downloadGb: 1.9, purpose: 'both', reason: 'Small and quick.' };
const state = (over: Record<string, unknown> = {}) => ({
  ollama: 'running',
  models: [],
  ready: false,
  ramGb: 16,
  recommended: { tier: 'mid', ramGb: 16, primary: [REC], optional: [] },
  canPull: true,
  provider: 'ollama',
  ...over,
});

const renderCard = (props: { serverMessage?: string | null; onReady?: () => void; onSkip?: () => void; skipLabel?: string } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HelperSetupCard onReady={props.onReady ?? vi.fn()} serverMessage={props.serverMessage} onSkip={props.onSkip} skipLabel={props.skipLabel} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  setupMock.mockReset();
  pullMock.mockReset();
  __resetPullStoreForTests();
});
afterEach(() => {
  cleanup();
  __resetPullStoreForTests();
});

describe('HelperSetupCard', () => {
  it('explains Ollama and links to the download when it is missing', async () => {
    setupMock.mockResolvedValue(state({ ollama: 'missing' }));
    renderCard({ serverMessage: 'Ollama is not running.' });
    expect(await screen.findByText('Ollama is not installed. Install it, open it, then press Check again.')).toBeTruthy();
    expect(screen.getByText(/runs AI models on this computer/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Ollama is not running.');
    const link = screen.getByRole('link', { name: /Get Ollama/ });
    expect(link.getAttribute('href')).toBe('https://ollama.com/download');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each(['stopped', 'unreachable'])('says to open Ollama and folds the terminal line under Still not working when %s', async (ollama) => {
    setupMock.mockResolvedValue(state({ ollama }));
    renderCard();
    expect(await screen.findByText('Ollama is not running. Open Ollama from the Start menu, then press Check again.')).toBeTruthy();
    const summary = screen.getByText('Still not working?');
    const hint = summary.closest('details')?.querySelector('p') as HTMLElement;
    expect(hint.textContent).toContain('Open a terminal and run ollama serve, then press Check again.');
    expect(hint.querySelector('code')?.textContent).toBe('ollama serve');
  });

  it('has a plain title and offers to skip it, with the caller\'s words', async () => {
    setupMock.mockResolvedValue(state({ ollama: 'missing' }));
    const onSkip = vi.fn();
    renderCard({ onSkip, skipLabel: 'Start a blank app instead' });
    expect(await screen.findByRole('heading', { name: 'Set up the helper (Ollama)' })).toBeTruthy();
    expect(screen.getByText(/You can also skip it and build the app yourself\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a blank app instead' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('skips with the default words and shows no skip button without a handler', async () => {
    setupMock.mockResolvedValue(state({ ollama: 'missing' }));
    const first = renderCard({ onSkip: vi.fn() });
    expect(await screen.findByRole('button', { name: 'Build it yourself in Design' })).toBeTruthy();
    first.unmount();
    renderCard();
    await screen.findByText(/Ollama is not installed/);
    expect(screen.queryByRole('button', { name: /Build it yourself|blank app/ })).toBeNull();
  });

  it('Check again refetches the setup state and reports ready', async () => {
    setupMock.mockResolvedValueOnce(state({ ollama: 'stopped' }));
    setupMock.mockResolvedValue(state({ ready: true, models: ['qwen2.5:3b'] }));
    const onReady = vi.fn();
    renderCard({ onReady });
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(setupMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('offers the model download only as a button and never pulls by itself', async () => {
    setupMock.mockResolvedValue(state());
    renderCard();
    expect(await screen.findByRole('button', { name: 'Download model qwen2.5:3b' })).toBeTruthy();
    expect(screen.getByText(/Local App Studio needs a model to think with/)).toBeTruthy();
    expect(pullMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download model qwen2.5:3b' }));
    await waitFor(() => expect(pullMock).toHaveBeenCalledTimes(1));
  });
});
