import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GeneralSection from '../GeneralSection';

vi.mock('../../../hooks/useAssistantStatus', () => ({
  useAssistantStatus: () => ({ status: null, loading: false }),
}));

vi.mock('../DisplayNameField', () => ({ default: () => null }));

afterEach(cleanup);

function groupRadios(legend) {
  const fieldset = screen.getByRole('group', { name: legend });
  return {
    on: fieldset.querySelector('input[value="true"]'),
    off: fieldset.querySelector('input[value="false"]'),
    fieldset,
  };
}

const BUTTON = 'Show the Assistant button (you can still open Assistant from search)';
const base = { mode: 'all', onModeChange: vi.fn(), onReset: vi.fn() };

describe('GeneralSection Assistant advisor settings', () => {
  it('defaults both radios to On', () => {
    render(
      <MemoryRouter>
        <GeneralSection {...base} />
      </MemoryRouter>,
    );
    expect(groupRadios(BUTTON).on).toBeChecked();
    expect(groupRadios('Auto-advise when opened').on).toBeChecked();
  });

  it('reports changes through the callbacks', async () => {
    const onAdvisorButtonChange = vi.fn();
    const onAutoAdviseChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GeneralSection
          {...base}
          advisorButton
          autoAdvise
          onAdvisorButtonChange={onAdvisorButtonChange}
          onAutoAdviseChange={onAutoAdviseChange}
        />
      </MemoryRouter>,
    );
    await user.click(groupRadios(BUTTON).off);
    expect(onAdvisorButtonChange).toHaveBeenCalledWith(false);
    await user.click(groupRadios('Auto-advise when opened').off);
    expect(onAutoAdviseChange).toHaveBeenCalledWith(false);
  });

  it('keeps auto-advise enabled when the button is Off, since Assistant still opens from search', () => {
    render(
      <MemoryRouter>
        <GeneralSection {...base} advisorButton={false} autoAdvise />
      </MemoryRouter>,
    );
    expect(groupRadios('Auto-advise when opened').fieldset).toBeEnabled();
    expect(groupRadios(BUTTON).fieldset).toBeEnabled();
    expect(screen.getByText(/Turning it off only hides the button/)).toBeInTheDocument();
  });
});
