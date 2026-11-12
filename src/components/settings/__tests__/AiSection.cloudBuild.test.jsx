import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_BUILD } from '../../../../server/__tests__/helpers/proBuild.js';
import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AiSection from '../AiSection';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { aiSettingsService } from '../../../services/aiSettingsService';
import { allowSlowSuite } from '../../../test-utils/slowSuite';
import { aiSettings, MODELS } from './cloudOffFixtures';

// Real UI seam here: the server answer alone decides whether cloud is offered.
vi.mock('../../../services/aiSettingsService', () => ({
  aiSettingsService: {
    get: vi.fn(),
    models: vi.fn(),
    setModels: vi.fn(),
    setHost: vi.fn(),
    setProvider: vi.fn(),
    setCloud: vi.fn(),
    enableCloud: vi.fn(),
    disableCloud: vi.fn(),
    setCloudCategories: vi.fn(),
    cloudHint: vi.fn(),
    setup: vi.fn(),
    pull: vi.fn(),
  },
}));
vi.mock('../../../services/secretsService', () => ({
  secretsService: {
    list: vi.fn(async () => ({
      encryption: { enabled: true },
      storage: { available: true },
      writable: true,
      secrets: [],
    })),
    save: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));

const renderSection = () =>
  renderWithProviders(
    <MemoryRouter>
      <AiSection />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  aiSettingsService.models.mockResolvedValue({ models: MODELS });
});
afterEach(cleanup);

allowSlowSuite();

describe('Settings > AI with the real UI seam', () => {
  it('hides the source choice when the server reports cloud.build absent', async () => {
    aiSettingsService.get.mockResolvedValue(aiSettings('absent'));
    renderSection();
    expect(await screen.findByLabelText('Chat model')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(
      screen.getByText('Assistant runs on your machine through Ollama. This build contains no cloud provider.'),
    ).toBeInTheDocument();
  });

  it('stays on the local path even if a leftover provider says cloud', async () => {
    aiSettingsService.get.mockResolvedValue(aiSettings('absent', 'openai_compat'));
    renderSection();
    expect(await screen.findByLabelText('Chat model')).toBeInTheDocument();
    expect(screen.queryByLabelText('Provider address')).not.toBeInTheDocument();
  });

  it.skipIf(PUBLIC_BUILD)('still offers the source choice by default (needs the cloud provider, which is not in a public build)', async () => {
    aiSettingsService.get.mockResolvedValue(aiSettings('present'));
    renderSection();
    expect(await screen.findByRole('radio', { name: 'Your own cloud AI (optional)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'On this computer (recommended)' })).toBeChecked();
    expect(screen.getByText(/Nothing leaves your computer unless you turn on a cloud provider/)).toBeInTheDocument();
  });
});
