import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import PageSettingsDialog from '../PageSettingsDialog';

afterEach(cleanup);

const spec: AppSpec = {
  specVersion: 1,
  app: { name: 'Crew Roster', slug: 'crew-roster', identifier: 'com.example.crewroster', version: '1.0.0', description: '', icon: null },
  tables: [{ id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }],
  pages: [
    { id: 'home', title: 'Home', route: '/', sources: [], layout: { id: 'root_home', type: 'Page', props: {}, children: [] } },
    { id: 'about', title: 'About', route: '/about', sources: [], layout: { id: 'root_about', type: 'Page', props: {}, children: [] } },
  ],
  nav: [{ pageId: 'home', label: 'Home' }],
  theme: { preset: 'aurora', radius: 'md' },
};

describe('PageSettingsDialog', () => {
  it('saves a new title, a menu entry and a source in one spec', async () => {
    const onSave = vi.fn(async (next: AppSpec) => ({ ok: true as const, record: { id: 'a', name: '', slug: '', revision: 2, spec: next, issues: [], createdAt: '', updatedAt: '' } }));
    render(<PageSettingsDialog spec={spec} pageId="about" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'About us' } });
    fireEvent.click(screen.getByLabelText('Show in the menu'));
    fireEvent.click(screen.getByRole('button', { name: 'Add a list' }));
    fireEvent.change(screen.getByLabelText('Show at most for Crews'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save page settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const next = onSave.mock.calls[0][0];
    expect(next.pages[1]).toMatchObject({ title: 'About us', route: '/about', sources: [{ id: 'crews', table: 'crews', mode: 'list', limit: 20 }] });
    expect(next.nav).toEqual([
      { pageId: 'home', label: 'Home' },
      { pageId: 'about', label: 'About' },
    ]);
  });

  it('a menu label that equals the title and the headings that equal it follow a new title; worded ones stay', async () => {
    const onSave = vi.fn(async (next: AppSpec) => ({ ok: true as const, record: { id: 'a', name: '', slug: '', revision: 2, spec: next, issues: [], createdAt: '', updatedAt: '' } }));
    const follow: AppSpec = {
      ...spec,
      pages: spec.pages.map((p) => (p.id === 'home' ? { ...p, layout: { ...p.layout, children: [{ id: 'h1', type: 'Heading', props: { size: 'lg' }, children: 'Home' }, { id: 'h2', type: 'Heading', props: { size: 'md' }, children: 'Welcome' }] } } : p)),
    };
    render(<PageSettingsDialog spec={follow} pageId="home" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dashboard' } });
    expect((screen.getByLabelText('Menu label') as HTMLInputElement).value).toBe('Dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Save page settings' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const next = onSave.mock.calls[0][0];
    expect(next.nav[0].label).toBe('Dashboard');
    expect((next.pages[0].layout.children as Array<{ children: string }>).map((c) => c.children)).toEqual(['Dashboard', 'Welcome']);
  });

  it('keeps a menu label the person worded when the title changes', () => {
    render(<PageSettingsDialog spec={{ ...spec, nav: [{ pageId: 'home', label: 'Start' }] }} pageId="home" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dashboard' } });
    expect((screen.getByLabelText('Menu label') as HTMLInputElement).value).toBe('Start');
  });

  it('blocks saving and names the problem when the route is invalid', () => {
    const onSave = vi.fn();
    render(<PageSettingsDialog spec={spec} pageId="about" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Web address in the app'), { target: { value: '/Bad Route' } });
    expect((screen.getByRole('button', { name: 'Save page settings' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a title another page has and keeps the page unchanged (P-34)', () => {
    const onSave = vi.fn();
    render(<PageSettingsDialog spec={spec} pageId="about" onSave={onSave} onCancel={() => {}} />);
    const title = screen.getByLabelText('Title');
    fireEvent.change(title, { target: { value: ' home ' } });
    expect(screen.getByText('A page called Home already exists. Pick another title.')).toBeTruthy();
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Save page settings' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(title.closest('form') as HTMLFormElement);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers record mode only on a route that ends in /:id', () => {
    const recordSpec: AppSpec = { ...spec, pages: spec.pages.map((p) => (p.id === 'about' ? { ...p, route: '/about/:id', sources: [{ id: 'one', table: 'crews', mode: 'list', where: [], orderBy: [], limit: 5 }] } : p)) };
    render(<PageSettingsDialog spec={recordSpec} pageId="about" onSave={vi.fn()} onCancel={() => {}} />);
    const mode = screen.getByLabelText('Shows for Crews') as HTMLSelectElement;
    expect([...mode.options].map((o) => o.value)).toEqual(['list', 'record']);
  });
  it('shows a problem under the input it belongs to, in plain words, and marks the input', () => {
    render(<PageSettingsDialog spec={spec} pageId="about" onSave={vi.fn()} onCancel={() => {}} />);
    const address = screen.getByLabelText('Web address in the app');
    fireEvent.change(address, { target: { value: '/Bad Route' } });
    expect(address.getAttribute('aria-invalid')).toBe('true');
    const note = document.getElementById(address.getAttribute('aria-describedby') ?? 'none');
    expect(note).not.toBeNull();
    expect(note?.textContent ?? '').not.toMatch(/Invalid input|pages\.\d/);
    expect(screen.getByRole('alert').textContent).toBe('Fix 1 problem to save.');
  });

  it('says the home page is the first page the app opens, and calls the lists by their table', () => {
    const withList: AppSpec = { ...spec, pages: spec.pages.map((p) => (p.id === 'home' ? { ...p, sources: [{ id: 'all_crews', table: 'crews', mode: 'list' as const, where: [], orderBy: [], limit: 5 }] } : p)) };
    render(<PageSettingsDialog spec={withList} pageId="home" onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByText('The home page is the first page the app opens.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Lists on this page' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove list Crews' })).toBeTruthy();
    expect(screen.queryByText('all_crews')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    const operator = screen.getByLabelText('Filter operator 1 for Crews') as HTMLSelectElement;
    expect([...operator.options].map((o) => o.textContent)).toContain('is not');
    expect([...operator.options].map((o) => o.textContent)).not.toContain('ne');
    const fields = [...(screen.getByLabelText('Filter field 1 for Crews') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(fields).toEqual(['Record number', 'Name', 'Created', 'Updated']);
  });

  it('offers the choices of a Choice field for a filter value instead of free text', () => {
    const choice: AppSpec = {
      ...spec,
      tables: [{ id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['open', 'done'], required: false }] }],
      pages: spec.pages.map((p) => (p.id === 'home' ? { ...p, sources: [{ id: 'all_crews', table: 'crews', mode: 'list' as const, where: [{ field: 'status', op: 'eq' as const, value: null }], orderBy: [], limit: 5 }] } : p)),
    };
    render(<PageSettingsDialog spec={choice} pageId="home" onSave={vi.fn()} onCancel={() => {}} />);
    const value = screen.getByLabelText('Filter value 1 for Crews') as HTMLSelectElement;
    expect([...value.options].map((o) => o.textContent)).toEqual(['Pick one', 'open', 'done']);
    fireEvent.change(value, { target: { value: 'done' } });
    expect((screen.getByLabelText('Filter value 1 for Crews') as HTMLSelectElement).value).toBe('done');
    fireEvent.change(screen.getByLabelText('Filter operator 1 for Crews'), { target: { value: 'in' } });
    fireEvent.click(screen.getByLabelText('open'));
    expect((screen.getByLabelText('open') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('done') as HTMLInputElement).checked).toBe(false);
  });

  it('R-9: shows a stored choice that is no longer an option as a disabled option, and keeps it in "is one of"', async () => {
    const gone = (op: 'eq' | 'in', value: string | string[]): AppSpec => ({
      ...spec,
      tables: [{ id: 'crews', label: 'Crews', titleField: 'name', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'status', label: 'Status', type: 'select', options: ['open', 'done'], required: false }] }],
      pages: spec.pages.map((p) => (p.id === 'home' ? { ...p, sources: [{ id: 'all_crews', table: 'crews', mode: 'list' as const, where: [{ field: 'status', op, value }], orderBy: [], limit: 5 }] } : p)),
    });
    const one = render(<PageSettingsDialog spec={gone('eq', 'old')} pageId="home" onSave={vi.fn()} onCancel={() => {}} />);
    const select = (await screen.findByRole('combobox', { name: 'Filter value 1 for Crews' }, { timeout: 5000 })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('old'), { timeout: 5000 });
    expect(select.value).toBe('old');
    const stored = [...select.options].find((o) => o.value === 'old');
    expect(stored?.disabled).toBe(true);
    expect(stored?.textContent).toBe('old (no longer an option)');
    one.unmount();
    const many = render(<PageSettingsDialog spec={gone('in', ['old', 'open'])} pageId="home" onSave={vi.fn()} onCancel={() => {}} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'done' }, { timeout: 5000 }));
    expect((screen.getByLabelText('old (no longer an option)') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('open') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('done') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('old (no longer an option)'));
    expect(screen.queryByLabelText('old (no longer an option)')).toBeNull();
    many.unmount();
  });

  it('with no table points to New table in Design, not to the Data step', () => {
    render(<PageSettingsDialog spec={{ ...spec, tables: [] }} pageId="home" onSave={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByText('This app has no table yet. Put a part that shows records on a page and press New table on it.')).toBeTruthy();
    expect(screen.queryByText(/in Data first/)).toBeNull();
  });
});
