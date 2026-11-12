// The frontend module registry (docs/OWNERSHIP.md). App.jsx, the menu and Settings read module descriptors instead of
// being edited per module. Only modules whose `modes` include the app mode are active; in a runtime build the Studio
// module is a stub (scripts/desktop/modeBuild.js).
import { APP_MODE } from '../appMode.js';
import { KIT_ROUTE_PATHS } from './kitRoutes.js';
import runtimeModule from './runtime.jsx';
import studioModule from './studio.jsx';

/** @typedef {{
 *   id: 'runtime' | 'studio',
 *   modes: Array<'studio' | 'runtime'>,
 *   routes: Array<{ path: string, Component: import('react').LazyExoticComponent<import('react').ComponentType> }>,
 *   navGroups: Array<{ section: string | null, id: string, items: Array<{ to: string, label: string, icon: import('react').ComponentType, end?: boolean, exclude?: string[] }> }>,
 *   replacesKitPaths: string[],
 *   settingsSections: Array<{ id: string, label?: string, icon?: import('react').ComponentType<{ size?: number }>, Component: import('react').LazyExoticComponent<import('react').ComponentType> }>,
 *   appTheme?: { name: string, mode: 'light' | 'dark' },
 *   appBackground?: string,
 *   shell?: {
 *     Frame: import('react').ComponentType<{ children: import('react').ReactNode }>,
 *     kitSettings: ReadonlyArray<'appearance' | 'general' | 'ai' | 'data-storage' | 'privacy' | 'network' | 'api-keys' | 'license'>,
 *     settingsIntro: string,
 *     hiddenNetworkFeatures?: ReadonlyArray<string>,
 *     settingsResetNote: string,
 *   },
 * }} FrontendModule */

/**
 * Throws when the active modules cannot be routed unambiguously: a module route on a kit path the modules do not list in
 * `replacesKitPaths` (the kit route would silently shadow or be shadowed), or `/` replaced with no module providing `/`
 * (the app would have no home page).
 * @param {ReadonlyArray<FrontendModule>} modules
 * @param {ReadonlyArray<string>} [kitPaths]
 */
export function assertModuleRoutes(modules, kitPaths = KIT_ROUTE_PATHS) {
  // The router matches case-insensitively and ignores trailing slashes, so compare the same way.
  const norm = (p) => p.toLowerCase().replace(/\/+$/, '') || '/';
  const replaced = new Set(modules.flatMap((m) => m.replacesKitPaths).map(norm));
  const provided = new Set(modules.flatMap((m) => m.routes.map((r) => norm(r.path))));
  const kit = kitPaths.map(norm);
  for (const path of provided) {
    if (kit.includes(path) && !replaced.has(path)) {
      throw new Error(`Module route "${path}" collides with a kit route. List it in replacesKitPaths to replace the kit page.`);
    }
  }
  if (replaced.has('/') && !provided.has('/')) {
    throw new Error('A module replaces the kit home page "/" but no module provides a "/" route.');
  }
}

/** @type {ReadonlyArray<FrontendModule>} */
export const MODULES = [runtimeModule, studioModule].filter((m) => m.modes.includes(APP_MODE));
assertModuleRoutes(MODULES);
export const MODULE_ROUTES = MODULES.flatMap((m) => m.routes);
export const MODULE_NAV_GROUPS = MODULES.flatMap((m) => m.navGroups);
/** Kit routes and menu items the active modules take over (App.jsx and navItems.js drop them). */
export const REPLACED_KIT_PATHS = new Set(MODULES.flatMap((m) => m.replacesKitPaths));
export const MODULE_SETTINGS_SECTIONS = MODULES.flatMap((m) => m.settingsSections);
/** The built app's theme (name and the mode a fresh install starts in), or null: Studio and a runtime build without a spec have none. */
export const MODULE_APP_THEME = MODULES.find((m) => m.appTheme)?.appTheme ?? null;
/** A Classic app's baked background preset: the default of the background setting until the user picks one, else null. */
export const MODULE_APP_BACKGROUND = MODULES.find((m) => m.appBackground)?.appBackground ?? null;
// A module with a `shell` owns the frame and the first start (a built app); at most one may. `Frame` replaces the kit
// AppShell, `kitSettings` lists the kit Settings sections shown, in order. Studio has none: it keeps the kit AppShell and Onboarding.
if (MODULES.filter((m) => m.shell).length > 1) throw new Error('At most one active module may provide a shell.');
/** The active module's shell, or null: Studio (and any build without one) uses the kit AppShell and Onboarding. */
export const MODULE_SHELL = MODULES.find((m) => m.shell)?.shell ?? null;
