// Split from DesignTab.test.tsx by describe block (phase 27): issues, the conflict message, the Look tab, pages added and deleted. The mocks, builders and hooks are in designTabHarness.tsx.
import { layer, makeSpec, dataSpec, mount, harness, openPageActions, saveButton, select, toolbar, order, installDesignTabHooks } from './designTabHarness';
import type { Harness } from './designTabHarness';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppSpec, SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { CONFLICT_MESSAGE } from '../../types';

installDesignTabHooks();

describe('DesignTab', () => {
  it('shows the issues of an invalid_spec answer', async () => {
    const issue: SpecIssue = { path: 'pages.0.layout', code: 'invalid_props', message: 'Heading: bad size.' };
    mount(harness(), () => ({ ok: false, code: 'invalid_spec', message: 'Heading: bad size.', issues: [issue] }));
    await screen.findByText('Home heading');
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    expect(await screen.findByText('Page Home: Heading: bad size.', { selector: 'li' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Heading: bad size.');
  });

  /** A page with one unsaved divider whose first save answers a conflict. */
  const conflictedDraft = async (onAbout = false): Promise<Harness> => {
    let conflicts = 1;
    const h = harness();
    mount(h, () => (conflicts-- > 0 ? { ok: false, code: 'revision_conflict', message: 'raw server text', issues: [] } : null));
    await screen.findByText('Home heading');
    if (onAbout) {
      fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
      await screen.findByText('About heading');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeTruthy();
    return h;
  };

  it('keeps the conflict message after a conflict and the unsaved change with it, until the next save', async () => {
    await conflictedDraft();
    // A draft with unsaved edits never adopts the other change: the divider stays and the notice is still there.
    await waitFor(() => expect(order()).toEqual(['root_home', 'h1', 'h2', 'divider_1']));
    expect(screen.getByText(CONFLICT_MESSAGE)).toBeTruthy();
    expect(saveButton().disabled).toBe(false);
    // The next save replaces it, as with any save message.
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull());
  });

  it('drops the conflict message when a page is added after the conflict', async () => {
    await conflictedDraft();
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a page' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a page' });
    fireEvent.change(within(dialog).getByLabelText('Page title'), { target: { value: 'Open Crews' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(order()[0]).toBe('root_open_crews'));
    expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
  });

  it('drops the conflict message when a page is deleted after the conflict', async () => {
    await conflictedDraft(true);
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete this page' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete the page About?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete page' }));
    await waitFor(() => expect(order()[0]).toBe('root_home'));
    expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
  });

  it('drops the conflict message when the page settings are saved after the conflict', async () => {
    await conflictedDraft();
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Page settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Page settings' });
    expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Start' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save page settings' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Page settings' })).toBeNull());
    expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
  });

  it('marks problems in the layout shortly after an edit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount(harness(), undefined, dataSpec);
      await screen.findAllByRole('group', { name: 'Table of records' });
      select('t1');
      fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add Divider line' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(screen.queryByText(/problem/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('Look tab', () => {
    it('shows a picked theme on the canvas right away, keeps the Studio chrome as it is, and saves it with the layout', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      expect((screen.getByRole('tab', { name: 'Features' })).getAttribute('aria-selected')).toBe('true');
      fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
      const canvas = screen.getByTestId('design-canvas');
      const before = canvas.style.getPropertyValue('--brand');
      fireEvent.click(screen.getByRole('radio', { name: /Forest/ }));
      const after = canvas.style.getPropertyValue('--brand');
      expect(after).not.toBe('');
      expect(after).not.toBe(before);
      expect(document.documentElement.style.getPropertyValue('--brand')).toBe('');
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(h.saves[0].theme).toMatchObject({ id: 'forest' });
      expect(h.saves[0].pages[0].layout).toEqual(makeSpec().pages[0].layout);
    });

    it('switches between the Features and Look tabs', async () => {
      mount(harness());
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
      expect(screen.queryByRole('searchbox', { name: 'Search parts and features' })).toBeNull();
      fireEvent.click(screen.getByRole('tab', { name: 'Features' }));
      expect(screen.getByRole('searchbox', { name: 'Search parts and features' })).toBeTruthy();
    });

    it('undoes nothing of the layout when the look changes, and a look change alone is saved', async () => {
      const h = harness();
      mount(h);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
      fireEvent.click(screen.getByRole('radio', { name: /Midnight/ }));
      expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
      expect(saveButton().disabled).toBe(false);
    });
  });

  describe('Look tab: menu bar', () => {
    const openLook = async (h: Harness, initial?: () => AppSpec): Promise<void> => {
      mount(h, undefined, initial);
      await screen.findByText('Home heading');
      fireEvent.click(screen.getByRole('tab', { name: 'Look' }));
    };
    const withMenu = (): AppSpec => ({ ...makeSpec(), menu: { position: 'side', style: 'labels' } });

    it('writes the menu block when Across the top is picked and saved', async () => {
      const h = harness();
      await openLook(h);
      fireEvent.click(screen.getByRole('radio', { name: 'Across the top' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(h.saves[0].menu).toEqual({ position: 'top', style: expect.stringMatching(/^(labels|icons-and-labels)$/) });
      expect(h.saves[0].pages[0].layout).toEqual(makeSpec().pages[0].layout);
    });

    it('keeps the chosen words-or-icons style in the saved block', async () => {
      const h = harness();
      await openLook(h);
      fireEvent.click(screen.getByRole('radio', { name: 'Down the side' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Words only' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(h.saves[0].menu).toEqual({ position: 'side', style: 'labels' });
    });

    it('removes the menu key entirely when No menu bar is picked and saved', async () => {
      const h = harness();
      await openLook(h, withMenu);
      fireEvent.click(screen.getByRole('radio', { name: 'No menu bar' }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(Object.hasOwn(h.saves[0], 'menu')).toBe(false);
      expect(JSON.stringify(h.saves[0])).not.toContain('"menu"');
    });

    it('is not dirty until the menu changes, and returns to clean when the choice is undone', async () => {
      const h = harness();
      await openLook(h);
      expect(saveButton().disabled).toBe(true);
      fireEvent.click(screen.getByRole('radio', { name: 'Across the top' }));
      expect(saveButton().disabled).toBe(false);
      fireEvent.click(screen.getByRole('radio', { name: 'No menu bar' }));
      expect(saveButton().disabled).toBe(true);
    });

    it('saves an app without a menu, changed in some other way, with no menu key and the same spec otherwise', async () => {
      const h = harness();
      await openLook(h);
      fireEvent.click(screen.getByRole('radio', { name: /Forest/ }));
      await waitFor(() => expect(saveButton().disabled).toBe(false));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(Object.hasOwn(h.saves[0], 'menu')).toBe(false);
      const { theme: savedTheme, ...rest } = h.saves[0];
      const original: Partial<AppSpec> = makeSpec();
      delete original.theme;
      expect(savedTheme).toMatchObject({ id: 'forest' });
      expect(JSON.stringify(rest)).toBe(JSON.stringify(original));
    });

    it('does not add a menu key to a spec that had none when Across the top is picked then dropped before saving', async () => {
      const h = harness();
      await openLook(h);
      fireEvent.click(screen.getByRole('radio', { name: 'Across the top' }));
      fireEvent.click(screen.getByRole('radio', { name: 'No menu bar' }));
      fireEvent.click(screen.getByRole('radio', { name: /Midnight/ }));
      fireEvent.click(saveButton());
      await waitFor(() => expect(h.saves).toHaveLength(1));
      expect(Object.hasOwn(h.saves[0], 'menu')).toBe(false);
    });
  });

  it('adds a page with a starter layout, route and menu entry, then shows it', async () => {
    const h = harness();
    mount(h);
    await screen.findByText('Home heading');
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a page' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a page' });
    fireEvent.change(within(dialog).getByLabelText('Page title'), { target: { value: 'Open Crews' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const added = h.saves[0].pages[2];
    expect(added).toMatchObject({ id: 'open_crews', title: 'Open Crews', route: '/open-crews', sources: [] });
    expect(added.layout.id).toBe('root_open_crews');
    expect(h.saves[0].nav.at(-1)).toEqual({ pageId: 'open_crews', label: 'Open Crews', icon: 'file' });
    await waitFor(() => expect(order()[0]).toBe('root_open_crews'));
  });

  it('deletes a page after confirmation but never the home page', async () => {
    const h = harness();
    mount(h);
    await screen.findByText('Home heading');
    openPageActions();
    expect(screen.getByRole('menuitem', { name: 'Delete this page' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
    await screen.findByText('About heading');
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete this page' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete the page About?' });
    expect(within(confirm).getByRole('button', { name: 'Keep page' })).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete page' }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(h.saves[0].pages.map((p) => p.id)).toEqual(['home']);
    await waitFor(() => expect(order()[0]).toBe('root_home'));
  });

  it('refuses a page title another page has, in Add a page, and does not save (P-34)', async () => {
    const h = harness();
    mount(h);
    await screen.findByText('Home heading');
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a page' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a page' });
    fireEvent.change(within(dialog).getByLabelText('Page title'), { target: { value: 'about' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add page' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('A page called About already exists. Pick another title.');
    expect(h.saves).toHaveLength(0);
  });

  it('Add a page asks what kind: a page that shows one record sets the address, stays out of the menu and lists open it (P-26, P-05)', async () => {
    const h = harness();
    mount(h, undefined, dataSpec);
    await screen.findAllByRole('group', { name: 'Table of records' });
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a page' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a page' });
    expect(within(dialog).getByRole('group', { name: 'What kind of page?' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'A page that shows one record from a table' }));
    expect((within(dialog).getByLabelText('Page title') as HTMLInputElement).value).toBe('Crews');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add page' }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const saved = h.saves[0];
    const added = saved.pages.find((p) => p.id === 'crews');
    expect(added?.route).toBe('/crews/:id');
    expect(added?.sources.map((x) => [x.table, x.mode])).toEqual([['crews', 'record']]);
    expect(saved.nav.some((n) => n.pageId === 'crews')).toBe(false);
    const list = (saved.pages[0].layout.children as Array<{ props: Record<string, unknown> }>)[0];
    expect(list.props.rowAction).toEqual({ action: 'navigate', pageId: 'crews', withRecord: true });
  });

  it('a plain page is made to show one record from Page actions (P-26)', async () => {
    const h = harness();
    mount(h, undefined, dataSpec);
    await screen.findAllByRole('group', { name: 'Table of records' });
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
    await screen.findByText('About heading');
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show one record on this page' }));
    const dialog = await screen.findByRole('dialog', { name: 'Show one record on this page' });
    expect(within(dialog).getByText("This page will open from a list, one Crews record at a time. It leaves the menu and shows the record's details.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make this page show one Crews record' }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    const about = h.saves[0].pages.find((p) => p.id === 'about');
    expect(about?.route).toBe('/about/:id');
    expect(about?.sources.map((x) => x.mode)).toEqual(['record']);
  });

  it('Delete page names the parts that go to the page and offers no red button until they are changed (P-33)', async () => {
    const h = harness();
    const going = (): AppSpec => {
      const spec = makeSpec();
      spec.pages[0] = { ...spec.pages[0], layout: layer('root_home', 'Page', {}, [layer('b1', 'Button', { action: { action: 'navigate', pageId: 'about', withRecord: false } }, 'See about')]) };
      return spec;
    };
    mount(h, undefined, going);
    await screen.findByText('See about');
    fireEvent.change(screen.getByLabelText('Page'), { target: { value: 'about' } });
    await screen.findByText('About heading');
    openPageActions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete this page' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the page About?' });
    expect(within(dialog).getByText('The Button on Home goes to this page.')).toBeTruthy();
    expect(within(dialog).getByText('Change where it goes first.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Delete page' })).toBeNull();
    expect(h.saves).toHaveLength(0);
  });

});
