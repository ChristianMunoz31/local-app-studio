import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildLogLine } from '../../buildTypes';
import BuildLog from '../BuildLog';

afterEach(cleanup);

const lines = (n: number): BuildLogLine[] => Array.from({ length: n }, (_, i) => ({ seq: i + 1, step: 'npm-ci' as const, line: `line ${i + 1}` }));

function geometry(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
}

describe('BuildLog', () => {
  it('shows only the last 2000 lines and says so', () => {
    render(<BuildLog lines={lines(2005)} truncated={false} />);
    const log = screen.getByRole('log', { name: 'Build log' });
    expect(log.textContent?.startsWith('line 6\n')).toBe(true);
    expect(log.textContent?.endsWith('line 2005')).toBe(true);
    expect(screen.getByText('Showing the last 2000 lines')).toBeTruthy();
  });

  it('shows the cap notice when the server truncated', () => {
    render(<BuildLog lines={lines(3)} truncated />);
    expect(screen.getByText('Showing the last 2000 lines')).toBeTruthy();
  });

  it('follows new lines near the bottom and stops when scrolled up', () => {
    const { rerender } = render(<BuildLog lines={lines(3)} truncated={false} />);
    const log = screen.getByRole('log');
    geometry(log, 1000, 300);
    log.scrollTop = 700;
    fireEvent.scroll(log);
    rerender(<BuildLog lines={lines(4)} truncated={false} />);
    expect(log.scrollTop).toBe(1000);

    log.scrollTop = 100;
    fireEvent.scroll(log);
    rerender(<BuildLog lines={lines(5)} truncated={false} />);
    expect(log.scrollTop).toBe(100);
  });
});
