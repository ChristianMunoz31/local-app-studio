import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudioConfirm from '../StudioConfirm';
import { HelpButton } from '../HelpSheet';

// These tests are about the helper's and the installer's screens, so both are in the build they run in (a public run: helperNotInBuild.test.tsx, installerNotInBuild.test.tsx).
const parts = vi.hoisted(() => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('@/proParts.js', () => parts);

afterEach(() => {
  cleanup();
  parts.PRO_PARTS.helper = true;
  parts.PRO_PARTS.installer = true;
});

const press = (target: Element | Document, init: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key: '?', ...init });

describe('HelpSheet', () => {
  it('opens from the button with the steps, saving note and one table per area', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = screen.getByRole('dialog', { name: 'Help and keyboard shortcuts' });
    expect(dialog.textContent).toContain('How making an app works');
    expect(dialog.textContent).toContain('Make a Windows installer you can share.');
    expect(dialog.textContent).toContain('Moving to another step saves your changes.');
    expect(screen.getAllByRole('table')).toHaveLength(5);
    expect(screen.getAllByRole('columnheader', { name: 'Keys' })).toHaveLength(5);
  });

  it('points to the examples in both builds', () => {
    const line =
      'To start from a working app, press Use this example under Examples on the Apps page. It comes with sample records to try in Preview, and you can change it as your own.';
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'Help and keyboard shortcuts' }).textContent).toContain(line);
    cleanup();
    parts.PRO_PARTS.helper = false;
    parts.PRO_PARTS.installer = false;
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('dialog', { name: 'Help and keyboard shortcuts' }).textContent).toContain(line);
  });

  it('words the Prompt and Build steps for a build without the helper and the installer', () => {
    parts.PRO_PARTS.helper = false;
    parts.PRO_PARTS.installer = false;
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = screen.getByRole('dialog', { name: 'Help and keyboard shortcuts' });
    expect(dialog.textContent).toContain('Build your app in Design.');
    expect(dialog.textContent).toContain('Share your app as a file.');
    expect(dialog.textContent).not.toContain('Make a Windows installer you can share.');
    expect(dialog.textContent).not.toContain('Tell the helper what your app is for');
  });

  it('says what to do when the helper cannot answer', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByText('If the helper cannot answer, press Build it yourself and start with your tables on Data.')).toBeTruthy();
  });

  it('opens on ? and returns focus to the button on close', () => {
    render(<HelpButton />);
    press(document.body);
    expect(screen.getByRole('dialog', { name: 'Help and keyboard shortcuts' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Help' }));
  });

  it('does not open while typing or with a modifier', () => {
    render(
      <>
        <HelpButton />
        <input aria-label="Name" />
        <textarea aria-label="Words" />
      </>,
    );
    press(screen.getByLabelText('Name'));
    press(screen.getByLabelText('Words'));
    press(document.body, { ctrlKey: true });
    press(document.body, { altKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open while another dialog is open', () => {
    render(
      <>
        <HelpButton />
        <StudioConfirm title="Delete?" message="Sure." confirmLabel="Delete" busyLabel="Deleting..." cancelLabel="Keep" onConfirm={() => undefined} onCancel={() => undefined} />
      </>,
    );
    press(document.body);
    expect(screen.queryByRole('dialog', { name: 'Help and keyboard shortcuts' })).toBeNull();
  });
});
