import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crewRoster from '../../spec/fixtures/crew-roster.json';
import { SpecApp, SpecPage } from '../index.js';
import { SpecRenderer } from '../SpecRenderer.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const layer = (id, type, props = {}, children = []) => ({ id, type, props, children });
const goTo = (pageId) => ({ action: 'navigate', pageId, withRecord: false });

const twoPages = {
  specVersion: 1,
  app: { name: 'Two Pages', slug: 'two-pages', identifier: 'com.example.two', version: '1.0.0', description: '', icon: null },
  tables: [],
  pages: [
    {
      id: 'home',
      title: 'Home',
      route: '/',
      sources: [],
      layout: layer('root', 'Page', {}, [layer('h', 'Heading', {}, 'Welcome'), layer('b', 'Button', { action: goTo('about') }, 'About')]),
    },
    {
      id: 'about',
      title: 'About',
      route: '/about',
      sources: [],
      layout: layer('root2', 'Page', {}, [layer('h2', 'Heading', {}, 'About us'), layer('b2', 'Button', { variant: 'secondary', action: goTo('home') }, 'Back')]),
    },
  ],
  nav: [],
  theme: { preset: 'aurora', radius: 'md' },
};

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const inRouter = (ui, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}<Where /></MemoryRouter>);

const rowsReply = (rows) => new Response(JSON.stringify({ data: { rows, total: rows.length, limit: 50, offset: 0 } }), { status: 200 });

describe('SpecRenderer', () => {
  it('renders a layer tree with the given components and tags each layer', () => {
    const components = {
      Box: ({ children, ...rest }) => <div data-testid={rest['data-testid']}>{children}</div>,
      Words: ({ children }) => <span>{children}</span>,
    };
    render(<SpecRenderer components={components} layer={layer('a', 'Box', {}, [layer('b', 'Words', {}, 'hello')])} />);
    expect(screen.getByTestId('a').textContent).toBe('hello');
  });

  it('ignores a feature marker: a block renders like its parts and the marker never reaches a part', () => {
    const seen = [];
    const components = {
      Box: ({ children, ...rest }) => {
        seen.push(rest);
        return <div data-testid={rest['data-testid']}>{children}</div>;
      },
      Words: ({ children }) => <span>{children}</span>,
    };
    const block = { ...layer('a', 'Box', {}, [layer('b', 'Words', {}, 'hello')]), feature: { id: 'kpi_row', version: 1, params: { title: 'Crews' } } };
    render(<SpecRenderer components={components} layer={block} />);
    expect(screen.getByTestId('a').textContent).toBe('hello');
    expect(seen.every((p) => !('feature' in p))).toBe(true);
  });

  it('says so for an unknown part and survives a part that throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const components = {
      Boom: () => {
        throw new Error('x');
      },
    };
    render(
      <>
        <SpecRenderer components={components} layer={layer('a', 'Nope')} />
        <SpecRenderer components={components} layer={layer('b', 'Boom')} />
      </>,
    );
    expect(screen.getByText('This part is not available.')).toBeTruthy();
    expect(screen.getByText('This part could not be shown.')).toBeTruthy();
    quiet.mockRestore();
  });
});

describe('SpecPage', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => rowsReply([]))));

  it('renders the layout of one page with the catalog', () => {
    render(<SpecPage spec={twoPages} pageId="about" />);
    expect(screen.getByRole('heading', { name: 'About us' })).toBeTruthy();
    expect(screen.queryByText('Welcome')).toBeNull();
  });

  it('says so for a page that is not in the spec', () => {
    render(<SpecPage spec={twoPages} pageId="missing" />);
    expect(screen.getByText('This page is not part of the app.')).toBeTruthy();
  });

  it('runs navigate through the handler it is given', () => {
    const seen = [];
    render(<SpecPage spec={twoPages} pageId="home" navigate={(id, opts) => seen.push([id, opts.withRecord])} />);
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(seen).toEqual([['about', false]]);
  });
});

describe('SpecApp', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => rowsReply([]))));

  it('shows the page for the current location and follows navigate actions', async () => {
    inRouter(<SpecApp spec={twoPages} />);
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    expect(await screen.findByRole('heading', { name: 'About us' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/about');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('honors a base path', async () => {
    inRouter(<SpecApp spec={twoPages} basePath="/app" />, '/app/about');
    expect(screen.getByRole('heading', { name: 'About us' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/app'));
  });

  it('shows a not-found card that links home', () => {
    inRouter(<SpecApp spec={twoPages} />, '/nowhere');
    expect(screen.getByText('Page not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/');
  });

  it('renders the crew roster fixture: heading and rows from the data API', async () => {
    const fetchMock = vi.fn(async (url) =>
      String(url).startsWith('/api/data/crews')
        ? rowsReply([{ id: 'c1', name: 'Alpha crew', size: 4, status: 'active', lead_id: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }])
        : rowsReply([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    inRouter(<SpecApp spec={crewRoster} />);
    expect(screen.getByRole('heading', { name: 'Open crews' })).toBeTruthy();
    expect(await screen.findByText('Alpha crew')).toBeTruthy();
    const url = new URL(String(fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/api/data/crews'))[0]), 'http://x');
    expect(url.searchParams.get('page')).toBe('home');
    expect(url.searchParams.get('source')).toBe('open_crews');
  });
});
