import { LayoutDashboard, Settings } from 'lucide-react';
import { MODULE_NAV_GROUPS, REPLACED_KIT_PATHS } from '../../modules';

// Single source of truth for the app's navigation. Consumed by BurgerMenu, which renders the groups
// in this order: a group with a `section` is a drill-down category (stable `id`, category `icon`,
// items in alphabetical order by label); a `section` of null renders its items as direct links with
// no drill-down. An optional `exclude` list of paths keeps an item inactive when one of them matches
// (for example a parent route versus its sibling).
//
// Order: the kit's home group, then the active modules' groups (src/modules/), then the kit's settings group.
// A module can take over a kit item by listing its path in `replacesKitPaths`; the item is dropped here.
//
// Adding a kit page: add a route in App.jsx, an item here, and a page key in
// src/constants/assistantPages.js (plus server/assistant/pages.js) if the assistant should advise on it.
// Adding a module page: declare it in that module's file under src/modules/ instead.
const withoutReplaced = (group) => ({ ...group, items: group.items.filter((item) => !REPLACED_KIT_PATHS.has(item.to)) });

const KIT_GROUPS = {
  home: { section: null, id: 'home', items: [{ to: '/', label: 'Home', icon: LayoutDashboard, end: true }] },
  settings: { section: null, id: 'settings', items: [{ to: '/settings', label: 'Settings', icon: Settings }] },
};

export const NAV_GROUPS = [
  withoutReplaced(KIT_GROUPS.home),
  ...MODULE_NAV_GROUPS,
  withoutReplaced(KIT_GROUPS.settings),
].filter((group) => group.items.length > 0);
