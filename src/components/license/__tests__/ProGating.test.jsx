// Pro entry points in the UI: a free user sees ProTrialPrompt in place of the Pro action
// (a small harness with the reserved example_pro capability), a Pro user never does, nothing flashes while the license
// status is loading, a 403 pro_required from the server shows the same prompt (never a raw error),
// and page advice is never blocked. Uses the real useEntitlements on a mocked license service.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssistantPanel from '../../assistant/AssistantPanel';
import ProGateNotice from '../ProGateNotice';
import { isProRequiredError } from '../../../utils/apiError';
import Onboarding from '../../onboarding/Onboarding';
import { ToastProvider } from '../../../contexts/ToastContext';
import { EMPTY_AGENT } from '../../assistant/timeline';
import { useEntitlements } from '../../../hooks/useEntitlements';

const h = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../../../services/licenseService', () => ({
  licenseService: { get: vi.fn(), dismissTrialNotice: vi.fn() },
}));
vi.mock('../../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: null, loading: false, error: null }),
}));
vi.mock('../../../services/profileService', () => ({
  profileService: { get: vi.fn(async () => ({ displayName: null, onboardedAt: null })), update: vi.fn() },
}));
vi.mock('../../../services/stateService', () => ({
  stateService: { get: vi.fn(async () => undefined), getAll: vi.fn(async () => ({})), put: vi.fn(async () => undefined) },
}));
vi.mock('../../../services/aiSettingsService', () => ({
  aiSettingsService: { setup: vi.fn(async () => ({ ollama: 'missing', models: [], ready: false, canPull: false })), pull: vi.fn() },
}));
import { licenseService } from '../../../services/licenseService';

const trial = (state) => ({ state, startedAt: null, endsAt: null, daysLeft: null, remindToday: false });
const FREE = { state: 'free', pro: false, edition: null, proSource: null, trial: trial('available'), perks: {} };
const TRIAL_ACTIVE = { ...FREE, state: 'trial', pro: true, proSource: 'local_trial', trial: trial('active') };
const LICENSED = { ...FREE, state: 'pro', pro: true, edition: 'standard', proSource: 'license' };

const PROMPT = /This is a Local App Studio Pro feature/;
const capability = (name) => document.querySelector(`[data-capability="${name}"]`);

function mount(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const panel = (over = {}) => {
  const props = {
    id: 'p',
    pageKey: 'settings',
    pageLabel: 'Settings',
    thread: { messages: [], status: 'idle', error: null },
    suggestions: ['Which settings should I review?'],
    agent: EMPTY_AGENT,
    onSend: vi.fn(),
    onSuggestion: vi.fn(),
    onNewAdvice: vi.fn(),
    onRetry: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { props, ui: <AssistantPanel {...props} /> };
};

// A stand-in for a Pro action: gated by the entitlements, and a server 403 pro_required shows the same prompt.
function ProAction() {
  const { known, pro } = useEntitlements();
  const [denied, setDenied] = useState(false);
  const run = async () => {
    if (known && !pro) {
      setDenied(true);
      return;
    }
    try {
      setResult((await h.run()).summary);
    } catch (err) {
      if (isProRequiredError(err)) setDenied(true);
    }
  };
  const [result, setResult] = useState(null);
  return (
    <div>
      <button type="button" onClick={run} disabled={!known}>
        Run Pro action
      </button>
      {denied && <ProGateNotice capability="example_pro" />}
      {result && <p>{result}</p>}
    </div>
  );
}

beforeEach(() => {
  licenseService.get.mockReset();
  h.run.mockReset();
});
afterEach(cleanup);

describe('useEntitlements', () => {
  function Probe() {
    const e = useEntitlements();
    return <p>{JSON.stringify({ known: e.known, pro: e.pro, trial: e.trial?.state ?? null })}</p>;
  }

  it('is unknown while loading, then reflects the license status', async () => {
    licenseService.get.mockResolvedValue(TRIAL_ACTIVE);
    mount(<Probe />);
    expect(screen.getByText(/"known":false,"pro":false/)).toBeInTheDocument();
    expect(await screen.findByText(/"known":true,"pro":true/)).toHaveTextContent('"trial":"active"');
  });

  it('stays unknown (never Pro) when the status fails to load', async () => {
    licenseService.get.mockRejectedValue(new Error('401'));
    mount(<Probe />);
    await waitFor(() => expect(licenseService.get).toHaveBeenCalled());
    expect(screen.getByText(/"known":false,"pro":false/)).toBeInTheDocument();
  });
});

describe('Assistant typed questions', () => {
  it('are never gated: a free user sends and sees no Pro prompt', async () => {
    licenseService.get.mockResolvedValue(FREE);
    const user = userEvent.setup();
    const { props, ui } = panel();
    mount(ui);
    await user.type(screen.getByRole('textbox', { name: 'Message Assistant' }), 'what should I tidy up{Enter}');
    expect(props.onSend).toHaveBeenCalledWith('what should I tidy up');
    expect(document.querySelector('[data-capability]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Which settings should I review?' }));
    expect(props.onSuggestion).toHaveBeenCalledWith('Which settings should I review?');
  });
});

describe('Pro action harness', () => {
  const click = async (user) => {
    const button = await screen.findByRole('button', { name: 'Run Pro action' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
  };

  it('a free user gets the prompt instead of the action', async () => {
    licenseService.get.mockResolvedValue(FREE);
    const user = userEvent.setup();
    mount(<ProAction />);
    await click(user);
    await waitFor(() => expect(capability('example_pro')).toBeInTheDocument());
    expect(h.run).not.toHaveBeenCalled();
  });

  it('a Pro user runs it with no prompt', async () => {
    licenseService.get.mockResolvedValue(TRIAL_ACTIVE);
    h.run.mockResolvedValue({ summary: 'Done.' });
    const user = userEvent.setup();
    mount(<ProAction />);
    await click(user);
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    expect(capability('example_pro')).toBeNull();
  });

  it('licensing off: runs with no Pro prompt', async () => {
    licenseService.get.mockResolvedValue({
      ...FREE,
      state: 'licensing_off',
      pro: true,
      proSource: 'licensing_off',
      trial: trial('unavailable'),
    });
    h.run.mockResolvedValue({ summary: 'Done.' });
    const user = userEvent.setup();
    mount(<ProAction />);
    await click(user);
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    expect(capability('example_pro')).toBeNull();
  });

  it('handles a 403 pro_required from the server with the prompt and no raw error', async () => {
    // Simulates a stale cache: the UI thinks Pro is on while the server says otherwise.
    licenseService.get.mockResolvedValue(LICENSED);
    const err = Object.assign(new Error('raw 403 text'), { status: 403, code: 'pro_required' });
    h.run.mockRejectedValue(err);
    const user = userEvent.setup();
    mount(<ProAction />);
    await click(user);
    await waitFor(() => expect(h.run).toHaveBeenCalled());
    expect(screen.queryByText(/raw 403 text/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('onboarding', () => {
  it('never shows a Pro prompt, even for a free user', async () => {
    licenseService.get.mockResolvedValue(FREE);
    mount(<Onboarding />);
    await screen.findByRole('dialog', { name: 'Welcome to Local App Studio' });
    await waitFor(() => expect(licenseService.get).not.toHaveBeenCalled());
    expect(document.querySelector('[data-capability]')).toBeNull();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });
});
