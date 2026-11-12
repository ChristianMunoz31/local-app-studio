// The runtime module for the crew roster fixture, built directly and loaded the way a runtime build loads it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import crewRoster from '../../spec/fixtures/crew-roster.json';

// The id only exists in a Vite build (studioUiPlugin); Vitest needs a mock to resolve it.
vi.mock('../bakedSpec.js', () => ({ default: crewRoster }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const lazyTypes = (routes) => routes.map((r) => r.Component.$$typeof);

describe('buildRuntimeModule', () => {
  it('routes the spec pages and the data browser, all lazy', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    const mod = buildRuntimeModule(crewRoster);
    expect(mod.id).toBe('runtime');
    expect(mod.modes).toEqual(['runtime']);
    expect(mod.routes.map((r) => r.path)).toEqual(['/', '/data', '/data/:table']);
    expect(new Set(lazyTypes(mod.routes))).toEqual(new Set([Symbol.for('react.lazy')]));
    expect(mod.settingsSections.map((s) => s.id)).toEqual(['runtime-data']);
    expect(mod.settingsSections[0].Component.$$typeof).toBe(Symbol.for('react.lazy'));
  });

  it('owns the shell: a Frame and the five kit Settings sections, with or without a spec', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    for (const spec of [crewRoster, null]) {
      const { shell } = buildRuntimeModule(spec);
      expect(shell.Frame).toBeTypeOf('function');
      expect(shell.kitSettings).toEqual(['appearance', 'ai', 'data-storage', 'privacy', 'network']);
      expect(shell.settingsIntro).not.toBe('');
      expect(shell.settingsResetNote).not.toBe('');
    }
  });

  it('builds the menu from the spec nav, then Data, and replaces the kit home and Items', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    const mod = buildRuntimeModule(crewRoster);
    expect(mod.replacesKitPaths).toEqual(['/']);
    expect(mod.navGroups.map((g) => g.id)).toEqual(['app', 'app-data']);
    expect(mod.navGroups[0].section).toBeNull();
    expect(mod.navGroups[0].items.map((i) => [i.to, i.label, i.end])).toEqual([['/', 'Home', true]]);
    expect(mod.navGroups[1].items.map((i) => [i.to, i.label])).toEqual([['/data', 'Data']]);
    expect(mod.navGroups[0].items[0].icon).toBeTypeOf('object');
  });

  it('skips reserved and duplicate routes and menu entries for record pages', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    const page = (id, route) => ({ id, title: id, route, sources: [], layout: { id: `${id}_l`, type: 'Page', props: {}, children: [] } });
    const spec = {
      ...crewRoster,
      pages: [page('home', '/'), page('set', '/settings'), page('dat', '/data'), page('rec', '/crews/:id'), page('dup', '/')],
      nav: [
        { pageId: 'home', label: 'Home' },
        { pageId: 'set', label: 'Settings page' },
        { pageId: 'rec', label: 'Record' },
      ],
    };
    const mod = buildRuntimeModule(spec);
    expect(mod.routes.map((r) => r.path)).toEqual(['/', '/crews/:id', '/data', '/data/:table']);
    expect(mod.navGroups[0].items.map((i) => i.label)).toEqual(['Home']);
  });

  it('carries the applied theme as appTheme, and none without one', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    const themed = buildRuntimeModule(crewRoster, { label: 'Forest', mode: 'dark', themed: true, background: null });
    expect(themed.appTheme).toEqual({ name: 'Forest', mode: 'dark' });
    expect(themed.appBackground).toBeUndefined();
    expect(buildRuntimeModule(crewRoster).appTheme).toBeUndefined();
  });

  it('a Classic spec sets no appTheme (it behaves as before themes) and carries its baked background as the default', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    const classic = buildRuntimeModule(crewRoster, { label: 'Classic', mode: 'light', themed: false, background: 'ocean' });
    expect(classic.appTheme).toBeUndefined();
    expect(classic.appBackground).toBe('ocean');
  });

  it('still renders when the theme code cannot start', async () => {
    vi.stubEnv('APP_MODE', 'runtime');
    vi.doMock('../../theme/applyRoot.ts', () => {
      throw new Error('chunk failed to load');
    });
    const mod = (await import('../../../../../src/modules/runtime.jsx')).default;
    expect(mod.id).toBe('runtime');
    expect(mod.appTheme).toBeUndefined();
    expect(mod.appBackground).toBeUndefined();
    expect(mod.routes.map((r) => r.path)).toContain('/');
    vi.doUnmock('../../theme/applyRoot.ts');
  });

  it('still provides "/" for an app without a spec', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    const mod = buildRuntimeModule(null);
    expect(mod.routes.map((r) => r.path)).toEqual(['/', '/data', '/data/:table']);
    expect(mod.navGroups[0].items).toEqual([]);
  });

  it('passes the module through assertModuleRoutes', async () => {
    const { buildRuntimeModule } = await import('../../../../../src/modules/runtime.jsx');
    const { assertModuleRoutes } = await import('../../../../../src/modules/index.js');
    expect(() => assertModuleRoutes([buildRuntimeModule(crewRoster)])).not.toThrow();
  });
});

describe('runtime.jsx in a runtime build', () => {
  it('reads the baked spec from virtual:app-spec', async () => {
    vi.stubEnv('APP_MODE', 'runtime');
    vi.resetModules();
    const mod = await import('../../../../../src/modules/runtime.jsx');
    expect(mod.RUNTIME_SPEC.app.name).toBe('Crew Roster');
    expect(mod.default.navGroups[0].items.map((i) => i.label)).toEqual(['Home']);
  });
});
