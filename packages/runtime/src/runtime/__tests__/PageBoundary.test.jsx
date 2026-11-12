// A page that throws shows the plain fallback with its next action, and the app menu stays usable.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_TEXT } from '@/catalog/errorText.ts';
import { SpecApp } from '../index.js';

vi.mock('../SpecRenderer.jsx', () => ({
  SpecRenderer: ({ layer }) => {
    if (layer.id === 'boom') throw new Error('render exploded');
    return <p>{`Page ${layer.id}`}</p>;
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const layer = (id) => ({ id, type: 'Page', props: {}, children: [] });
const spec = {
  specVersion: 1,
  app: { name: 'Boundary App', slug: 'boundary-app', identifier: 'com.example.boundary', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [
    { id: 'home', title: 'Home', route: '/', sources: [], layout: layer('ok') },
    { id: 'bad', title: 'Bad', route: '/bad', sources: [], layout: layer('boom') },
  ],
  nav: [
    { pageId: 'home', label: 'Start' },
    { pageId: 'bad', label: 'Broken' },
  ],
  theme: { preset: 'aurora', radius: 'md' },
  menu: { position: 'side' },
};

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/bad']}>
      <SpecApp spec={spec} />
    </MemoryRouter>,
  );

describe('PageBoundary in SpecApp', () => {
  it('names what happened and the next step, keeps the menu, and a menu click reaches another page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(ERROR_TEXT.boundaryTitle);
    expect(alert.textContent).toContain(ERROR_TEXT.boundarySafe);
    expect(alert.textContent).toContain(ERROR_TEXT.boundaryAction);
    expect(screen.getByRole('button', { name: ERROR_TEXT.reload })).toBeTruthy();
    expect(screen.getByRole('link', { name: ERROR_TEXT.goHome })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Start' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Page ok')).toBeTruthy();
  });

  it('Reload calls location.reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    mount();
    fireEvent.click(screen.getByRole('button', { name: ERROR_TEXT.reload }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('on the home page hides the home link, and an app with no menu is not told to use one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const noMenu = { ...spec, menu: undefined, pages: [{ id: 'home', title: 'Home', route: '/', sources: [], layout: layer('boom') }], nav: [] };
    render(
      <MemoryRouter initialEntries={['/']}>
        <SpecApp spec={noMenu} />
      </MemoryRouter>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(ERROR_TEXT.boundaryActionNoMenu);
    expect(alert.textContent).not.toContain('menu');
    expect(screen.queryByRole('link', { name: ERROR_TEXT.goHome })).toBeNull();
  });
});
