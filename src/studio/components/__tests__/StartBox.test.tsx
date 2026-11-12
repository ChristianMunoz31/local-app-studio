import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StartBox from '../StartBox';

afterEach(cleanup);

describe('StartBox', () => {
  it('disables the button until there is text and shows the count', () => {
    render(<StartBox busy={false} error="" onStart={vi.fn()} onCancel={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Make my app' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: '   ' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your prompt'), { target: { value: 'Dog walks' } });
    expect(button.disabled).toBe(false);
    expect(screen.getByText('9 of 2000')).toBeTruthy();
  });

  it('submits trimmed text on click and on Ctrl+Enter', () => {
    const onStart = vi.fn();
    render(<StartBox busy={false} error="" onStart={onStart} onCancel={vi.fn()} />);
    const box = screen.getByLabelText('Your prompt');
    fireEvent.change(box, { target: { value: ' Dog walks ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make my app' }));
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledWith('Dog walks');
  });

  it('says the helper runs here and points to Blank app', () => {
    render(<StartBox busy={false} error="" onStart={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('The helper runs on this computer. No helper yet? Press Blank app and build it yourself.')).toBeTruthy();
    expect(screen.getByText('What do you want to build?')).toBeTruthy();
  });

  it('shows the busy label and the error', () => {
    render(<StartBox busy error="Nope." onStart={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Making your app...' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Nope.');
  });

  it('Cancel calls onCancel and is disabled while busy', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<StartBox busy={false} error="" onStart={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<StartBox busy error="" onStart={vi.fn()} onCancel={onCancel} />);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives the textarea to textRef and the card the id', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<StartBox id="start-card" textRef={ref} busy={false} error="" onStart={vi.fn()} onCancel={vi.fn()} />);
    expect(ref.current).toBe(screen.getByLabelText('Your prompt'));
    expect(document.getElementById('start-card')).toBeTruthy();
  });
});
