// The app menu bar (DESIGN-phase8.md 4.3): the items of `spec.nav` as links across the top or down the side of every page.
// SpecApp wraps the page in AppMenuFrame only when the spec has a `menu` block, so a Classic app is untouched and Studio
// Preview matches a built app. Values are re-checked here: the spec may be stored data that was never validated.
// With menu slots (`menu.start`, `menu.end`) the bar also holds two boxes the slot parts are portalled into (menuSlots.jsx);
// without them the markup is exactly what it was before slots existed. The side rail can be collapsed to icons (menuCollapsed.js):
// a view choice kept per app in this browser, md and up only; collapsed, the slot boxes hide behind a "More" button.
import { createElement, Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ellipsis, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  CORNER_PAD,
  CORNER_PILL,
  LABEL_COLLAPSED,
  LETTER_BADGE,
  LINK_COLLAPSED,
  MENU_CURRENT,
  MENU_LINK,
  MENU_OTHER,
  SIDE_FRAME,
  SIDE_LIST,
  SIDE_NAV,
  SIDE_NAV_COLLAPSED,
  SIDE_RAIL,
  SIDE_RAIL_COLLAPSED,
  SIDE_SLOT,
  SIDE_TOGGLE,
  SLOT_CLASS,
  SLOT_COLLAPSED,
  TOP_BAR,
  TOP_BAR_TRAIL,
  TOP_LIST,
  TOP_LIST_WRAP,
  TOP_NAV,
  TOP_NAV_IN_BAR,
  TOP_NAV_TRAIL,
  TRAIL,
  TRAIL_END,
  TRAIL_FOLDED,
} from '../catalog/parts/menuClasses.ts';
import { menuEntries, menuLook, navIcon } from '../catalog/parts/navItems.ts';
import { hasSlotLayers, slotLayers } from '../spec/menuSlots.ts';
import { useMenuCollapsed } from './menuCollapsed.js';
import { MenuSlotContext } from './menuSlots.jsx';
import { joinPath, routeFor } from './routing.js';

/** One shared empty list: an empty slot must not hand out a new array each render, or the context value changes every render. */
const NO_LAYERS = Object.freeze([]);

/** The layers of one slot; the same frozen array while the slot is empty. */
const layersOf = (menu, slot) => {
  const layers = slotLayers(menu, slot);
  return layers.length === 0 ? NO_LAYERS : layers;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The page with a built app's entry in the bottom right corner, for an app that has no menu bar. `trail` null returns the
 * page untouched.
 * @param {import('react').ReactNode} children
 * @param {import('react').ReactNode} [trail]
 */
// A plain helper shared with SpecApp (index.js), not a component.
// eslint-disable-next-line react-refresh/only-export-components
export function cornerTrail(children, trail = null) {
  if (trail === null) return children;
  return createElement(
    Fragment,
    null,
    createElement('div', { className: CORNER_PAD }, children),
    createElement('div', { 'data-runtime-corner': '', role: 'group', 'aria-label': 'App', className: CORNER_PILL }, trail),
  );
}

/**
 * The page wrapped in the menu bar. `trail` (a built app's Assistant and Settings buttons) goes at the end of the bar; with no
 * trail the markup is exactly what it was before trails existed (Preview passes none).
 * @param {{ spec: import('../spec/schema.ts').AppSpec | null, pageId: string | null, basePath?: string, trail?: import('react').ReactNode, children?: import('react').ReactNode }} props
 */
export function AppMenuFrame({ spec, pageId, basePath = '/', trail = null, children }) {
  const { side, labelsOnly } = menuLook(spec?.menu);
  const [startEl, setStartEl] = useState(null);
  const [endEl, setEndEl] = useState(null);
  const startLayers = layersOf(spec?.menu, 'start');
  const endLayers = layersOf(spec?.menu, 'end');
  const slots = useMemo(
    () => ({ start: { el: startEl, layers: startLayers }, end: { el: endEl, layers: endLayers } }),
    // The slot arrays come from the spec object, so their identity changes only when the spec does.
    [startEl, endEl, startLayers, endLayers],
  );
  const withSlots = hasSlotLayers(spec?.menu);
  const [collapsed, setCollapsed] = useMenuCollapsed(spec?.app?.slug);
  const railId = useId();
  const folded = side && collapsed;
  // "More" expands the rail and goes away, so focus would fall to the page: after it, focus moves to the first control in the start
  // slot (or the side menu button when there is none).
  const [toggleEl, setToggleEl] = useState(null);
  const [moreCount, setMoreCount] = useState(0);
  const moreHandled = useRef(0);
  useEffect(() => {
    if (folded || moreCount === moreHandled.current) return;
    moreHandled.current = moreCount;
    const target = startEl?.querySelector(FOCUSABLE) ?? toggleEl;
    target?.focus();
  }, [folded, moreCount, startEl, toggleEl]);
  const entries = menuEntries(spec).flatMap((entry) => {
    const route = routeFor(spec, entry.pageId);
    return route === null ? [] : [{ ...entry, to: joinPath(basePath, route) }];
  });
  if (entries.length === 0 && !withSlots) return cornerTrail(children, trail);
  const items = entries.map((entry) => {
    const Icon = labelsOnly ? undefined : navIcon(entry.icon);
    const current = entry.pageId === pageId;
    const look = `${MENU_LINK} ${current ? MENU_CURRENT : MENU_OTHER}`;
    return createElement(
      'li',
      { key: entry.pageId },
      createElement(
        Link,
        folded
          ? { to: entry.to, 'aria-current': current ? 'page' : undefined, className: `${look} ${LINK_COLLAPSED}`, title: entry.label, 'aria-label': entry.label }
          : { to: entry.to, 'aria-current': current ? 'page' : undefined, className: look },
        Icon ? createElement(Icon, { size: 16, 'aria-hidden': 'true' }) : null,
        folded && !Icon ? createElement('span', { className: LETTER_BADGE, 'aria-hidden': 'true' }, String(entry.label).trim().charAt(0).toUpperCase()) : null,
        folded ? createElement('span', { className: LABEL_COLLAPSED }, entry.label) : entry.label,
      ),
    );
  });
  // One fixed name, so a screen reader hears the same button change state; aria-expanded carries the state, the title the tooltip.
  const tip = folded ? 'Expand menu' : 'Collapse menu';
  const toggle = createElement(
    'button',
    { key: 'toggle', ref: setToggleEl, type: 'button', className: SIDE_TOGGLE, 'aria-expanded': !folded, 'aria-controls': railId, 'aria-label': 'Side menu', title: tip, onClick: () => setCollapsed(!folded) },
    createElement(folded ? PanelLeftOpen : PanelLeftClose, { size: 16, 'aria-hidden': 'true' }),
  );
  if (withSlots) {
    const box = (slot, layers, ref, className) => (layers.length > 0 ? createElement('div', { key: slot, 'data-menu-slot': slot, ref, className }) : null);
    // Collapsed, the slot boxes stay mounted (a menu search keeps its text) but hide from md up behind "More", which expands.
    const slotClass = folded ? `${SIDE_SLOT} ${SLOT_COLLAPSED}` : SIDE_SLOT;
    const more = folded
      ? createElement(
          'button',
          {
            key: 'more',
            type: 'button',
            className: SIDE_TOGGLE,
            'aria-label': 'More menu parts',
            onClick: () => {
              setMoreCount((n) => n + 1);
              setCollapsed(false);
            },
          },
          createElement(Ellipsis, { size: 16, 'aria-hidden': 'true' }),
          'More',
        )
      : null;
    const links = (navClass, listClass) =>
      items.length > 0
        ? createElement('nav', { key: 'nav', 'aria-label': 'App menu', className: navClass }, createElement('ul', { className: listClass }, items))
        : null;
    const bar = side
      ? createElement(
          'div',
          { id: railId, className: folded ? SIDE_RAIL_COLLAPSED : SIDE_RAIL },
          toggle,
          more,
          box('start', startLayers, setStartEl, slotClass),
          links('', SIDE_LIST),
          box('end', endLayers, setEndEl, slotClass),
          trail === null ? null : createElement('div', { key: 'trail', className: folded ? TRAIL_FOLDED : TRAIL }, trail),
        )
      : createElement(
          'div',
          { className: TOP_BAR },
          box('start', startLayers, setStartEl, SLOT_CLASS.start),
          links(TOP_NAV_IN_BAR, TOP_LIST_WRAP),
          box('end', endLayers, setEndEl, SLOT_CLASS.end),
          trail === null
            ? null
            : createElement('div', { key: 'trail', className: endLayers.length > 0 ? TRAIL : TRAIL_END }, trail),
        );
    const page = createElement(MenuSlotContext.Provider, { value: slots }, children);
    return side
      ? createElement('div', { className: SIDE_FRAME }, bar, createElement('div', { className: 'min-w-0 flex-1' }, page))
      : createElement('div', null, bar, page);
  }
  if (side) {
    return createElement(
      'div',
      { className: SIDE_FRAME },
      createElement(
        'nav',
        { id: railId, 'aria-label': 'App menu', className: folded ? SIDE_NAV_COLLAPSED : SIDE_NAV },
        toggle,
        createElement('ul', { className: SIDE_LIST }, trail === null ? items : [...items, createElement('li', { key: 'trail', className: folded ? TRAIL_FOLDED : TRAIL }, trail)]),
      ),
      createElement('div', { className: 'min-w-0 flex-1' }, children),
    );
  }
  // The trail sits outside the wrapping list, as in the slots bar, so a long menu never pushes it out of sight.
  if (trail !== null) {
    return createElement(
      'div',
      null,
      createElement(
        'div',
        { className: TOP_BAR_TRAIL },
        createElement('nav', { 'aria-label': 'App menu', className: TOP_NAV_TRAIL }, createElement('ul', { className: TOP_LIST_WRAP }, items)),
        createElement('div', { className: TRAIL }, trail),
      ),
      children,
    );
  }
  return createElement('div', null, createElement('nav', { 'aria-label': 'App menu', className: TOP_NAV }, createElement('ul', { className: TOP_LIST }, items)), children);
}
