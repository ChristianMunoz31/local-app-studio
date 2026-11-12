import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import { NAV_GROUPS } from './navItems';
import { useProfile } from '../../hooks/useProfile';

const APP_TITLE = 'Local App Studio';
const CLOSE_MS = 220;
const FOCUSABLE = 'a[href], button:not([disabled])';

// Menu lifecycle: 'closed' (unmounted) -> 'open' -> 'closing' (exit animation) -> 'closed'.
function phaseReducer(phase, action) {
  if (action === 'OPEN') return 'open';
  if (action === 'CLOSE') return phase === 'open' ? 'closing' : phase;
  if (action === 'HIDE') return 'closed';
  return phase;
}

const linkClass = ({ isActive }) =>
  [
    'relative flex items-center gap-3 rounded-md text-sm font-medium transition-colors px-3 py-2.5',
    isActive
      ? 'bg-slate-slate700/60 text-slate-slate100 shadow-sm'
      : 'text-slate-slate400 hover:text-slate-slate100 hover:bg-slate-slate700/50',
  ].join(' ');

// Monochrome current-page indicator pinned to the row's left edge.
function ActiveBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-slate-slate400"
    />
  );
}

// An item is active when its path matches and no `exclude` path does.
function isItemActive(item, pathname) {
  if (!matchPath({ path: item.to, end: item.end ?? false }, pathname)) return false;
  return !(item.exclude ?? []).some((path) => matchPath({ path, end: false }, pathname));
}

// A plain Link (not NavLink): NavLink always derives aria-current from its own match, which
// cannot honor `exclude`.
function MenuLink({ to, label, icon: Icon, end, exclude, onNavigate }) {
  const { pathname } = useLocation();
  const active = isItemActive({ to, end, exclude }, pathname);
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={linkClass({ isActive: active })}
      aria-current={active ? 'page' : undefined}
    >
      {active && <ActiveBar />}
      <Icon size={18} className={active ? 'text-slate-slate100' : ''} aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

// Burger menu with category drill-down. Level 1 lists direct links and one row per
// category in NAV_GROUPS order; level 2 lists that category's links. All grouping
// comes from the `groups` prop (default: NAV_GROUPS in navItems.js).
export default function BurgerMenu({ groups: navGroups = NAV_GROUPS }) {
  const { displayName } = useProfile();
  const { pathname } = useLocation();
  const [phase, dispatch] = useReducer(phaseReducer, 'closed');
  const [level, setLevel] = useState(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const backRef = useRef(null);
  const rowRefs = useRef({});
  const lastCategory = useRef(null);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const headingId = `${baseId}-heading`;

  const isOpen = phase === 'open';
  const rendered = phase !== 'closed';

  // Drop groups with nothing in them.
  const { groups, categories } = useMemo(() => {
    const visible = navGroups.filter((group) => group.items.length > 0);
    return { groups: visible, categories: visible.filter((group) => group.section) };
  }, [navGroups]);
  const current = categories.find((group) => group.id === level) ?? null;

  const isActiveRoute = useCallback(
    (item) => isItemActive(item, pathname),
    [pathname],
  );

  const close = useCallback(() => {
    dispatch('CLOSE');
    buttonRef.current?.focus();
  }, []);

  const toggle = () => {
    if (isOpen) {
      close();
    } else {
      lastCategory.current = null;
      setLevel(null);
      dispatch('OPEN');
    }
  };

  // Unmount after the exit animation finishes.
  useEffect(() => {
    if (phase !== 'closing') return undefined;
    const t = setTimeout(() => dispatch('HIDE'), CLOSE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Safety net: any route change closes the menu.
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      dispatch('CLOSE');
      // Return focus to the burger if it was inside the panel that is about to go away.
      if (panelRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
    }
  }, [pathname]);

  // Focus management: first control on open, back button when drilling in,
  // the originating category row when backing out.
  useEffect(() => {
    if (!isOpen) return;
    if (current) {
      backRef.current?.focus();
    } else if (lastCategory.current && rowRefs.current[lastCategory.current]) {
      rowRefs.current[lastCategory.current].focus();
    } else {
      panelRef.current?.querySelector(FOCUSABLE)?.focus();
    }
  }, [isOpen, current]);

  // Escape, Tab trap and body scroll lock while open. The command palette
  // (z-[60], its own dialog) can open on top; the menu yields to it by closing
  // when the palette opens and by ignoring keys that belong to the palette.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        // Palette is opening (or toggling): close without stealing focus back.
        dispatch('CLOSE');
        return;
      }
      const active = document.activeElement;
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        const otherDialog = active?.closest?.('[role="dialog"]');
        if (otherDialog && otherDialog !== panelRef.current) return;
        close();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const inside = panelRef.current.contains(active) || active === buttonRef.current;
      if (!inside) return;
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)];
      if (buttonRef.current) items.push(buttonRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onPaletteOpen = () => dispatch('CLOSE');
    window.addEventListener('keydown', onKey);
    window.addEventListener('palette:open', onPaletteOpen);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('palette:open', onPaletteOpen);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, close]);

  // ArrowUp/ArrowDown/Home/End move between rows in the list.
  const onListKeyDown = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const rows = [...e.currentTarget.querySelectorAll(FOCUSABLE)];
    const index = rows.indexOf(document.activeElement);
    if (index === -1) return;
    e.preventDefault();
    let next = index;
    if (e.key === 'ArrowDown') next = (index + 1) % rows.length;
    if (e.key === 'ArrowUp') next = (index - 1 + rows.length) % rows.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = rows.length - 1;
    rows[next].focus();
  };

  const openCategory = (id) => {
    lastCategory.current = id;
    setLevel(id);
  };

  const closing = phase === 'closing';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="Navigation menu"
        aria-expanded={isOpen}
        aria-controls={rendered ? panelId : undefined}
        aria-haspopup="dialog"
        className="glass-subtle fixed top-3 left-4 z-[60] p-2.5 rounded-md text-slate-slate300 hover:text-slate-slate100 hover:bg-slate-slate700/50 transition-colors"
      >
        {isOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
      </button>

      {rendered && (
        <div className="fixed inset-0 z-50" inert={closing}>
          {/* Dimmed backdrop; clicking outside the panel closes the menu */}
          <div
            className={`glass-overlay absolute inset-0 ${closing ? 'animate-overlay-out' : 'animate-overlay-in'}`}
            onClick={close}
            aria-hidden="true"
          />
          <aside
            id={panelId}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] glass-strong border-y-0 border-l-0 flex flex-col ${closing ? 'animate-drawer-out' : 'animate-drawer-in'}`}
          >
            {/* pl-16 (4rem) clears the fixed burger: left-4 (1rem) + p-2.5 icon button (~2.75rem) + gap */}
            <div className="pl-16 pr-4 py-3.5 border-b border-slate-slate700/50 flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-md bg-linear-to-br/srgb from-slate-brandLight to-slate-brandAccent flex items-center justify-center text-white font-bold shrink-0">
                {(Array.from(displayName || APP_TITLE)[0] ?? 'A').toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 id={headingId} className="text-sm font-bold text-slate-slate100 tracking-tight">
                  {APP_TITLE}
                </h2>
                <div className="text-xs text-slate-slate400 truncate">{displayName ?? 'Your workspace'}</div>
              </div>
            </div>

            <nav aria-label="Main" className="flex-1 px-3 py-4 overflow-y-auto">
              {current ? (
                <div onKeyDown={onListKeyDown} className="space-y-1">
                  <button
                    ref={backRef}
                    type="button"
                    onClick={() => setLevel(null)}
                    aria-label="Back to categories"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-slate-slate400 hover:text-slate-slate100 hover:bg-slate-slate700/50 transition-colors"
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                    <span>Back</span>
                  </button>
                  <h3 className="flex items-center gap-2 px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-slate400">
                    <current.icon size={14} aria-hidden="true" />
                    {current.section}
                  </h3>
                  {current.items.map((item) => (
                    <MenuLink key={item.to} {...item} onNavigate={close} />
                  ))}
                </div>
              ) : (
                <div onKeyDown={onListKeyDown} className="space-y-1">
                  {groups.map((group) => {
                    if (!group.section) {
                      return group.items.map((item) => (
                        <MenuLink key={item.to} {...item} onNavigate={close} />
                      ));
                    }
                    const Icon = group.icon;
                    const hasActive = group.items.some(isActiveRoute);
                    return (
                      <button
                        key={group.id}
                        ref={(el) => {
                          rowRefs.current[group.id] = el;
                        }}
                        type="button"
                        onClick={() => openCategory(group.id)}
                        className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-slate300 hover:text-slate-slate100 hover:bg-slate-slate700/50 transition-colors"
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span className="flex-1 text-left">{group.section}</span>
                        {hasActive && (
                          <>
                            <span className="sr-only">, contains current page</span>
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full bg-slate-slate400"
                            />
                          </>
                        )}
                        <span className="sr-only">, {group.items.length} items</span>
                        <span className="text-xs text-slate-slate400 tabular-nums" aria-hidden="true">
                          {group.items.length}
                        </span>
                        <ChevronRight size={16} className="text-slate-slate500" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              )}
            </nav>

            <div className="px-4 py-3 border-t border-slate-slate700/50 text-xs text-slate-slate400">
              <div>Private, on this device</div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
