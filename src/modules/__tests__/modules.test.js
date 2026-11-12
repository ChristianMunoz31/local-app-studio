// The frontend module registry: studio mode (the default under Vitest) and runtime mode (APP_MODE=runtime at import).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODULES, MODULE_NAV_GROUPS, MODULE_ROUTES, MODULE_SETTINGS_SECTIONS, MODULE_SHELL, REPLACED_KIT_PATHS, assertModuleRoutes } from '../index.js';
import { KIT_ROUTE_PATHS } from '../kitRoutes.js';
import { NAV_GROUPS } from '../../components/shell/navItems.js';
import { ASSISTANT_PAGES, ASSISTANT_PAGE_KEYS, resolveAssistantPageKey } from '../../constants/assistantPages.js';

// The flag module is the one thing that differs between builds: the registry is read under each answer, not under the one this run has.
const parts = vi.hoisted(() => ({ PRO_PARTS: { helper: true, installer: true, licensing: true, cloud: true } }));
vi.mock('../../proParts.js', () => parts);

describe('studio mode (the default)', () => {
  it('activates the Studio module only', () => {
    expect(MODULES.map((m) => m.id)).toEqual(['studio']);
    expect(MODULES[0].modes).toEqual(['studio']);
  });

  it('routes /apps, the app workspace, Features and the two builder addresses lazily, replaces no kit path and adds the build toolchain and Diagnostics settings sections', () => {
    expect(MODULE_ROUTES.map((r) => r.path)).toEqual(['/apps', '/apps/:appId/*', '/features', '/features/new', '/features/:featureId/edit']);
    for (const route of MODULE_ROUTES) expect(route.Component.$$typeof).toBe(Symbol.for('react.lazy'));
    expect([...REPLACED_KIT_PATHS]).toEqual([]);
    // The build tools section is for making an installer: a build without the installer (a public run) has Diagnostics only.
    expect(MODULE_SETTINGS_SECTIONS.map((s) => s.id)).toEqual(['build-toolchain', 'diagnostics']);
    expect(MODULE_SETTINGS_SECTIONS[0].Component.$$typeof).toBe(Symbol.for('react.lazy'));
  });

  it('has no shell of its own: the kit AppShell and Onboarding stay', () => {
    expect(MODULE_SHELL).toBeNull();
    expect(MODULES.some((m) => m.shell)).toBe(false);
  });

  it('adds one direct-link group (Apps and Features) between Home and Settings', () => {
    expect(MODULE_NAV_GROUPS).toHaveLength(1);
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(['home', 'studio', 'settings']);
    const studio = NAV_GROUPS.find((g) => g.id === 'studio');
    expect(studio.section).toBeNull();
    expect(studio.items.map((i) => [i.to, i.label])).toEqual([
      ['/apps', 'Apps'],
      ['/features', 'Features'],
    ]);
    for (const item of studio.items) expect(item.icon).toBeTypeOf('object');
  });

  it('leaves the Assistant pages and the unknown-route fallback as the kit has them', () => {
    expect(ASSISTANT_PAGE_KEYS).toEqual(['home', 'settings']);
    expect(Object.keys(ASSISTANT_PAGES)).toEqual(['home', 'settings']);
    expect(resolveAssistantPageKey('/apps')).toBeNull();
  });
});

describe('the build tools section follows the installer flag', () => {
  afterEach(() => {
    parts.PRO_PARTS.installer = true;
    vi.resetModules();
  });

  const sectionIds = async (installer) => {
    parts.PRO_PARTS.installer = installer;
    vi.resetModules();
    const { MODULE_SETTINGS_SECTIONS: sections } = await import('../index.js');
    return sections.map((s) => s.id);
  };

  it('has the build tools and Diagnostics with the installer in the build', async () => {
    expect(await sectionIds(true)).toEqual(['build-toolchain', 'diagnostics']);
  });

  it('has Diagnostics only without the installer', async () => {
    expect(await sectionIds(false)).toEqual(['diagnostics']);
  });
});

describe('runtime mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@local-app-studio/runtime/runtime/bakedSpec.js');
  });

  const loadRuntime = async () => {
    vi.stubEnv('APP_MODE', 'runtime');
    vi.resetModules();
    vi.doMock('@local-app-studio/runtime/runtime/bakedSpec.js', () => ({ default: null }));
    return {
      modules: await import('../index.js'),
      nav: await import('../../components/shell/navItems.js'),
      pages: await import('../../constants/assistantPages.js'),
    };
  };

  it('activates the runtime module: lazy spec and Data routes, the Data menu item, kit home replaced', async () => {
    const { modules, nav } = await loadRuntime();
    expect(modules.MODULES.map((m) => m.id)).toEqual(['runtime']);
    expect(modules.MODULE_ROUTES.map((r) => r.path)).toEqual(['/', '/data', '/data/:table']);
    for (const route of modules.MODULE_ROUTES) expect(route.Component.$$typeof).toBe(Symbol.for('react.lazy'));
    expect([...modules.REPLACED_KIT_PATHS]).toEqual(['/']);
    expect(modules.MODULE_SETTINGS_SECTIONS.map((s) => s.id)).toEqual(['runtime-data']);
    expect(nav.NAV_GROUPS.map((g) => g.id)).toEqual(['app-data', 'settings']);
  });

  it('owns the shell: a Frame, and the five kit Settings sections a built app shows', async () => {
    const { modules } = await loadRuntime();
    expect(modules.MODULE_SHELL.Frame).toBeTypeOf('function');
    expect(modules.MODULE_SHELL.kitSettings).toEqual(['appearance', 'ai', 'data-storage', 'privacy', 'network']);
    expect(modules.MODULE_SHELL.settingsIntro).toMatch(/Everything stays on this computer/);
  });

  it('adds the runtime Assistant pages, drops the kit Home advice, and falls back to the app page for unknown routes and for the home route', async () => {
    const { pages } = await loadRuntime();
    expect(pages.ASSISTANT_PAGE_KEYS).toEqual(['settings', 'app', 'data']);
    expect(pages.resolveAssistantPageKey('/data')).toBe('data');
    expect(pages.resolveAssistantPageKey('/crews')).toBe('app');
    expect(pages.resolveAssistantPageKey('/')).toBe('app');
  });
});

describe('assertModuleRoutes', () => {
  const mod = (routes, replacesKitPaths = []) => ({ routes: routes.map((path) => ({ path })), replacesKitPaths });

  it('lists the kit routes once', () => {
    expect([...KIT_ROUTE_PATHS]).toEqual(['/', '/settings']);
  });

  it('accepts module routes that do not touch a kit path', () => {
    expect(() => assertModuleRoutes([mod(['/designer', '/preview'])])).not.toThrow();
  });

  it('throws when a module route collides with a kit path that is not replaced', () => {
    expect(() => assertModuleRoutes([mod(['/settings'])])).toThrow(/"\/settings" collides with a kit route/);
    expect(() => assertModuleRoutes([mod(['/'])])).toThrow(/collides/);
  });

  it('treats case and trailing slashes as the same path', () => {
    expect(() => assertModuleRoutes([mod(['/Settings'])])).toThrow(/collides/);
    expect(() => assertModuleRoutes([mod(['/settings/'])])).toThrow(/collides/);
    expect(() => assertModuleRoutes([mod(['/Settings/'], ['/settings'])])).not.toThrow();
    expect(() => assertModuleRoutes([mod(['//'], ['/'])])).not.toThrow();
  });

  it('accepts a collision that is listed in replacesKitPaths', () => {
    expect(() => assertModuleRoutes([mod(['/', '/settings'], ['/', '/settings'])])).not.toThrow();
  });

  it('throws when "/" is replaced but no module provides "/"', () => {
    expect(() => assertModuleRoutes([mod(['/app'], ['/'])])).toThrow(/no module provides a "\/" route/);
  });

  it('accepts a replaced kit path with no route when it is not "/"', () => {
    expect(() => assertModuleRoutes([mod(['/designer'], ['/settings'])])).not.toThrow();
  });
});
