// G-01 without cargo: the real App tree in runtime mode with a baked spec shows the designed app and nothing of the kit
// shell (no greeting, date, clock, palette, burger, floating launcher or Welcome dialog), the entry (Assistant, Settings)
// at the end of the designed menu bar or in the corner, and a Settings page with only what a built app needs.
// Each case loads the app fresh (the baked spec is read at import), React and Testing Library included, so there is one copy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const state = vi.hoisted(() => ({ spec: null, setup: { ready: true, ollama: 'running' } }));

// The mode is mocked, not set in the environment: a shared variable would leak into a build another test file runs at the same time.
vi.mock('../../../appMode.js', () => ({ APP_MODE: 'runtime' }));

vi.mock('@local-app-studio/runtime/runtime/bakedSpec.js', () => ({
  get default() {
    return state.spec;
  },
}));
vi.mock('../../../auth/AuthGate', () => ({ default: ({ children }) => children }));
vi.mock('../../../hooks/useProfile', () => ({
  useProfile: () => ({ onboarded: false, isLoading: false, unresolved: false, displayName: null, save: vi.fn() }),
}));
vi.mock('../../../services/stateService', () => ({
  stateService: { getAll: vi.fn(async () => ({})), get: vi.fn(async () => undefined), put: vi.fn(async () => ({ ok: true })) },
}));
vi.mock('../../../hooks/useAssistantStatus', () => ({ useAssistantStatus: () => ({ status: null }) }));
vi.mock('../../../services/auditService', () => ({
  auditService: { list: vi.fn(async () => ({ entries: [], nextBefore: null, available: true })) },
}));
vi.mock('../../../services/secretsService', () => ({
  secretsService: {
    list: vi.fn(async () => ({ encryption: { enabled: true }, storage: { available: true }, writable: true, secrets: [] })),
    save: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));
vi.mock('../../../services/aiSettingsService', () => ({
  aiSettingsService: {
    get: vi.fn(() => new Promise(() => {})),
    models: vi.fn(() => new Promise(() => {})),
    setup: vi.fn(async () => state.setup),
    pull: vi.fn(),
  },
}));

const layer = (id, type, props = {}, children = []) => ({ id, type, props, children });
const makeSpec = (menu) => ({
  specVersion: 1,
  app: {
    name: 'Field Crew Board',
    slug: 'field-crew-board',
    identifier: 'com.example.fieldcrew',
    version: '1.2.0',
    description: 'Who is on which job.',
    icon: null,
  },
  tables: [],
  pages: [
    { id: 'home', title: 'Home', route: '/', sources: [], layout: layer('root', 'Page', {}, [layer('h', 'Heading', {}, 'Welcome crew')]) },
    { id: 'about', title: 'About', route: '/about', sources: [], layout: layer('root2', 'Page', {}, [layer('h2', 'Heading', {}, 'About us')]) },
  ],
  nav: [
    { pageId: 'home', label: 'Start', icon: 'home' },
    { pageId: 'about', label: 'About us' },
  ],
  theme: { preset: 'aurora', radius: 'md' },
  ...(menu === undefined ? {} : { menu }),
});

/** Loads the whole app fresh for `spec` and renders it at `path`. */
async function mountApp(spec, path = '/') {
  state.spec = spec;
  vi.resetModules();
  window.history.pushState({}, '', path);
  const [rtl, query, app, ue] = await Promise.all([
    import('@testing-library/react'),
    import('@tanstack/react-query'),
    import('../../../App.jsx'),
    import('@testing-library/user-event'),
  ]);
  const App = app.default;
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = rtl.render(
    <query.QueryClientProvider client={client}>
      <App />
    </query.QueryClientProvider>,
  );
  return { ...utils, screen: rtl.screen, within: rtl.within, fireEvent: rtl.fireEvent, waitFor: rtl.waitFor, cleanup: rtl.cleanup, user: ue.default.setup() };
}

let mounted = null;
const mount = async (...args) => {
  mounted = await mountApp(...args);
  return mounted;
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [], meta: { total: 0 } }), { status: 200 })));
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  mounted?.cleanup();
  mounted = null;
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
});

describe('a built app with a menu bar', () => {
  it('shows the designed menu first, then the page, and none of the kit chrome', async () => {
    const { container, screen } = await mount(makeSpec({ position: 'top' }));
    const menu = await screen.findByRole('navigation', { name: 'App menu' });
    expect(await screen.findByRole('heading', { name: 'Welcome crew' })).toBeInTheDocument();

    const main = container.querySelector('main[data-runtime-shell]');
    expect(main).not.toBeNull();
    expect(main.querySelector('nav')).toBe(menu);
    // Nothing renders before the menu inside main: every ancestor up to main is a first child.
    for (let el = menu; el !== main; el = el.parentElement) expect(el.previousElementSibling).toBeNull();

    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).toBeNull();
    expect(screen.queryByText(/local time/i)).toBeNull();
    expect(screen.queryByText(/Ctrl K/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Navigation menu' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask Assistant about this page' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('#bg-layer')).not.toBeNull();
  });

  it('ends the menu with the Assistant button and the Settings link', async () => {
    const { screen, within } = await mount(makeSpec({ position: 'top' }));
    const menu = await screen.findByRole('navigation', { name: 'App menu' });
    const items = menu.querySelectorAll('li');
    expect([...items].map((li) => li.textContent)).toEqual(['Start', 'About us']);
    // The entry sits beside the list, after it, outside the scrolling box.
    const trail = menu.parentElement.lastElementChild;
    expect(menu.contains(trail)).toBe(false);
    const last = within(trail);
    const assistant = last.getByRole('button', { name: 'Assistant' });
    const settings = last.getByRole('link', { name: 'Settings' });
    expect(assistant.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(settings).toHaveAttribute('href', '/settings');
  });

  it('the first press of Assistant offers Set up Assistant when it is not ready, with no Back button', async () => {
    state.setup = { ready: false, ollama: 'stopped', models: [], recommended: { tier: 'mid', ramGb: 16, primary: [], optional: [] }, canPull: false };
    try {
      const { screen, user } = await mount(makeSpec({ position: 'top' }));
      await user.click(await screen.findByRole('button', { name: 'Assistant' }));
      expect(await screen.findByRole('dialog', { name: 'Set up Assistant' }, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
      expect(screen.queryByText(/what should .* call you/i)).toBeNull();
    } finally {
      state.setup = { ready: true, ollama: 'running' };
    }
  });
});

describe('the Set up Assistant offer', () => {
  const notReady = { ready: false, ollama: 'stopped', models: [], recommended: { tier: 'mid', ramGb: 16, primary: [], optional: [] }, canPull: false };
  /** Counts the Assistant open events and notes whether a dialog was still on screen when each fired. */
  const watchAssistant = () => {
    const seen = [];
    const on = () => seen.push(document.querySelector('[role="dialog"]') !== null);
    window.addEventListener('assistant:open', on);
    return { seen, stop: () => window.removeEventListener('assistant:open', on) };
  };

  it('ignores a second press while the check runs and offers the setup once', async () => {
    state.setup = notReady;
    const watch = watchAssistant();
    try {
      const { screen, fireEvent } = await mount(makeSpec({ position: 'top' }));
      const button = await screen.findByRole('button', { name: 'Assistant' });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-busy', 'true');
      expect(await screen.findByRole('dialog', { name: 'Set up Assistant' }, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(button).not.toHaveAttribute('aria-busy');
      expect(watch.seen).toEqual([]);
    } finally {
      watch.stop();
      state.setup = { ready: true, ollama: 'running' };
    }
  });

  it('opens the Assistant only after the dialog has unmounted', async () => {
    state.setup = notReady;
    const watch = watchAssistant();
    try {
      const { screen, user, waitFor } = await mount(makeSpec({ position: 'top' }));
      await user.click(await screen.findByRole('button', { name: 'Assistant' }));
      await screen.findByRole('dialog', { name: 'Set up Assistant' }, { timeout: 5000 });
      await user.click(screen.getByRole('button', { name: 'Skip for now' }));
      await waitFor(() => expect(watch.seen).toHaveLength(1), { timeout: 5000 });
      expect(watch.seen).toEqual([false]);
    } finally {
      watch.stop();
      state.setup = { ready: true, ollama: 'running' };
    }
  });

  it('keeps the dialog when the person goes to Settings', async () => {
    state.setup = notReady;
    try {
      const { screen, user } = await mount(makeSpec({ position: 'top' }));
      await user.click(await screen.findByRole('button', { name: 'Assistant' }));
      await screen.findByRole('dialog', { name: 'Set up Assistant' }, { timeout: 5000 });
      window.history.pushState({}, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(await screen.findByRole('link', { name: 'Back to Field Crew Board' })).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Set up Assistant' })).toBeInTheDocument();
    } finally {
      state.setup = { ready: true, ollama: 'running' };
    }
  });
});

describe('a built app with no menu bar', () => {
  it('shows the page and one corner pill with both controls', async () => {
    const { container, screen, within } = await mount(makeSpec(undefined));
    expect(await screen.findByRole('heading', { name: 'Welcome crew' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'App menu' })).toBeNull();
    const pills = container.querySelectorAll('[data-runtime-corner]');
    expect(pills).toHaveLength(1);
    expect(within(pills[0]).getByRole('button', { name: 'Assistant' })).toBeInTheDocument();
    expect(within(pills[0]).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).toBeNull();
  });
});

describe('Settings in a built app', () => {
  it('has a way back and only the sections a built app needs', async () => {
    const { container, screen } = await mount(makeSpec({ position: 'top' }), '/settings');
    const back = await screen.findByRole('link', { name: 'Back to Field Crew Board' });
    expect(back).toHaveAttribute('href', '/');
    expect(container.querySelector('[data-runtime-back]')).not.toBeNull();
    await screen.findByRole('heading', { name: 'Settings' });
    expect(await screen.findByText('Field Crew Board, version 1.2.0.')).toBeInTheDocument();
    for (const id of ['appearance', 'ai', 'data-storage', 'privacy', 'network', 'runtime-data']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    for (const id of ['general', 'api-keys', 'license']) expect(container.querySelector(`#${id}`), id).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'About this app' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Connected services')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--topbar-h')).toBe('0px');
  });

  it('lists About this app in the section nav', async () => {
    const { screen, within } = await mount(makeSpec({ position: 'top' }), '/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    const nav = screen.getAllByRole('navigation', { name: 'Settings sections' })[0];
    expect(await within(nav).findByRole('link', { name: 'About this app' })).toHaveAttribute('href', '#runtime-data');
  });

  it('jumps to Data and storage for /settings#data-storage and shows the export control', async () => {
    const scrolled = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scroll() {
      scrolled.push(this.id);
    };
    try {
      const { screen, waitFor } = await mount(makeSpec({ position: 'top' }), '/settings#data-storage');
      expect(await screen.findByRole('button', { name: /Export all data/ })).toBeInTheDocument();
      await waitFor(() => expect(scrolled).toContain('data-storage'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('a spec page shows no back bar', async () => {
    const { container, screen } = await mount(makeSpec({ position: 'top' }), '/about');
    expect(await screen.findByRole('heading', { name: 'About us' })).toBeInTheDocument();
    expect(container.querySelector('[data-runtime-back]')).toBeNull();
  });
});
