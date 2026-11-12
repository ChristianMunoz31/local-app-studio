import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import IssueList from '../IssueList';

afterEach(cleanup);

const issues: SpecIssue[] = [{ path: 'app.name', code: 'too_small', message: 'Too small: expected string to have >=1 characters' }];

describe('IssueList', () => {
  it('is an alert by default, for callers that announce nothing else', () => {
    render(<IssueList issues={issues} />);
    expect(screen.getByRole('alert').textContent).toContain('App name: This needs at least 1 characters.');
  });

  it('is a plain list when the caller already announces the failure, or the list changes while typing (R-6)', () => {
    render(<IssueList issues={issues} title="These pages use what you changed:" alert={false} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getByText('These pages use what you changed:')).toBeTruthy();
  });

  it('shows nothing without problems', () => {
    const { container } = render(<IssueList issues={[]} alert={false} />);
    expect(container.textContent).toBe('');
  });
});
