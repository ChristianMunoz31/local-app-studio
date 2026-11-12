import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AppearanceSection from '../AppearanceSection';

afterEach(cleanup);

const base = {
  preference: 'system',
  resolvedTheme: 'dark',
  onPreferenceChange: vi.fn(),
  bgDark: 'aurora',
  bgLight: 'aurora',
  onBgDarkChange: vi.fn(),
  onBgLightChange: vi.fn(),
  onReset: vi.fn(),
};

describe('AppearanceSection', () => {
  it('the kit shows System, Light and Dark and both background pickers', () => {
    render(<AppearanceSection {...base} />);
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Dark mode background' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Light mode background' })).toBeInTheDocument();
    expect(screen.queryByText(/This app uses/)).toBeNull();
  });

  it('a built app names its theme, offers only Light and Dark and hides the backgrounds', () => {
    render(<AppearanceSection {...base} preference="dark" themeName="Forest" showBackgrounds={false} />);
    expect(screen.getByText('This app uses the Forest theme.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'System' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Dark mode background' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Light mode background' })).toBeNull();
  });

  it('names a Classic app the same way', () => {
    render(<AppearanceSection {...base} preference="light" themeName="Classic" showBackgrounds={false} />);
    expect(screen.getByText('This app uses the Classic theme.')).toBeInTheDocument();
  });
});
