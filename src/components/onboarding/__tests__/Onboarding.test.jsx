import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Onboarding from '../Onboarding';
import OnboardingFlow from '../OnboardingFlow';
import { lsKey } from '../../../utils/storageKeys';

vi.mock('../../../services/profileService', () => ({
  profileService: { get: vi.fn(), update: vi.fn() },
}));
vi.mock('../../../services/stateService', () => ({
  stateService: {
    get: vi.fn(async () => undefined),
    getAll: vi.fn(async () => ({})),
    put: vi.fn(async () => undefined),
  },
}));
vi.mock('../../../services/aiSettingsService', () => ({
  aiSettingsService: { setup: vi.fn(), pull: vi.fn() },
}));
import { profileService } from '../../../services/profileService';
import { aiSettingsService } from '../../../services/aiSettingsService';
import { stateService } from '../../../services/stateService';
import { __resetPullStoreForTests } from '../../../hooks/ollamaPullStore';

const NOT_ONBOARDED = { displayName: null, onboardedAt: null };

function renderOnboarding() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Onboarding />
    </QueryClientProvider>,
  );
}

const dialog = () => screen.findByRole('dialog', { name: 'Welcome to Local App Studio' });

const setupState = (over = {}) => ({
  ollama: 'missing',
  host: 'http://127.0.0.1:11434',
  version: null,
  models: [],
  ready: false,
  ramGb: 16,
  recommended: {
    tier: 'mid',
    ramGb: 16,
    primary: [{ name: 'qwen2.5:3b', downloadGb: 1.9, purpose: 'both', reason: 'Fits this computer.' }],
    optional: [],
  },
  canPull: true,
  ...over,
});

/** Welcome Continue, landing on the Assistant step. */
async function toAssistantStep(user) {
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('dialog', { name: 'Set up Assistant' });
}

beforeEach(() => {
  localStorage.clear();
  aiSettingsService.setup.mockResolvedValue(setupState());
  profileService.get.mockResolvedValue(NOT_ONBOARDED);
  profileService.update.mockImplementation(async (patch) => ({
    displayName: patch.displayName ?? null,
    onboardedAt: patch.onboarded ? '2026-10-04T00:00:00.000Z' : null,
  }));
});
afterEach(() => {
  cleanup();
  __resetPullStoreForTests();
  vi.clearAllMocks();
});

describe('Onboarding', () => {
  it('shows the welcome dialog with the privacy promise when not onboarded', async () => {
    renderOnboarding();
    const el = await dialog();
    expect(el).toHaveTextContent('Your data stays on this device');
    expect(el).toHaveTextContent('Nothing calls the internet unless you turn it on');
  });

  it('moves focus to the optional name field', async () => {
    renderOnboarding();
    await dialog();
    await waitFor(() => expect(screen.getByLabelText(/What should Local App Studio call you/)).toHaveFocus());
  });

  it('does not show when the server says onboarded', async () => {
    profileService.get.mockResolvedValue({ displayName: 'Sam', onboardedAt: '2026-01-01T00:00:00.000Z' });
    renderOnboarding();
    await waitFor(() => expect(profileService.get).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not flash when only the local cache says onboarded', async () => {
    localStorage.setItem(
      lsKey('profile'),
      JSON.stringify({ displayName: null, onboardedAt: '2026-01-01T00:00:00.000Z' }),
    );
    renderOnboarding();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(profileService.get).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('saves the display name and marks onboarded', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.type(screen.getByLabelText(/What should Local App Studio call you/), '  Sam  ');
    await toAssistantStep(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() =>
      expect(profileService.update).toHaveBeenCalledWith({ displayName: 'Sam', onboarded: true }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(localStorage.getItem(lsKey('profile')))).toMatchObject({ displayName: 'Sam' });
    expect(stateService.put).not.toHaveBeenCalled();
  });

  it('skip marks onboarded without a name', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.type(screen.getByLabelText(/What should Local App Studio call you/), 'Ignored');
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(profileService.update).toHaveBeenCalledWith({ onboarded: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Escape hides the dialog without marking onboarded', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(profileService.update).not.toHaveBeenCalled();
  });

  it('Escape does nothing once a name is typed, so input is not lost', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.type(screen.getByLabelText(/What should Local App Studio call you/), 'Sam');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/What should Local App Studio call you/)).toHaveValue('Sam');
    expect(profileService.update).not.toHaveBeenCalled();
  });

  it('never sends an empty displayName', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.type(screen.getByLabelText(/What should Local App Studio call you/), '   ');
    await toAssistantStep(user);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(profileService.update).toHaveBeenCalledWith({ onboarded: true }));
  });

  it('does not show onboarding when the first load fails with no cache', async () => {
    profileService.get.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    renderOnboarding();
    await waitFor(() => expect(profileService.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('syncs a locally saved profile to the server on the next load, local winning', async () => {
    localStorage.setItem(
      lsKey('profile'),
      JSON.stringify({ displayName: 'Local', onboardedAt: '2026-02-01T00:00:00.000Z', pendingSync: true }),
    );
    profileService.get.mockResolvedValue({ displayName: 'Stale', onboardedAt: null });
    renderOnboarding();
    await waitFor(() =>
      expect(profileService.update).toHaveBeenCalledWith({ displayName: 'Local', onboarded: true }),
    );
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(lsKey('profile'))).pendingSync).toBeUndefined(),
    );
  });

  it('flags a failed save as pending sync', async () => {
    profileService.update.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }));
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(lsKey('profile'))).pendingSync).toBe(true),
    );
  });

  it('keeps working when profile storage is unavailable (503)', async () => {
    profileService.get.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }));
    profileService.update.mockRejectedValue(Object.assign(new Error('unavailable'), { status: 503 }));
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(localStorage.getItem(lsKey('profile'))).onboardedAt).toEqual(expect.any(String));
  });
});

describe('Onboarding Assistant step', () => {
  it('comes after the name step and finishes onboarding', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const step = await screen.findByRole('dialog', { name: 'Set up Assistant' });
    expect(step).toHaveTextContent('free app called Ollama');
    expect(screen.getByRole('link', { name: /Get Ollama/ })).toHaveAttribute(
      'href',
      'https://ollama.com/download',
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    // One forward button: Skip while Assistant is not ready, never a disabled Finish beside it.
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('dialog', { name: 'Welcome to Local App Studio' })).toBeInTheDocument();
    expect(profileService.update).not.toHaveBeenCalled();
  });

  it('moves focus to the step intro and describes the dialog with it', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const step = await screen.findByRole('dialog', { name: 'Set up Assistant' });
    const intro = screen.getByText(/Assistant is Local App Studio's built-in AI helper/);
    await waitFor(() => expect(intro).toHaveFocus());
    expect(intro).toHaveAttribute('tabindex', '-1');
    expect(step).toHaveAttribute('aria-describedby', intro.id);
    expect(step.getAttribute('aria-describedby')).toBeTruthy();
    // The description is the intro only, not the whole setup card.
    expect(document.getElementById(intro.id)).not.toContainElement(
      screen.getByRole('link', { name: /Get Ollama/ }),
    );
  });

  it('shows Finish as the single primary forward button once Assistant is ready', async () => {
    aiSettingsService.setup.mockResolvedValue(
      setupState({ ollama: 'running', ready: true, models: [{ name: 'qwen2.5:3b' }] }),
    );
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/Assistant is ready/);
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(profileService.update).toHaveBeenCalledWith({ onboarded: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('holds Back and the forward button, with a linked hint, while a download runs', async () => {
    aiSettingsService.setup.mockResolvedValue(setupState({ ollama: 'running' }));
    aiSettingsService.pull.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderOnboarding();
    await dialog();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Download model qwen2.5:3b' }));
    await screen.findByRole('progressbar');
    const hint = screen.getByText('Finish or cancel the download to continue');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    const forward = screen.getByRole('button', { name: 'Skip for now' });
    expect(forward).toBeDisabled();
    expect(forward).toHaveAttribute('aria-describedby', hint.id);
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip for now' })).toBeEnabled());
    expect(screen.queryByText('Finish or cancel the download to continue')).toBeNull();
  });
});

describe('OnboardingFlow assistantOnly (the first press of Assistant in a built app)', () => {
  function renderAssistantOnly(props = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <OnboardingFlow assistantOnly onDone={props.onDone} onDismiss={props.onDismiss} />
      </QueryClientProvider>,
    );
  }

  it('opens on Set up Assistant with no Welcome step and no Back button', async () => {
    renderAssistantOnly({ onDone: vi.fn(), onDismiss: vi.fn() });
    await screen.findByRole('dialog', { name: 'Set up Assistant' });
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByLabelText(/What should Local App Studio call you/)).toBeNull();
  });

  it('Skip for now calls onDone and saves no profile', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderAssistantOnly({ onDone, onDismiss: vi.fn() });
    await screen.findByRole('dialog', { name: 'Set up Assistant' });
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(profileService.update).not.toHaveBeenCalled();
  });

  it('Escape closes it through onDismiss', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    renderAssistantOnly({ onDone: vi.fn(), onDismiss });
    await screen.findByRole('dialog', { name: 'Set up Assistant' });
    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
