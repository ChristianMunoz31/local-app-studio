import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AiSection from '../AiSection';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { aiSettingsService } from '../../../services/aiSettingsService';
import { allowSlowSuite } from '../../../test-utils/slowSuite';
import { aiSettings, MODELS } from './cloudOffFixtures';

// The cloud-off build swaps the seam for the stub; the real seam is covered in AiSection.cloudBuild.test.jsx.
vi.mock('../cloudUi', () => import('../cloudUi.disabled'));
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

describe('Settings > AI in a cloud-off build (stubbed UI seam)', () => {
  it('shows no source choice and the absent subtitle', async () => {
    aiSettingsService.get.mockResolvedValue(aiSettings('present'));
    renderSection();
    expect(await screen.findByLabelText('Chat model')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Where Assistant runs' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Assistant runs on your machine through Ollama. This build contains no cloud provider.'),
    ).toBeInTheDocument();
  });
});
