import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeMode } from '@local-app-studio/runtime/theme/ids.ts';
import CanvasFrame, { ENLARGE, SHRINK, enlargedLabel } from '../CanvasFrame';
import type { CanvasFrameProps } from '../CanvasFrame';
import Modal from '@/components/shared/Modal.jsx';

const mounts = vi.hoisted(() => ({ count: 0 }));

function Counter() {
  const [text, setText] = useState('');
  useEffect(() => {
    mounts.count += 1;
  }, []);
  return <input aria-label="Notes" value={text} onChange={(e) => setText(e.target.value)} />;
}

function Harness(props: Partial<CanvasFrameProps> & { onMode?: (m: ThemeMode) => void }) {
  const { onMode, ...rest } = props;
  return (
    <CanvasFrame name="Crew Roster" mode="light" onModeChange={onMode ?? (() => {})} layout="card" enlargeable {...rest}>
      <Counter />
    </CanvasFrame>
  );
}

afterEach(() => {
  cleanup();
  mounts.count = 0;
  document.body.style.overflow = '';
});

const studioRoot = (container: HTMLElement): HTMLElement => container;

describe('CanvasFrame', () => {
  it('shows the name and Show as in its toolbar, and Enlarge only when it is enlargeable', () => {
    const first = render(<Harness />);
    expect(screen.getByText('Crew Roster')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Show as' })).toBeTruthy();
    expect(screen.getByRole('button', { name: ENLARGE })).toBeTruthy();
    first.unmount();
    render(<Harness enlargeable={false} />);
    expect(screen.queryByRole('button', { name: ENLARGE })).toBeNull();
    expect(screen.getByRole('group', { name: 'Show as' })).toBeTruthy();
  });

  it('puts the toolbar and the app in one bordered box', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Show as' });
    const toolbar = group.parentElement?.parentElement as HTMLElement;
    expect(toolbar.className).toContain('border-b');
    const frame = toolbar.parentElement as HTMLElement;
    expect(frame.className).toContain('rounded-2xl');
    expect(frame.contains(screen.getByLabelText('Notes'))).toBe(true);
  });

  it('opens a modal dialog named for the app, focuses Shrink, makes the Studio root inert and leaves the body scroll alone', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    const dialog = screen.getByRole('dialog', { name: enlargedLabel('Crew Roster') });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.parentElement?.className).toContain('z-50');
    const shrink = within(dialog).getByRole('button', { name: SHRINK });
    expect(document.activeElement).toBe(shrink);
    expect(studioRoot(container).hasAttribute('inert')).toBe(true);
    expect(dialog.hasAttribute('inert') || dialog.closest('[inert]') !== null).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(screen.getAllByRole('group', { name: 'Show as' })).toHaveLength(1);
  });

  it('Shrink closes the dialog, puts focus back on Enlarge, and removes inert', () => {
    document.body.style.overflow = 'auto';
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.click(screen.getByRole('button', { name: SHRINK }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ENLARGE }));
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('Escape shrinks it the same way, but not when the key was already handled', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    const dialog = screen.getByRole('dialog');
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const input = within(dialog).getByLabelText('Notes');
    input.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
    input.dispatchEvent(handled);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ENLARGE }));
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('leaves Escape to a select inside the layer', () => {
    render(
      <CanvasFrame name="Crew Roster" mode="light" onModeChange={() => {}} layout="card" enlargeable>
        <select aria-label="Crew">
          <option>One</option>
        </select>
      </CanvasFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.keyDown(screen.getByLabelText('Crew'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('stops Ctrl+K at the layer so the command palette stays shut', () => {
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'k', ctrlKey: true });
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener('keydown', seen);
  });

  it('shrinks on Escape when focus fell to the body, and keeps Ctrl+K from the window', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(seen).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    window.removeEventListener('keydown', seen);
  });

  it('stops Ctrl+K from anywhere while enlarged, and leaves other outside keys alone', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.keyDown(outside, { key: 'k', ctrlKey: true });
    expect(seen).not.toHaveBeenCalled();
    fireEvent.keyDown(outside, { key: 'a' });
    expect(seen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
    window.removeEventListener('keydown', seen);
    outside.remove();
  });

  it('closes only the Modal an app opened when Escape is pressed in it', () => {
    function WithModal() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open app dialog
          </button>
          {open && (
            <Modal title="App dialog" onClose={() => setOpen(false)}>
              <input aria-label="Inside" />
            </Modal>
          )}
        </>
      );
    }
    render(
      <CanvasFrame name="Crew Roster" mode="light" onModeChange={() => {}} layout="card" enlargeable>
        <WithModal />
      </CanvasFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    const opener = screen.getByRole('button', { name: 'Open app dialog' });
    opener.focus();
    fireEvent.click(opener);
    const inside = screen.getByLabelText('Inside');
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    fireEvent.keyDown(inside, { key: 'k', ctrlKey: true });
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener('keydown', seen);
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(screen.queryByLabelText('Inside')).toBeNull();
    expect(screen.queryByRole('dialog', { name: enlargedLabel('Crew Roster') })).not.toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.closest('[role="dialog"]')).not.toBeNull();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not shrink on an Escape on the body while an app Modal is open', () => {
    function WithModal() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open app dialog
          </button>
          {open && (
            <Modal title="App dialog" onClose={() => setOpen(false)}>
              <input aria-label="Inside" />
            </Modal>
          )}
        </>
      );
    }
    render(
      <CanvasFrame name="Crew Roster" mode="light" onModeChange={() => {}} layout="card" enlargeable>
        <WithModal />
      </CanvasFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.click(screen.getByRole('button', { name: 'Open app dialog' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: enlargedLabel('Crew Roster') })).not.toBeNull();
  });

  it('leaves Escape to an open popup and to the pickers that use it', () => {
    render(
      <CanvasFrame name="Crew Roster" mode="light" onModeChange={() => {}} layout="card" enlargeable>
        <button type="button" aria-haspopup="menu" aria-expanded="true" aria-label="Open menu button" />
        <div role="listbox" aria-label="Choices">
          <div role="option" aria-selected="false" tabIndex={0}>
            One
          </div>
        </div>
        <input aria-label="When" type="datetime-local" />
      </CanvasFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.keyDown(screen.getByLabelText('Open menu button'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('option'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByLabelText('When'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('shrinks on Escape from a plain disclosure that has no popup', () => {
    render(
      <CanvasFrame name="Crew Roster" mode="light" onModeChange={() => {}} layout="card" enlargeable>
        <button type="button" aria-expanded="true" aria-label="Side menu" />
      </CanvasFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.keyDown(screen.getByLabelText('Side menu'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not shrink on an Escape the app handled in its own React onKeyDown', () => {
    render(
      <CanvasFrame name="Crew Roster" mode="light" onModeChange={() => {}} layout="card" enlargeable>
        <input
          aria-label="Handled"
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.preventDefault();
          }}
        />
      </CanvasFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.keyDown(screen.getByLabelText('Handled'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('keeps the same DOM node, its typing and one mount across Enlarge and Shrink', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Notes') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'night shift' } });
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    const inLayer = within(screen.getByRole('dialog')).getByLabelText('Notes');
    expect(inLayer).toBe(input);
    expect((inLayer as HTMLInputElement).value).toBe('night shift');
    fireEvent.click(screen.getByRole('button', { name: SHRINK }));
    const after = screen.getByLabelText('Notes');
    expect(after).toBe(input);
    expect((after as HTMLInputElement).value).toBe('night shift');
    expect(after.closest('[role="dialog"]')).toBeNull();
    expect(mounts.count).toBe(1);
  });

  it('passes the Show as choice from the layer to onModeChange', () => {
    const onMode = vi.fn();
    render(<Harness onMode={onMode} />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    const group = within(screen.getByRole('dialog')).getByRole('group', { name: 'Show as' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(onMode).toHaveBeenCalledWith('dark');
  });

  it('removes inert when it unmounts while enlarged', () => {
    const { container, unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    expect(container.hasAttribute('inert')).toBe(true);
    unmount();
    expect(container.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not touch an inert the Studio root already had', () => {
    const { container } = render(<Harness />);
    container.setAttribute('inert', '');
    fireEvent.click(screen.getByRole('button', { name: ENLARGE }));
    fireEvent.click(screen.getByRole('button', { name: SHRINK }));
    expect(container.hasAttribute('inert')).toBe(true);
  });

  it('renders the pane layout without a portal, with no Enlarge, and the children as direct body content', () => {
    render(
      <CanvasFrame name="Crew Roster" mode="dark" onModeChange={() => {}} layout="pane">
        <div id="design-page">page</div>
      </CanvasFrame>,
    );
    expect(screen.queryByRole('button', { name: ENLARGE })).toBeNull();
    const page = document.getElementById('design-page') as HTMLElement;
    const frame = page.parentElement?.parentElement as HTMLElement;
    expect(frame.className).toContain('border');
    expect(frame.contains(screen.getByRole('group', { name: 'Show as' }))).toBe(true);
    expect(page.parentElement?.className).toContain('lg:overflow-y-auto');
    expect(page.contains(screen.getByRole('group', { name: 'Show as' }))).toBe(false);
  });
});
