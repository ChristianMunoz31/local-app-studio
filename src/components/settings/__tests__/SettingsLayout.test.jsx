import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Settings from '../../../pages/Settings';
import SettingsLayout from '../SettingsLayout';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import { ToastProvider } from '../../../contexts/ToastContext';
import { installMatchMedia, resetDom } from '../../../test-utils/settingsHarness';
import { allowSlowSuite } from '../../../test-utils/slowSuite';

vi.mock('../../../services/stateService', () => ({
  stateService: {
    getAll: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
    put: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock('../../../hooks/useAssistantStatus', () => ({ useAssistantStatus: () => ({ status: null }) }));
vi.mock('../../../services/auditService', () => ({
  auditService: {
    list: vi.fn(async () => ({ entries: [], nextBefore: null, available: true })),
  },
}));
vi.mock('../../../services/secretsService', () => ({
  secretsService: {
    list: vi.fn(async () => ({
      encryption: { enabled: true },
      storage: { available: true },
      writable: true,
      secrets: [],
    })),
    save: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));

vi.mock('../../../services/aiSettingsService', () => ({
  aiSettingsService: {
    get: vi.fn(() => new Promise(() => {})),
    models: vi.fn(() => new Promise(() => {})),
  },
}));


const SECTIONS = [
  ['appearance', 'Appearance'],
  ['general', 'General'],
  ['ai', 'AI'],
  ['data-storage', 'Data & storage'],
  ['privacy', 'Privacy & activity'],
  ['network', 'Network'],
  ['api-keys', 'Connected services'],
  ['license', 'License'],
];

// --- globals mocked per test -------------------------------------------------------------
let scrollIntoView;
let scrollTo;
let observers;
const origScrollTo = Object.getOwnPropertyDescriptor(window, 'scrollTo');
const origIO = globalThis.IntersectionObserver;
const origScrollIntoViewDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
const origInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const origScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');

class FakeIO {
  constructor(cb, options) {
    this.cb = cb;
    this.options = options;
    this.targets = [];
    this.disconnect = vi.fn();
    observers.push(this);
  }
  observe(el) {
    this.targets.push(el);
  }
  unobserve() {}
}

function fire(observer, entries) {
  act(() => {
    observer.cb(
      entries.map(([id, isIntersecting]) => ({ target: document.getElementById(id), isIntersecting })),
    );
  });
}

function setBottom(on) {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 3000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: on ? 2200 : 0 });
}

beforeEach(() => {
  resetDom();
  installMatchMedia(false);
  scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
  observers = [];
  globalThis.IntersectionObserver = FakeIO;
  scrollTo = vi.fn();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetDom();
  globalThis.IntersectionObserver = origIO;
  if (origScrollIntoViewDesc) Object.defineProperty(Element.prototype, 'scrollIntoView', origScrollIntoViewDesc);
  else delete Element.prototype.scrollIntoView;
  delete document.documentElement.scrollHeight;
  if (origScrollTo) Object.defineProperty(window, 'scrollTo', origScrollTo);
  else delete window.scrollTo;
  if (origInnerHeight) Object.defineProperty(window, 'innerHeight', origInnerHeight);
  if (origScrollY) Object.defineProperty(window, 'scrollY', origScrollY);
});

async function renderSettings(url = '/settings') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <ThemeProvider>
            <Settings />
          </ThemeProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

const navs = () => screen.getAllByRole('navigation', { name: 'Settings sections' });
const item = (nav, name) => within(nav).getByRole('link', { name });

// Heavy render-and-wait suite: raise the time limits so a busy machine does not trip them.
allowSlowSuite();

describe('SettingsLayout nav structure (real Settings page)', () => {
  it('renders two section navs: mobile pill bar and desktop sidebar', async () => {
    await renderSettings();
    const [mobile, desktop] = navs();
    expect(navs()).toHaveLength(2);
    expect(mobile).toHaveClass('md:hidden');
    expect(desktop).toHaveClass('hidden', 'md:block');
  });

  it('lists every section in page order, each targeting a rendered section id', async () => {
    await renderSettings();
    for (const nav of navs()) {
      const links = within(nav).getAllByRole('link');
      expect(links.map((a) => a.textContent)).toEqual(SECTIONS.map(([, label]) => label));
      SECTIONS.forEach(([id], i) => {
        expect(links[i]).toHaveAttribute('href', `#${id}`);
        const target = document.getElementById(id);
        expect(target).toBeInTheDocument();
        const heading = document.getElementById(`${id}-heading`);
        expect(heading).toBeInTheDocument();
        expect(heading).toHaveAttribute('tabindex', '-1');
        expect(target).toContainElement(heading);
      });
    }
  });

  it('page order of the section elements matches the nav order', async () => {
    await renderSettings();
    const els = SECTIONS.map(([id]) => document.getElementById(id));
    for (let i = 1; i < els.length; i += 1) {
      expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('marks only the first section active initially', async () => {
    await renderSettings();
    for (const nav of navs()) {
      expect(item(nav, 'Appearance')).toHaveAttribute('aria-current', 'location');
      expect(within(nav).getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
    }
  });

  it('renders one list item per section and no extra links', async () => {
    await renderSettings();
    for (const nav of navs()) {
      expect(nav.querySelectorAll('ul > li')).toHaveLength(SECTIONS.length);
    }
  });
});

describe('mobile pill bar', () => {
  it('contains all eight section links and scrolls horizontally', async () => {
    await renderSettings();
    const [mobile] = navs();
    for (const [, label] of SECTIONS) expect(item(mobile, label)).toBeInTheDocument();
    expect(within(mobile).getAllByRole('link')).toHaveLength(SECTIONS.length);
    expect(mobile.querySelector('ul')).toHaveClass('overflow-x-auto');
  });
});

describe('click behaviour on /settings', () => {
  it('scrolls, replaces history (no push), focuses the heading and sets aria-current', async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');
    await renderSettings();

    await user.click(item(navs()[1], 'Connected services'));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('api-keys'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][2]).toBe('#api-keys');
    expect(pushState).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('api-keys-heading'));
    for (const nav of navs()) {
      expect(item(nav, 'Connected services')).toHaveAttribute('aria-current', 'location');
      expect(item(nav, 'Appearance')).not.toHaveAttribute('aria-current');
    }
  });

  it('works from the mobile pill bar too', async () => {
    const user = userEvent.setup();
    await renderSettings();
    await user.click(item(navs()[0], 'Data & storage'));
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('data-storage'));
    expect(document.activeElement).toBe(document.getElementById('data-storage-heading'));
    expect(item(navs()[1], 'Data & storage')).toHaveAttribute('aria-current', 'location');
  });

  it('prevents default navigation (href hash is not followed by the router)', async () => {
    await renderSettings();
    const link = item(navs()[1], 'General');
    const notPrevented = link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(notPrevented).toBe(false);
  });

  it('does not hijack modified or non-primary clicks (ctrl-click opens normally)', async () => {
    await renderSettings();
    const link = item(navs()[1], 'General');
    const ctrl = link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    const middle = link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(ctrl).toBe(true);
    expect(middle).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('uses behavior "auto" when the user prefers reduced motion', async () => {
    installMatchMedia(true);
    const user = userEvent.setup();
    await renderSettings();
    await user.click(item(navs()[1], 'Connected services'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('does not throw when scrollIntoView is unavailable', async () => {
    delete Element.prototype.scrollIntoView;
    const user = userEvent.setup();
    await renderSettings();
    await user.click(item(navs()[1], 'Data & storage'));
    expect(item(navs()[1], 'Data & storage')).toHaveAttribute('aria-current', 'location');
  });
});

describe('deep link', () => {
  it('scrolls to the hash section (instant) and marks it active', async () => {
    await renderSettings('/settings#api-keys');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('api-keys'));
    for (const nav of navs()) {
      expect(item(nav, 'Connected services')).toHaveAttribute('aria-current', 'location');
    }
  });

  it('ignores an unknown hash', async () => {
    await renderSettings('/settings#nope');
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(item(navs()[1], 'Appearance')).toHaveAttribute('aria-current', 'location');
  });

  it('does not scroll when there is no hash', async () => {
    await renderSettings('/settings');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('mobile pill bar centring', () => {
  const protoKeys = ['offsetLeft', 'offsetWidth', 'clientWidth'];
  const saved = {};
  beforeEach(() => {
    for (const k of protoKeys) saved[k] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, k);
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, value: 500 });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 300 });
  });
  afterEach(() => {
    for (const k of protoKeys) {
      if (saved[k]) Object.defineProperty(HTMLElement.prototype, k, saved[k]);
      else delete HTMLElement.prototype[k];
    }
  });

  it('scrolls the pill list (not the window) so the active pill is centred', async () => {
    const user = userEvent.setup();
    await renderSettings();
    await user.click(item(navs()[0], 'Data & storage'));
    const ul = navs()[0].querySelector('ul');
    expect(ul.scrollLeft).toBe(400);
    // Only the click's own section scroll touched scrollIntoView.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe('scroll spy integration', () => {
  it('observes every section with the configured rootMargin', async () => {
    await renderSettings();
    expect(observers).toHaveLength(1);
    expect(observers[0].targets.map((el) => el.id)).toEqual(SECTIONS.map(([id]) => id));
    expect(observers[0].options.rootMargin).toMatch(/px/);
  });

  it('moves aria-current to Data & storage when it intersects', async () => {
    await renderSettings();
    fire(observers[0], [['data-storage', true]]);
    for (const nav of navs()) {
      expect(item(nav, 'Data & storage')).toHaveAttribute('aria-current', 'location');
      expect(item(nav, 'Appearance')).not.toHaveAttribute('aria-current');
    }
  });

  it('picks the topmost visible section when several intersect', async () => {
    await renderSettings();
    fire(observers[0], [['ai', true], ['general', true]]);
    expect(item(navs()[1], 'General')).toHaveAttribute('aria-current', 'location');
    fire(observers[0], [['general', false]]);
    expect(item(navs()[1], 'AI')).toHaveAttribute('aria-current', 'location');
  });

  it('forces the last section active at the bottom of the page (observer)', async () => {
    await renderSettings();
    setBottom(true);
    fire(observers[0], [['general', true]]);
    expect(item(navs()[1], 'License')).toHaveAttribute('aria-current', 'location');
    expect(item(navs()[1], 'General')).not.toHaveAttribute('aria-current');
  });

  it('forces the last section active on a window scroll to the bottom', async () => {
    await renderSettings();
    setBottom(true);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(item(navs()[1], 'License')).toHaveAttribute('aria-current', 'location');
  });

  it('a scroll that is not at the bottom changes nothing', async () => {
    await renderSettings();
    setBottom(false);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(item(navs()[1], 'Appearance')).toHaveAttribute('aria-current', 'location');
  });

  it('rebuilds the observer rootMargin when --topbar-h changes on <html>', async () => {
    installMatchMedia(true); // every query matches: desktop (md+) band gap of 16px
    await renderSettings();
    document.documentElement.style.setProperty('--topbar-h', '110px');
    try {
      await waitFor(() => expect(observers.at(-1).options.rootMargin).toBe('-126px 0px -60% 0px'));
    } finally {
      document.documentElement.style.removeProperty('--topbar-h');
    }
  });

  it('picks up a --topbar-h published before the layout effect attached its observer', async () => {
    installMatchMedia(true);
    // Child effects run before the parent's, so this mimics TopBar publishing after render
    // but before SettingsLayout's MutationObserver exists.
    function PublishTopbar() {
      useEffect(() => {
        document.documentElement.style.setProperty('--topbar-h', '110px');
      }, []);
      return null;
    }
    try {
      render(
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsLayout>
            <PublishTopbar />
          </SettingsLayout>
        </MemoryRouter>,
      );
      await waitFor(() => expect(observers.at(-1).options.rootMargin).toBe('-126px 0px -60% 0px'));
    } finally {
      document.documentElement.style.removeProperty('--topbar-h');
    }
  });

  it('disconnects the observer on unmount', async () => {
    const { unmount } = await renderSettings();
    expect(observers[0].disconnect).not.toHaveBeenCalled();
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  });
});

// --- off the settings home (a sub-page under /settings) variant --------------------------------------------------------------
function Probe() {
  const { pathname, hash } = useLocation();
  return <output data-testid="loc">{`${pathname}${hash}`}</output>;
}

function renderLayout(url) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SettingsLayout>
        <p>content</p>
      </SettingsLayout>
      <Probe />
    </MemoryRouter>,
  );
}

describe('SettingsLayout on a sub-page under /settings', () => {
  it('section items are router links without aria-current', () => {
    renderLayout('/settings/sub');
    for (const nav of navs()) {
      for (const [id, label] of SECTIONS) {
        const link = item(nav, label);
        expect(link).toHaveAttribute('href', `/settings#${id}`);
        expect(link).not.toHaveAttribute('aria-current');
      }
    }
  });

  it('does not observe sections while off the settings page', () => {
    renderLayout('/settings/sub');
    expect(observers).toHaveLength(0);
  });

  it('clicking a section link navigates to /settings with that hash', async () => {
    const user = userEvent.setup();
    renderLayout('/settings/sub');
    await user.click(item(navs()[1], 'Data & storage'));
    expect(screen.getByTestId('loc')).toHaveTextContent('/settings#data-storage');
    await waitFor(() => expect(item(navs()[1], 'Data & storage')).toHaveAttribute('aria-current', 'location'));
  });

  it('treats a trailing slash on /settings/ as the settings home', () => {
    renderLayout('/settings/');
    expect(item(navs()[1], 'Appearance')).toHaveAttribute('href', '#appearance');
  });

  it('renders children', () => {
    renderLayout('/settings/sub');
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('compares the pathname case-insensitively', () => {
    renderLayout('/Settings');
    expect(item(navs()[1], 'Appearance')).toHaveAttribute('href', '#appearance');
  });

  it('scrolls to the top when the pathname changes and there is no hash', async () => {
    const user = userEvent.setup();
    function GoSub() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/settings/sub')}>
          go sub
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsLayout>
          <GoSub />
        </SettingsLayout>
        <Probe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'go sub' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/settings/sub');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
  });

  it('seeds the active section from the hash and gives both lists role="list"', () => {
    renderLayout('/settings#general');
    for (const nav of navs()) {
      expect(item(nav, 'General')).toHaveAttribute('aria-current', 'location');
      expect(within(nav).getByRole('list')).toBeInTheDocument();
    }
  });
});

describe('a sections prop (a built app hides some kit sections)', () => {
  const THREE = [
    { id: 'appearance', label: 'Appearance', icon: () => null },
    { id: 'ai', label: 'AI', icon: () => null },
    { id: 'network', label: 'Network', icon: () => null },
  ];

  const renderThree = (url = '/settings') =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <SettingsLayout sections={THREE}>
          {THREE.map((s) => (
            <section key={s.id} id={s.id}>
              {s.label} body
            </section>
          ))}
        </SettingsLayout>
      </MemoryRouter>,
    );

  it('lists only those links in both navs and the spy observes only those sections', () => {
    renderThree();
    for (const nav of navs()) {
      expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Appearance', 'AI', 'Network']);
    }
    expect(observers).toHaveLength(1);
    expect(observers[0].targets.map((el) => el.id)).toEqual(['appearance', 'ai', 'network']);
  });

  it('follows the spy, and a deep link to a hidden section jumps nowhere', () => {
    renderThree();
    fire(observers[0], [['network', true]]);
    expect(item(navs()[1], 'Network')).toHaveAttribute('aria-current', 'location');
    cleanup();
    scrollIntoView.mockClear();
    renderThree('/settings#general');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
