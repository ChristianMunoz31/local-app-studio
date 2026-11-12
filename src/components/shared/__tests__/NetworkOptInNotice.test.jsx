import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import NetworkOptInNotice from '../NetworkOptInNotice';

afterEach(cleanup);

const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('NetworkOptInNotice', () => {
  it('explains the feature is off and links to Settings -> Network', () => {
    inRouter(<NetworkOptInNotice name="Update checks" />);
    expect(screen.getByRole('status')).toHaveTextContent('Update checks is off because it calls the internet.');
    expect(screen.getByRole('link', { name: /Settings → Network/ })).toHaveAttribute('href', '/settings#network');
  });

  it('renders plain text instead of a link when link is false (inside another link)', () => {
    inRouter(<NetworkOptInNotice name="Update checks" link={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Turn it on in Settings → Network');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
