import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProviderSelector from '../ProviderSelector';

let mockStatus = null;
vi.mock('../../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: mockStatus, loading: false }),
}));

afterEach(() => {
  cleanup();
  mockStatus = null;
});

const renderBadge = () =>
  render(
    <MemoryRouter>
      <ProviderSelector />
    </MemoryRouter>,
  );

describe('ProviderSelector badge', () => {
  it('renders nothing without a status', () => {
    const { container } = renderBadge();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the local model and links to Settings > AI', () => {
    mockStatus = { available: true, provider: 'ollama', model: 'qwen2.5:7b' };
    renderBadge();
    const link = screen.getByRole('link', { name: 'Assistant: qwen2.5:7b, on this computer' });
    expect(link).toHaveAttribute('href', '/settings#ai');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('labels a cloud provider as cloud', () => {
    mockStatus = { available: true, provider: 'openai_compat', model: 'some-model' };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: some-model, cloud' })).toBeInTheDocument();
  });

  it('uses the effective provider when the selected cloud provider cannot be used', () => {
    mockStatus = { available: true, provider: 'ollama', effectiveProvider: 'ollama', model: 'qwen2.5:7b' };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: qwen2.5:7b, on this computer' })).toBeInTheDocument();
    cleanup();
    mockStatus = { available: true, provider: 'ollama', effectiveProvider: 'openai_compat', model: 'm' };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: m, cloud' })).toBeInTheDocument();
  });

  it('names where Assistant runs from status.ai: this computer, your network or the cloud host', () => {
    mockStatus = { available: true, provider: 'ollama', model: 'm', ai: { kind: 'local', host: null } };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: m, on this computer' })).toBeInTheDocument();
    cleanup();
    mockStatus = { available: true, provider: 'ollama', model: 'm', ai: { kind: 'lan', host: 'nas.local' } };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: m, on your network' })).toBeInTheDocument();
    cleanup();
    mockStatus = {
      available: true,
      provider: 'openai_compat',
      model: 'm',
      ai: { kind: 'cloud', host: 'api.example.com' },
    };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: m, cloud (api.example.com)' })).toBeInTheDocument();
  });

  it('trusts status.ai over the provider fields', () => {
    mockStatus = {
      available: true,
      provider: 'openai_compat',
      effectiveProvider: 'ollama',
      model: 'm',
      ai: { kind: 'local', host: null },
    };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: m, on this computer' })).toBeInTheDocument();
  });

  it('says AI is off for reason ai_disabled', () => {
    mockStatus = { available: false, provider: 'ollama', model: null, code: 'ai_not_configured', reason: 'ai_disabled' };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: AI is off' })).toBeInTheDocument();
  });

  it('says Assistant needs Ollama when unavailable', () => {
    mockStatus = { available: false, provider: 'ollama', model: null };
    renderBadge();
    expect(screen.getByRole('link', { name: 'Assistant: needs Ollama' })).toBeInTheDocument();
  });
});
