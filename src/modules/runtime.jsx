// The runtime module (what a built app shows): the spec pages as lazy routes, the Data browser, the menu from the spec
// nav. Nothing under src/(vendor|catalog|studio|runtime|spec)/ may be imported statically here (the entry chunk would
// pull in the catalog and zod; server/__tests__/modules/chunking.test.js). The baked spec comes from the virtual module
// `virtual:app-spec` through src/runtime/bakedSpec.js, imported dynamically and only in a runtime build.
import { createElement, lazy } from 'react';
import {
  BarChart3,
  Box,
  Briefcase,
  Calendar,
  Clipboard,
  Database,
  File,
  Folder,
  Heart,
  House,
  Inbox,
  List,
  Map,
  Settings,
  Star,
  Table,
  Tag,
  Truck,
  User,
  Users,
  Wrench,
} from 'lucide-react';
import { APP_MODE } from '../appMode.js';
import RuntimeEntry from '../components/shell/RuntimeEntry.jsx';
import RuntimeShell from '../components/shell/RuntimeShell.jsx';

/* global __APP_MODE__ */
// False only in a studio build, where Vite defines __APP_MODE__ as 'studio': the minifier then drops the runtime module
// body, its lazy routes and its icons, so a studio build emits no runtime chunks. Vitest defines nothing (true).
const INCLUDE_RUNTIME = typeof __APP_MODE__ === 'string' ? __APP_MODE__ === 'runtime' : true;

export const RUNTIME_SPEC =
  INCLUDE_RUNTIME && APP_MODE === 'runtime' ? ((await import('@local-app-studio/runtime/runtime/bakedSpec.js')).default ?? null) : null;

// The theme: applied to <html> before React mounts (a lazy chunk, only src/theme files; no Studio code). The theme block is
// sanitized inside startRuntimeTheme, the runtime boundary. Docs: docs/THEMES.md.
// If the theme chunk cannot load or start, the app still renders in the kit look.
let startedTheme = null;
if (INCLUDE_RUNTIME && RUNTIME_SPEC) {
  try {
    startedTheme = (await import('@local-app-studio/runtime/theme/applyRoot.ts')).startRuntimeTheme(RUNTIME_SPEC.theme);
  } catch {
    startedTheme = null;
  }
}
// The class strings of the entry buttons and the back link live with the menu's (menuClasses.ts). They are loaded here, in a runtime
// build only, and handed to the shell and the entry as props: a static import in src/components/shell would keep that file in the
// Studio entry chunk (chunking.test.js).
const MENU_CLASSES = INCLUDE_RUNTIME ? await import('@local-app-studio/runtime/catalog/parts/menuClasses.ts') : null;

const RUNTIME_THEME = startedTheme;

// The 20 glyphs a spec may name for a nav item (a copy of the catalog's icon list: importing it would break the
// chunking rule). An unknown name falls back to the list glyph.
const NAV_ICONS = {
  home: House,
  list: List,
  table: Table,
  users: Users,
  user: User,
  box: Box,
  calendar: Calendar,
  chart: BarChart3,
  clipboard: Clipboard,
  file: File,
  folder: Folder,
  tag: Tag,
  star: Star,
  briefcase: Briefcase,
  truck: Truck,
  wrench: Wrench,
  settings: Settings,
  inbox: Inbox,
  map: Map,
  heart: Heart,
};

const normPath = (path) => path.toLowerCase().replace(/\/+$/, '') || '/';
const hasParam = (route) => route.split('/').some((s) => s.startsWith(':'));

/** A lazy component that renders `loader()`'s default export with `props`. */
const lazyWithProps = (loader, props) =>
  lazy(async () => {
    const { default: Page } = await loader();
    return { default: () => createElement(Page, props) };
  });

/**
 * The runtime module for a spec (null: an app without a spec).
 * @param {import('@local-app-studio/runtime/spec/schema.ts').AppSpec | null} spec
 * @param {{ label: string, mode: 'light' | 'dark', themed: boolean, background: string | null } | null} [theme] The started theme. A themed
 *   spec (it has an id) sets `appTheme`: its name and the mode a fresh install starts in. A Classic spec behaves as before themes
 *   existed, except that its baked background is the default one (`appBackground`).
 * @returns {import('./index.js').FrontendModule}
 */
export function buildRuntimeModule(spec, theme = null) {
  // The entry (Assistant and Settings) rides into the designed menu bar as `menuTrail`; the Data pages and About this app read the spec.
  const RuntimeApp = lazyWithProps(() => import('@local-app-studio/runtime/runtime/RuntimeApp.jsx'), { spec, menuTrail: createElement(RuntimeEntry, { buttonClass: MENU_CLASSES?.ENTRY_BUTTON }) });
  const DataBrowserPage = lazyWithProps(() => import('@local-app-studio/runtime/runtime/data/DataBrowserPage.jsx'), { spec });
  const DataTablePage = lazyWithProps(() => import('@local-app-studio/runtime/runtime/data/DataTablePage.jsx'), { spec });
  const AppDataSection = lazyWithProps(() => import('@local-app-studio/runtime/runtime/settings/AppDataSection.jsx'), { spec });
  // One Frame per module (a new component type per render would remount the whole app).
  const appName = spec?.app?.name ?? null;
  const Frame = ({ children }) => createElement(RuntimeShell, { appName, backClass: MENU_CLASSES?.BACK_LINK }, children);

  // Page routes first. /settings stays the kit's (a module route there would collide), /data the browser's.
  const reserved = new Set(['/settings', '/data', '/data/:table']);
  const seen = new Set();
  const pageRoutes = [];
  for (const page of spec?.pages ?? []) {
    const key = normPath(page.route);
    if (reserved.has(key) || seen.has(key)) continue;
    seen.add(key);
    pageRoutes.push({ path: page.route, Component: RuntimeApp });
  }
  // The module replaces the kit home page, so it must provide "/" (a spec without a home page shows a not-found card).
  if (!seen.has('/')) pageRoutes.push({ path: '/', Component: RuntimeApp });

  const navItems = (spec?.nav ?? []).flatMap((n) => {
    const to = spec.pages.find((p) => p.id === n.pageId)?.route;
    if (!to || hasParam(to) || !seen.has(normPath(to))) return [];
    return [{ to, label: n.label, icon: NAV_ICONS[n.icon ?? 'list'] ?? List, end: to === '/' }];
  });

  return {
    id: 'runtime',
    modes: ['runtime'],
    routes: [
      ...pageRoutes,
      { path: '/data', Component: DataBrowserPage },
      { path: '/data/:table', Component: DataTablePage },
    ],
    navGroups: [
      { section: null, id: 'app', items: navItems },
      { section: null, id: 'app-data', items: [{ to: '/data', label: 'Data', icon: Database }] },
    ],
    replacesKitPaths: ['/'],
    settingsSections: [{ id: 'runtime-data', label: 'About this app', icon: Database, Component: AppDataSection }],
    shell: {
      Frame,
      kitSettings: ['appearance', 'ai', 'data-storage', 'privacy', 'network'],
      // A built app has no license and no update check: their rows and words stay out of Network, activity and storage.
      hiddenNetworkFeatures: ['license', 'updates'],
      settingsIntro: 'Light and Dark, your data, backups, privacy and the Assistant. Everything stays on this computer.',
      settingsResetNote: 'Does not change your AI model choice.',
    },
    ...(theme?.themed ? { appTheme: { name: theme.label, mode: theme.mode } } : {}),
    ...(theme && !theme.themed && theme.background ? { appBackground: theme.background } : {}),
  };
}

/** @type {import('./index.js').FrontendModule} */
const EMPTY_RUNTIME_MODULE = { id: 'runtime', modes: ['runtime'], routes: [], navGroups: [], replacesKitPaths: [], settingsSections: [] };

export default INCLUDE_RUNTIME ? buildRuntimeModule(RUNTIME_SPEC, RUNTIME_THEME) : EMPTY_RUNTIME_MODULE;
