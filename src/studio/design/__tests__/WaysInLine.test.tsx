// The line under Data connections: names the tables with no way to add records and offers the one press.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WaysInLine from '../WaysInLine';

afterEach(cleanup);

const gap = (table: string, tableLabel: string) => ({ table, tableLabel });

describe('WaysInLine', () => {
  it('shows nothing when no table is missing a way in', () => {
    const { container } = render(<WaysInLine gaps={[]} onAdd={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('names one table and offers the press', () => {
    const onAdd = vi.fn();
    render(<WaysInLine gaps={[gap('crews', 'Crews')]} onAdd={onAdd} />);
    expect(screen.getByText('Crews has no way to add records yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a way to add records' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('names two and three tables', () => {
    const { rerender } = render(<WaysInLine gaps={[gap('crews', 'Crews'), gap('steps', 'Steps')]} onAdd={() => {}} />);
    expect(screen.getByText('Crews and Steps have no way to add records yet.')).toBeTruthy();
    rerender(<WaysInLine gaps={[gap('crews', 'Crews'), gap('steps', 'Steps'), gap('jobs', 'Jobs')]} onAdd={() => {}} />);
    expect(screen.getByText('Crews, Steps and Jobs have no way to add records yet.')).toBeTruthy();
  });
});
