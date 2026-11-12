import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreviewStatus } from '../../types';
import PreviewControls from '../PreviewControls';

afterEach(cleanup);

const status = (over: Partial<PreviewStatus> = {}): PreviewStatus => ({ state: 'stopped', appId: null, revision: null, startedAt: null, message: null, data: null, ...over });
const handlers = () => ({ onStart: vi.fn(), onRestart: vi.fn(), onStop: vi.fn(), onReset: vi.fn() });
const show = (s: PreviewStatus | null, h = handlers(), busy = false) => {
  render(<PreviewControls status={s} appId="app-1" busy={busy} {...h} />);
  return h;
};

describe('PreviewControls', () => {
  it('failed: one status line with the reason, the fix, both buttons, and never says stopped', () => {
    const h = show(status({ state: 'failed', appId: 'app-1', message: 'The tables could not be applied.' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('The preview could not start. The tables could not be applied.');
    expect(screen.queryByText(/stopped/)).toBeNull();
    expect(screen.getByText(/reset the preview data: it deletes the records you added in Preview/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset preview data' }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });

  it('failed with no message or the same sentence says it once', () => {
    show(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start.' }));
    expect(screen.getByRole('status').textContent).toBe('The preview could not start.');
  });

  it('failed with the server sentence "The preview could not start. Try again." says the lead once', () => {
    show(status({ state: 'failed', appId: 'app-1', message: 'The preview could not start. Try again.' }));
    expect(screen.getByRole('status').textContent).toBe('The preview could not start.');
    expect(screen.getAllByText(/could not start/)).toHaveLength(1);
  });

  it('status null: says Studio could not check and offers Try again, which starts', () => {
    const h = show(null);
    expect(screen.getByText('Studio could not check the preview. Press Try again.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('stopped offers Start preview; running offers Restart and Stop in Preview options', () => {
    const h = show(status());
    expect(screen.getByText('The preview is stopped.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
    expect(h.onStart).toHaveBeenCalledTimes(1);
    cleanup();
    const r = show(status({ state: 'running', appId: 'app-1' }));
    expect(screen.getByText('Your app is running.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset preview data' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(r.onRestart).toHaveBeenCalledTimes(1);
    expect(r.onStop).toHaveBeenCalledTimes(1);
  });

  it('starting shows the start line, and the old scratch database sentence is gone', () => {
    show(status({ state: 'starting', appId: 'app-1' }));
    expect(screen.getByText('Starting your app...')).toBeTruthy();
    expect(screen.queryByText(/scratch/)).toBeNull();
  });
});
