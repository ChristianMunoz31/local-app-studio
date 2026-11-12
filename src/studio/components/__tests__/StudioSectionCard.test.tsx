import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import StudioSectionCard from '../StudioSectionCard';

function TestIcon({ size, className }: { size?: number; className?: string }) {
  return <svg data-testid="icon" width={size} className={className} />;
}

afterEach(cleanup);

describe('StudioSectionCard', () => {
  it('wraps the header and lets the action wrap under the title', () => {
    render(
      <StudioSectionCard title="Apps" action={<button type="button">Create</button>}>
        body
      </StudioSectionCard>,
    );
    expect(screen.getByTestId('studio-section-card-header').className).toContain('flex-wrap');
    const action = screen.getByTestId('studio-section-card-action');
    expect(action.className).toContain('ml-auto');
    expect(action.className).toContain('max-w-full');
    expect(action.className).toContain('min-w-0');
  });

  it('keeps the title readable instead of truncating it', () => {
    render(<StudioSectionCard title="A very long app name">body</StudioSectionCard>);
    const heading = screen.getByRole('heading', { name: 'A very long app name' });
    expect(heading.className).toContain('break-words');
    expect(heading.className).not.toContain('truncate');
  });

  it('adds the header bottom margin only when there are children', () => {
    const { rerender } = render(<StudioSectionCard title="T">body</StudioSectionCard>);
    expect(screen.getByTestId('studio-section-card-header').className).toContain('mb-4');
    rerender(<StudioSectionCard title="T" />);
    expect(screen.getByTestId('studio-section-card-header').className).not.toContain('mb-4');
  });

  it('never squashes the icon', () => {
    render(
      <StudioSectionCard title="T" icon={TestIcon}>
        body
      </StudioSectionCard>,
    );
    expect(screen.getByTestId('icon').getAttribute('class')).toContain('shrink-0');
  });

  it('uses the dense glass variant on request and keeps the heading id', () => {
    const { container } = render(
      <StudioSectionCard title="T" variant="dense" headingId="h1">
        body
      </StudioSectionCard>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('glass-dense');
    expect(screen.getByRole('heading', { name: 'T' }).id).toBe('h1');
  });
});
